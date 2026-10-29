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


def fixed_plan(asset_id="source"):
    stages = []
    for stage_id in cli.STAGES:
        role = "export" if stage_id == "export" else "pixel" if stage_id == "grid" else "cutout" if stage_id == "background" else "repair"
        run = stage_id in ("color-clusters", "export")
        stage = {"id": stage_id, "role": role, "status": "run" if run else "skip", "label": stage_id}
        if run:
            stage["parameters"] = {"mode": "color-clusters", "paletteBudget": 96} if stage_id == "color-clusters" else {"format": "png", "native": True, "scale": 1, "filename": "result"}
        else:
            stage["reason"] = "Already completed or no source evidence"
        stages.append(stage)
    manifest = {"id": "local-pixel-fixed", "version": 1, "sourceAssetId": asset_id, "width": 2, "height": 2, "sampling": "majority", "paletteBudget": 96, "stages": stages}
    nodes = [{"id": "source-node", "data": {"role": "asset", "assetId": asset_id}}]
    for stage in stages:
        if stage["status"] == "run":
            nodes.append({"id": stage["id"] + "-node", "data": {"role": stage["role"], "parameters": stage["parameters"]}})
    return {"inspection": {"assetId": asset_id, "verifiedPixel": True}, "plan": {"fixedWorkflow": manifest, "width": 2, "height": 2, "warnings": []}, "graph": {"nodes": nodes, "edges": [{"source": nodes[i]["id"], "target": nodes[i + 1]["id"]} for i in range(len(nodes) - 1)], "targetNodeId": nodes[-1]["id"]}, "review": {"generationCount": 0, "operationCount": 2}}


class State:
    def __init__(self):
        self.paths, self.submissions, self.imports = [], [], []
        self.plan = fixed_plan()
        self.job_status = "succeeded"
        self.export_bytes = png()
        self.export_name = "result.png"
        self.export_url = "/api/studio/workflow/files/job-one/result.png"
        self.drop_submission_response = False
        self.source = b""

    def job(self):
        return {"id": "job-one", "status": self.job_status, "progress": 100, "assets": [{"id": "result-asset"}], "exports": [{"name": self.export_name, "url": self.export_url, "format": "png", "bytes": len(self.export_bytes), "width": 2, "height": 2}] if self.job_status == "succeeded" else []}


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
