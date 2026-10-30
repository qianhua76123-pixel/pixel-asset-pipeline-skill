"""Isolated HTTP-contract tests; never connects to a user's running studio."""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import struct
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import unittest
import zlib

SCRIPT = Path(__file__).resolve().parents[1] / "skills/pixel-asset-pipeline/scripts/pixel_studio.py"
SPEC = importlib.util.spec_from_file_location("pixel_studio", SCRIPT)
cli = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cli)


def png(width=2, height=2):
    def chunk(name, payload):
        return struct.pack(">I", len(payload)) + name + payload + struct.pack(">I", zlib.crc32(name + payload) & 0xffffffff)
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    rgba = b"".join(b"\0" + bytes([20, 120, 60, 255]) * width for _ in range(height))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rgba)) + chunk(b"IEND", b"")


def fixed_plan(asset_id="source", sampling="majority", grid=False, automatic=False, source_cleanup=False, segmentation=None):
    stages = []
    for stage_id in cli.SEGMENTATION_STAGES if segmentation is not None else cli.STAGES:
        role = "export" if stage_id == "export" else "pixel" if stage_id == "grid" else "cutout" if stage_id == "background" else "repair"
        run = stage_id in ("color-clusters", "export") or stage_id == "grid" and grid or stage_id in ("outer-contour", "source-colors") and automatic or stage_id == "source-colors" and source_cleanup or stage_id == "background-segmentation" and segmentation
        stage = {"id": stage_id, "role": role, "status": "run" if run else "skip", "label": stage_id}
        if run:
            if stage_id == "grid":
                stage["parameters"] = {"mode": "strict", "fit": "contain", "anchor": "center", "cols": 2, "rows": 2, "paletteSize": 0 if sampling == "source-center" else 256, "sampler": sampling, "scale": 1, "alphaMode": "binary", "alphaThreshold": 128, "phaseX": 0, "phaseY": 0}
            elif stage_id == "outer-contour":
                stage["parameters"] = {"mode": "automatic-refine"}
            elif stage_id == "source-colors":
                stage["parameters"] = {"mode": "color-cleanup", "cleanKeyShades": False, "keyColor": "#ff00ff"}
            elif stage_id == "background-segmentation":
                stage["parameters"] = {"mode": "background-segmentation"}
            else:
                stage["parameters"] = {"mode": "color-clusters", "paletteBudget": 96} if stage_id == "color-clusters" else {"format": "png", "native": True, "scale": 1, "filename": "result"}
        else:
            stage["reason"] = "Already completed or no source evidence"
        stages.append(stage)
    manifest = {"id": "local-pixel-fixed", "version": 1, "sourceAssetId": asset_id, "width": 2, "height": 2, "sampling": sampling, "paletteBudget": 96, "stages": stages}
    if automatic:
        manifest["refinementPolicy"] = "automatic-v1"
    nodes = [{"id": "source-node", "data": {"role": "asset", "assetId": asset_id}}]
    for stage in stages:
        if stage["status"] == "run":
            nodes.append({"id": stage["id"] + "-node", "data": {"role": stage["role"], "parameters": stage["parameters"]}})
    return {"inspection": {"assetId": asset_id, "verifiedPixel": not grid}, "plan": {"fixedWorkflow": manifest, "width": 2, "height": 2, "warnings": []}, "graph": {"nodes": nodes, "edges": [{"source": nodes[i]["id"], "target": nodes[i + 1]["id"]} for i in range(len(nodes) - 1)], "targetNodeId": nodes[-1]["id"]}, "review": {"generationCount": 0, "operationCount": len(nodes) - 1}}


class State:
    def __init__(self):
        self.paths, self.submissions, self.imports = [], [], []
        self.plan = fixed_plan()
        self.job_status = "succeeded"
        self.job_assets = [{"id": "result-asset"}]
        self.export_bytes = png()
        self.export_name = "result.png"
        self.export_url = "/api/studio/workflow/files/job-one/result.png"
        self.drop_submission_response = False
        self.source = b""

    def job(self):
        return {"id": "job-one", "status": self.job_status, "progress": 100, "assets": self.job_assets, "exports": [{"name": self.export_name, "url": self.export_url, "format": "png", "bytes": len(self.export_bytes), "width": 2, "height": 2}] if self.job_status == "succeeded" else []}


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.state = State()
        state = self.state

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, value, binary=False, code=200):
                body = value if binary else json.dumps(value).encode()
                self.send_response(code)
                self.send_header("Content-Type", "image/png" if binary else "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                state.paths.append(("GET", self.path))
                if self.path == "/api/studio/process":
                    return self.reply({"rembg": True, "models": {"birefnet-lite": True}})
                if self.path == "/api/studio/assets/source/preparation":
                    return self.reply({"inspection": {"assetId": "source", "verifiedPixel": True}})
                if self.path == "/api/studio/jobs/job-one":
                    return self.reply(state.job())
                if self.path.startswith("/api/studio/workflow/files/job-one/"):
                    return self.reply(state.export_bytes, binary=True)
                return self.reply({"error": "Unknown route"}, code=404)

            def do_POST(self):
                state.paths.append(("POST", self.path))
                body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                if self.path == "/api/studio/assets":
                    state.imports.append(body)
                    return self.reply({"asset": {"id": "source", "name": "input.png", "width": 2, "height": 2}}, code=201)
                if self.path == "/api/studio/assets/source/preparation":
                    return self.reply(state.plan)
                if self.path == "/api/studio/workflow":
                    state.submissions.append(json.loads(body))
                    if state.drop_submission_response:
                        self.close_connection = True
                        return
                    return self.reply({"jobId": "job-one", "status": "queued"}, code=202)
                return self.reply({"error": "Forbidden route"}, code=400)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = "http://127.0.0.1:" + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.directory.cleanup()

    def invoke(self, *args):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = cli.main(["--base-url", self.url, *map(str, args)])
        return code, json.loads(output.getvalue())

    def test_doctor_never_emits_provider_keys_or_starts_work(self):
        code, result = self.invoke("doctor")
        self.assertEqual(code, 0)
        self.assertTrue(result["models"]["birefnet-lite"])
        self.assertNotIn("secret", json.dumps(result))
        self.assertEqual(self.state.paths, [("GET", "/api/studio/process")])

    def test_plan_inspect_and_dry_run_create_no_imports_or_jobs(self):
        for args in [("inspect", "--asset-id", "source"), ("plan", "--asset-id", "source"), ("run", "--asset-id", "source", "--dry-run")]:
            self.assertEqual(self.invoke(*args)[0], 0)
        self.assertEqual(self.state.submissions, [])
        self.assertEqual(self.state.imports, [])
        self.assertTrue(all("generate" not in path for _, path in self.state.paths))

    def test_run_submits_one_fixed_graph_and_downloads_actual_png(self):
        output = self.root / "first"
        code, result = self.invoke("run", "--asset-id", "source", "--output", output)
        self.assertEqual(code, 0)
        self.assertEqual(len(self.state.submissions), 1)
        self.assertEqual([n["data"]["role"] for n in self.state.submissions[0]["nodes"]], ["asset", "repair", "export"])
        self.assertEqual((output / "result.png").read_bytes(), png())
        self.assertEqual(result["jobId"], "job-one")
        self.assertEqual(result["fixedWorkflow"]["sourceAssetId"], "source")
        self.assertTrue(result["downloads"][0]["sha256"])
        self.assertEqual(json.loads((output / "run-report.json").read_text()), result)

    def test_source_center_plan_runs_and_keeps_source_rgb_palette_policy(self):
        self.state.plan = fixed_plan(sampling="source-center", grid=True)
        output = self.root / "source-center"
        code, result = self.invoke("run", "--asset-id", "source", "--output", output)
        self.assertEqual(code, 0)
        self.assertEqual(len(self.state.submissions), 1)
        nodes = self.state.submissions[0]["nodes"]
        self.assertEqual([n["data"]["role"] for n in nodes], ["asset", "pixel", "repair", "export"])
        self.assertEqual(nodes[1]["data"]["parameters"]["sampler"], "source-center")
        self.assertEqual(nodes[1]["data"]["parameters"]["paletteSize"], 0)
        self.assertEqual(result["fixedWorkflow"]["sampling"], "source-center")
        self.assertEqual((output / "result.png").read_bytes(), png())

    def test_automatic_policy_runs_without_material_or_client_evidence(self):
        self.state.plan = fixed_plan(sampling="source-center", grid=True, automatic=True)
        code, result = self.invoke("run", "--asset-id", "source", "--output", self.root / "automatic")
        self.assertEqual(code, 0)
        self.assertEqual(result["fixedWorkflow"]["refinementPolicy"], "automatic-v1")
        self.assertEqual(self.state.submissions[0]["nodes"][-2]["data"]["parameters"], {"mode": "automatic-refine"})

    def test_automatic_policy_cannot_be_forged_or_expand_parameters(self):
        for index, kind in enumerate(("unknown", "missing", "majority", "override", "global-shades")):
            self.state.plan = fixed_plan(sampling="source-center", grid=True, automatic=True)
            manifest = self.state.plan["plan"]["fixedWorkflow"]
            if kind == "unknown":
                manifest["refinementPolicy"] = "unknown-policy"
            elif kind == "missing":
                del manifest["refinementPolicy"]
            elif kind == "majority":
                manifest["sampling"] = "majority"
            elif kind == "global-shades":
                stage = next(s for s in manifest["stages"] if s["id"] == "source-colors")
                stage["parameters"]["cleanKeyShades"] = True
            else:
                stage = next(s for s in manifest["stages"] if s["id"] == "outer-contour")
                stage["parameters"]["profile"] = "glass"
            code, _ = self.invoke("run", "--asset-id", "source", "--output", self.root / ("automatic-invalid-" + str(index)))
            self.assertNotEqual(code, 0)
        self.assertEqual(self.state.submissions, [])

    def test_optional_segmentation_suffix_runs_once_before_export(self):
        self.state.plan = fixed_plan(sampling="source-center", grid=True, automatic=True, segmentation=True)
        code, result = self.invoke("run", "--asset-id", "source", "--output", self.root / "segmentation")
        self.assertEqual(code, 0)
        self.assertEqual(len(self.state.submissions), 1)
        nodes = self.state.submissions[0]["nodes"]
        self.assertEqual([n["data"]["parameters"]["mode"] for n in nodes[-3:-1]], ["automatic-refine", "background-segmentation"])
        self.assertEqual(nodes[-2]["data"], {"role": "repair", "parameters": {"mode": "background-segmentation"}})
        self.assertEqual(nodes[-1]["data"]["role"], "export")
        self.assertEqual((self.root / "segmentation/result.png").read_bytes(), png())
        self.assertEqual(result["fixedWorkflow"]["stages"][-2]["id"], "background-segmentation")

    def test_optional_segmentation_can_be_skipped_without_source_evidence(self):
        for automatic in (False, True):
            self.state.plan = fixed_plan(sampling="source-center", automatic=automatic, segmentation=False)
            code, _ = self.invoke("plan", "--asset-id", "source")
            self.assertEqual(code, 0)
        self.assertEqual(self.state.submissions, [])

    def test_runtime_report_identifies_actual_v4_rule_without_copying_proof_arrays(self):
        self.state.plan = fixed_plan(sampling="source-center", grid=True, automatic=True, segmentation=True)
        # Public saved-asset shape from the current Studio pipeline, with only
        # synthetic scalar values. No user artwork or private proof is bundled.
        code_sha = "e1b23c515ba61f424cce4cfb9f2cfc5b0391bbef8ad98a65aa14fea8fd5382da"
        spec_sha = "e93b487858d6e25ce8af353677ac939a3b37ea550f660d2eb121dc7542d88947"
        self.state.job_assets = [{"id": "final-asset", "parentId": "automatic-asset", "kind": "repair-outline", "params": {
            "mode": "background-segmentation", "output": "/private/source.png", "diagnostics": {
                "algorithm": "source-backed-final-background-refinement-v4", "status": "applied",
                "sourceRuleAlgorithm": "source-connected-material-endpoint-restoration-v5",
                "sourceRuleCodeSha256": code_sha, "sourceRuleSpecSha256": spec_sha,
                "changedPixels": 2, "nativeSourceRecoloredPixels": 2,
                "alphaPreserved": True, "nativeSourcePassRGBOnly": True,
                "inferred": True, "sourceRecoveryClaimed": False,
                "sourceRefinement": {"algorithm": "source-connected-material-endpoint-restoration-v5",
                    "status": "applied", "changedPixels": 3, "changesRecorded": 3,
                    "sourceChangesSha256": "b" * 64, "sourceProposalTrace": [{"secret": "do-not-copy"}],
                    "foregroundPathTrees": [{"privatePath": "/private/input.png"}]},
                "changes": [{"raw": "do-not-copy"}], "warnings": ["/private/input.png"],
                "settings": {"key": "sk-secretshouldnotappear"},
            }}}]
        output = self.root / "runtime-proof"
        code, result = self.invoke("run", "--asset-id", "source", "--output", output)
        self.assertEqual(code, 0)
        stage = result["processingStages"][0]
        self.assertEqual((stage["assetId"], stage["parentAssetId"], stage["mode"]), ("final-asset", "automatic-asset", "background-segmentation"))
        proof = stage["diagnostics"]
        self.assertEqual(proof["sourceRuleCodeSha256"], code_sha)
        self.assertEqual(proof["sourceRuleSpecSha256"], spec_sha)
        self.assertEqual(proof["sourceRuleAlgorithm"], "source-connected-material-endpoint-restoration-v5")
        self.assertEqual(proof["nativeSourceRecoloredPixels"], 2)
        self.assertTrue(proof["inferred"])
        self.assertFalse(proof["sourceRecoveryClaimed"])
        self.assertEqual(proof["sourceRefinement"]["changesRecorded"], 3)
        self.assertEqual(result["processingStagesTruncated"], 0)
        saved = json.loads((output / "run-report.json").read_text())
        self.assertEqual(saved, result)
        for forbidden in ("foregroundPathTrees", "sourceProposalTrace", "changes\"", "do-not-copy", "/private", "settings", "sk-secret"):
            self.assertNotIn(forbidden, json.dumps(saved))
        self.assertEqual(len(self.state.submissions), 1)

    def test_status_keeps_skip_reason_and_never_invents_missing_algorithm_evidence(self):
        self.state.job_assets = [
            {"id": "skipped-asset", "kind": "repair-outline", "params": {"mode": "background-segmentation", "diagnostics": {
                "algorithm": "source-backed-final-background-refinement-v4", "status": "skipped",
                "skipReason": "missing-verified-original-source-context", "changedPixels": 0,
                "sourceRefinement": {"status": "skipped", "skipReason": "missing-original-source-pixels"},
            }}},
            {"id": "old-asset", "kind": "pixel", "params": {"mode": "strict"}},
        ]
        code, result = self.invoke("status", "--job-id", "job-one")
        self.assertEqual(code, 0)
        proof = result["processingStages"][0]["diagnostics"]
        self.assertEqual(proof["status"], "skipped")
        self.assertEqual(proof["skipReason"], "missing-verified-original-source-context")
        self.assertEqual(proof["changedPixels"], 0)
        self.assertEqual(result["processingStages"][1]["diagnostics"], {})
        self.assertNotIn("sourceRuleCodeSha256", proof)
        self.assertEqual(self.state.submissions, [])

    def test_processing_summary_bounds_and_types_untrusted_diagnostics(self):
        value = {"id": "stage", "kind": "repair-outline", "parentId": "/private/input.png", "params": {"mode": "background-segmentation", "diagnostics": {
            "algorithm": "sk-secretshouldnotappear", "sourceRuleAlgorithm": "https://private.example/source",
            "skipReason": "/Users/private/file.png", "status": "credential-value", "changedPixels": True,
            "removedPixels": -1, "addedPixels": 2**54, "recoloredPixels": 2.5,
            "alphaPreserved": "yes", "inferred": True, "sourceRuleCodeSha256": "not-a-hash",
            "sourceRuleSpecSha256": "c" * 64, "changes": [{"nested": "not-allowed"}] * 1000,
            "sourceRefinement": {"changedPixels": 1, "sourceKernel": {"algorithm": "not-allowed"}},
        }}}
        result = cli.summary({"id": "job", "assets": [copy.deepcopy(value) for _ in range(40)]})
        self.assertEqual(len(result["processingStages"]), cli.MAX_PROCESSING_STAGES)
        self.assertEqual(result["processingStagesTruncated"], 40 - cli.MAX_PROCESSING_STAGES)
        stage = result["processingStages"][0]
        self.assertNotIn("parentAssetId", stage)
        self.assertEqual(stage["diagnostics"], {"inferred": True, "sourceRuleSpecSha256": "c" * 64, "sourceRefinement": {"changedPixels": 1}})
        self.assertLess(len(json.dumps(result)), 20_000)

    def test_completed_automatic_plan_remains_export_only_without_invented_upgrade(self):
        self.state.plan = fixed_plan(sampling="source-center", automatic=True, segmentation=False)
        for stage in self.state.plan["plan"]["fixedWorkflow"]["stages"]:
            if stage["id"] != "export":
                stage.update({"status": "skip", "reason": "Already verified"})
                stage.pop("parameters", None)
        graph = self.state.plan["graph"]
        graph["nodes"] = [graph["nodes"][0], graph["nodes"][-1]]
        graph["edges"] = [{"source": graph["nodes"][0]["id"], "target": graph["nodes"][-1]["id"]}]
        self.state.plan["inspection"].update({"verifiedPixel": True, "automaticRefinementApplied": True, "sourceColorCleanupApplied": True, "colorClustersApplied": True})
        code, result = self.invoke("run", "--asset-id", "source", "--output", self.root / "completed")
        self.assertEqual(code, 0)
        self.assertEqual([n["data"]["role"] for n in self.state.submissions[0]["nodes"]], ["asset", "export"])
        self.assertEqual(result["processingStages"], [])

    def test_segmentation_cannot_expand_or_reorder_the_fixed_graph(self):
        plans = []
        for patch in ({"mode": "other"}, {"mask": "arbitrary-reference"}, {"sourceAssetId": "other"}):
            p = fixed_plan(sampling="source-center", automatic=True, segmentation=True)
            p["plan"]["fixedWorkflow"]["stages"][-2]["parameters"].update(patch)
            plans.append(p)
        for automatic, sampling in ((False, "source-center"), (True, "majority")):
            plans.append(fixed_plan(sampling=sampling, automatic=automatic, segmentation=True))
        p = fixed_plan(sampling="source-center", automatic=True, segmentation=True)
        p["plan"]["fixedWorkflow"]["stages"][-2]["role"] = "cutout"
        p["graph"]["nodes"][-2]["data"]["role"] = "cutout"
        plans.append(p)
        p = fixed_plan(sampling="source-center", automatic=True, segmentation=True)
        outer = next(s for s in p["plan"]["fixedWorkflow"]["stages"] if s["id"] == "outer-contour")
        outer["status"] = "skip"
        p["graph"]["nodes"] = [n for n in p["graph"]["nodes"] if n["id"] != "outer-contour-node"]
        ids = [n["id"] for n in p["graph"]["nodes"]]
        p["graph"]["edges"] = [{"source": ids[i], "target": ids[i + 1]} for i in range(len(ids) - 1)]
        plans.append(p)
        for kind in ("duplicate", "reorder"):
            p = fixed_plan(sampling="source-center", automatic=True, segmentation=True)
            stages = p["plan"]["fixedWorkflow"]["stages"]
            if kind == "duplicate":
                stages.insert(-1, copy.deepcopy(stages[-2]))
            else:
                stages[-3], stages[-2] = stages[-2], stages[-3]
            plans.append(p)
        for i, p in enumerate(plans):
            self.state.plan = p
            code, _ = self.invoke("run", "--asset-id", "source", "--output", self.root / f"bad-segmentation-{i}")
            self.assertEqual(code, 2)
        self.assertEqual(self.state.submissions, [])

    def test_runtime_source_key_is_preserved_with_or_without_automatic_policy(self):
        for automatic in (False, True):
            for explicit in (False, True):
                with self.subTest(automatic=automatic, explicit=explicit):
                    self.state.plan = fixed_plan(sampling="source-center", grid=True, automatic=automatic, source_cleanup=True)
                    params = next(s for s in self.state.plan["plan"]["fixedWorkflow"]["stages"] if s["id"] == "source-colors")["parameters"]
                    params.clear()
                    params.update({"mode": "color-cleanup", "keyColorMode": "removed-source"})
                    if explicit:
                        params.update({"cleanKeyShades": False, "protectInkGrowth": True})
                    code, _ = self.invoke("run", "--asset-id", "source", "--output", self.root / f"runtime-{automatic}-{explicit}")
                    self.assertEqual(code, 0)
                    submitted = next(n["data"]["parameters"] for n in self.state.submissions[-1]["nodes"] if n["id"] == "source-colors-node")
                    self.assertEqual(submitted, params)
                    self.assertNotIn("keyColor", submitted)

    def test_invalid_runtime_source_key_is_rejected_before_submission_for_every_policy(self):
        invalid = [{"keyColorMode": value} for value in (None, "auto", "", False, 1, {})]
        invalid += [{"keyColor": value} for value in (None, "#ffffff", "")]
        invalid += [{"cleanKeyShades": value} for value in (None, True, 0, "false")]
        invalid += [{"protectInkGrowth": value} for value in (None, False, 1, "true")]
        for automatic in (False, True):
            for index, patch in enumerate(invalid):
                with self.subTest(automatic=automatic, patch=patch):
                    self.state.plan = fixed_plan(sampling="source-center", grid=True, automatic=automatic, source_cleanup=True)
                    params = next(s for s in self.state.plan["plan"]["fixedWorkflow"]["stages"] if s["id"] == "source-colors")["parameters"]
                    params.clear()
                    params.update({"mode": "color-cleanup", "keyColorMode": "removed-source", **patch})
                    code, _ = self.invoke("run", "--asset-id", "source", "--output", self.root / f"invalid-runtime-{automatic}-{index}")
                    self.assertEqual(code, 2)
        self.assertEqual(self.state.submissions, [])

    def test_explicit_source_key_remains_compatible_without_runtime_mode(self):
        self.state.plan = fixed_plan(source_cleanup=True)
        params = next(s for s in self.state.plan["plan"]["fixedWorkflow"]["stages"] if s["id"] == "source-colors")["parameters"]
        params["cleanKeyShades"] = True
        code, _ = self.invoke("run", "--asset-id", "source", "--output", self.root / "explicit-cleanup")
        self.assertEqual(code, 0)
        submitted = next(n["data"]["parameters"] for n in self.state.submissions[-1]["nodes"] if n["id"] == "source-colors-node")
        self.assertEqual(submitted, params)

    def test_legacy_majority_grid_and_skipped_grid_remain_compatible(self):
        for grid in (False, True):
            with self.subTest(grid=grid):
                self.state.plan = fixed_plan(sampling="majority", grid=grid)
                code, result = self.invoke("plan", "--asset-id", "source")
                self.assertEqual(code, 0)
                self.assertEqual(result["plan"]["fixedWorkflow"]["sampling"], "majority")
        self.assertEqual(self.state.submissions, [])

    def test_sampler_and_palette_mismatches_are_rejected_before_submission(self):
        plans = []
        for sampling in ("source-center", "majority"):
            for field, replacement in (("sampler", "majority" if sampling == "source-center" else "source-center"), ("paletteSize", 256 if sampling == "source-center" else 0), ("sampler", None), ("paletteSize", None), ("paletteSize", False if sampling == "source-center" else 256.0)):
                value = fixed_plan(sampling=sampling, grid=True)
                # Deliberately change both declarations so their equality alone
                # cannot hide disagreement with the manifest's fixed recipe.
                params = value["plan"]["fixedWorkflow"]["stages"][1]["parameters"]
                if replacement is None:
                    del params[field]
                else:
                    params[field] = replacement
                plans.append(value)
        unsupported = fixed_plan(sampling="medoid", grid=True)
        plans.append(unsupported)
        graph_mismatch = fixed_plan(sampling="source-center", grid=True)
        graph_mismatch["graph"]["nodes"][1]["data"]["parameters"] = {**graph_mismatch["graph"]["nodes"][1]["data"]["parameters"], "sampler": "majority"}
        plans.append(graph_mismatch)
        for i, value in enumerate(plans):
            with self.subTest(i=i):
                self.state.plan = value
                code, result = self.invoke("run", "--asset-id", "source", "--output", self.root / ("sampling-error-" + str(i)))
                self.assertEqual(code, 2)
                self.assertEqual(result["status"], "preparation-error")
        self.assertEqual(self.state.submissions, [])

    def test_timeout_and_resume_do_not_submit_the_job_twice(self):
        self.state.job_status = "running"
        code, result = self.invoke("run", "--asset-id", "source", "--output", self.root / "timed", "--wait", "0")
        self.assertEqual(code, 3)
        self.assertEqual(result["jobId"], "job-one")
        self.assertEqual(len(self.state.submissions), 1)
        self.state.job_status = "succeeded"
        code, result = self.invoke("resume", "--job-id", "job-one", "--output", self.root / "resumed")
        self.assertEqual(code, 0)
        self.assertEqual(len(self.state.submissions), 1)
        self.assertFalse(result["resubmitted"])
        self.assertFalse(any(method == "POST" and "/jobs/" in path for method, path in self.state.paths))

    def test_import_keeps_source_and_omits_path_from_multipart_headers(self):
        source = self.root / 'input"\r\nunsafe.png'
        source.write_bytes(png())
        code, result = self.invoke("run", "--input", source, "--output", self.root / "imported")
        self.assertEqual(code, 0)
        self.assertEqual(len(self.state.imports), 1)
        self.assertEqual(source.read_bytes(), png())
        self.assertNotIn(str(self.root).encode(), self.state.imports[0])
        self.assertIn(b'filename="input___unsafe.png"', self.state.imports[0])
        self.assertEqual(result["import"]["assetId"], "source")

    def test_existing_output_is_rejected_before_network_or_overwrite(self):
        output = self.root / "exists"
        output.mkdir()
        marker = output / "keep.txt"
        marker.write_text("preserve")
        code, result = self.invoke("run", "--asset-id", "source", "--output", output)
        self.assertEqual(code, 2)
        self.assertIn("already exists", result["error"])
        self.assertEqual(marker.read_text(), "preserve")
        self.assertEqual(self.state.paths, [])

    def test_dry_run_does_not_implicitly_upload(self):
        source = self.root / "input.png"
        source.write_bytes(png())
        code, _ = self.invoke("run", "--input", source, "--dry-run")
        self.assertEqual(code, 2)
        self.assertEqual(self.state.paths, [])

    def test_invalid_or_generation_plans_are_rejected_without_submission(self):
        bad_plans = []
        value = fixed_plan()
        value["review"]["generationCount"] = 1
        bad_plans.append(value)
        value = fixed_plan()
        value["graph"]["nodes"][1]["data"]["role"] = "generation"
        bad_plans.append(value)
        value = fixed_plan()
        value["plan"]["fixedWorkflow"]["sourceAssetId"] = "other"
        bad_plans.append(value)
        value = fixed_plan()
        value["graph"]["edges"] = [{"source": "source-node", "target": "export-node"}, {"source": "color-clusters-node", "target": "export-node"}]
        bad_plans.append(value)
        value = fixed_plan()
        value["plan"]["fixedWorkflow"]["stages"].append(None)
        bad_plans.append(value)
        for i, value in enumerate(bad_plans):
            with self.subTest(i=i):
                self.state.plan = value
                code, result = self.invoke("run", "--asset-id", "source", "--output", self.root / ("bad-" + str(i)))
                self.assertEqual(code, 2)
                self.assertEqual(result["status"], "preparation-error")
        self.assertEqual(self.state.submissions, [])

    def test_unknown_submission_outcome_is_recorded_and_never_retried(self):
        self.state.drop_submission_response = True
        code, result = self.invoke("run", "--asset-id", "source", "--output", self.root / "unknown")
        self.assertEqual(code, 3)
        self.assertEqual(result["status"], "submission-outcome-unknown")
        self.assertEqual(len(self.state.submissions), 1)
        self.assertIn("Do not resubmit", result["recovery"])

    def test_failed_existing_job_is_not_restarted(self):
        self.state.job_status = "failed"
        code, result = self.invoke("resume", "--job-id", "job-one", "--output", self.root / "failed")
        self.assertEqual(code, 2)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(self.state.submissions, [])

    def test_bad_export_data_or_size_never_creates_a_png(self):
        for i, content in enumerate([b"<html>not an image</html>", png()[:-2], png(3, 2)]):
            with self.subTest(i=i):
                self.state.export_bytes = content
                output = self.root / ("png-error-" + str(i))
                code, result = self.invoke("export", "--job-id", "job-one", "--output", output)
                self.assertEqual(code, 3)
                self.assertEqual(result["status"], "collection-error")
                self.assertEqual(list(output.glob("*.png")), [])

    def test_export_path_and_remote_url_cannot_escape_output_or_selected_service(self):
        for i, (name, url) in enumerate([("../escape.png", "/api/studio/workflow/files/job-one/../escape.png"), ("C:escape.png", "/api/studio/workflow/files/job-one/C%3Aescape.png"), ("safe.png", "https://other.example/safe.png"), ("safe.png", "/api/studio/workflow/files/another/safe.png")]):
            with self.subTest(i=i):
                self.state.export_name, self.state.export_url = name, url
                code, _ = self.invoke("export", "--job-id", "job-one", "--output", self.root / ("path-error-" + str(i)))
                self.assertEqual(code, 3)
        self.assertFalse((self.root / "escape.png").exists())
        self.assertEqual(self.state.submissions, [])

    def test_remote_requires_explicit_opt_in_and_embedded_credentials_are_rejected(self):
        with self.assertRaisesRegex(cli.ClientError, "allow-remote"):
            cli.StudioClient("https://studio.example")
        self.assertEqual(cli.StudioClient("https://studio.example", allow_remote=True).base_url, "https://studio.example")
        for url in ["http://user:secret@127.0.0.1:3410", "http://127.0.0.1:3410/path", "http://127.0.0.1:3410?key=value"]:
            with self.assertRaises(cli.ClientError):
                cli.StudioClient(url, allow_remote=True)

    def test_status_and_export_only_read_existing_job(self):
        self.assertEqual(self.invoke("status", "--job-id", "job-one")[0], 0)
        self.assertEqual(self.invoke("export", "--job-id", "job-one", "--output", self.root / "export")[0], 0)
        self.assertTrue(all(method == "GET" for method, _ in self.state.paths))


if __name__ == "__main__":
    unittest.main()
