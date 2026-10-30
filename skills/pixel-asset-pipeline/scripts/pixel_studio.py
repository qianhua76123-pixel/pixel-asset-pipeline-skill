#!/usr/bin/env python3
"""Standard-library client for Pixel Studio's local-pixel-fixed/v1 workflow.

This adapter requires a compatible running Pixel Studio service. It does not
contain the pixel algorithms, launch a server, generate images, or install models.
"""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zlib

DEFAULT_URL = "http://127.0.0.1:3410"
STAGES = ("background", "grid", "source-colors", "material-detail", "color-clusters", "outer-contour", "export")
SEGMENTATION_STAGES = STAGES[:-1] + ("background-segmentation", "export")
ACTIVE = {"queued", "pending", "running"}
MAX_PNG = 64 * 1024 * 1024
MAX_PROCESSING_STAGES = 32
DIAGNOSTIC_COUNTERS = (
    "changedPixels", "recoloredPixels", "addedPixels", "removedPixels",
    "legacyChangedPixels", "newAdditionalChangedPixels", "additionalRemovedPixels",
    "additionalRecoloredPixels", "nativeSourceChangedPixels", "nativeSourceRecoloredPixels",
    "nativeSourceRemovedPixels", "sourceChangesRecorded", "sourceProposedCells",
    "changesRecorded", "changesTruncated", "sourceProposalTraceTruncated",
    "candidateCount", "acceptedCandidates", "rejectedCandidates", "candidateRollbackCount",
)
DIAGNOSTIC_FLAGS = (
    "skipped", "alphaPreserved", "restorationAlphaPreserved", "nativeSourcePassRGBOnly",
    "existingTransparencyPreserved", "priorV3ActualRepairsPreserved",
    "sourceAndAutomaticRepairsPreserved", "exactOriginalDonorProjection",
    "originalVisibleDonorColorsOnly", "unchangedOutsideSourceProposals",
    "originalPaletteOnly", "sourceColorsOnly", "exactSourceCenterProjection",
    "legacyResultPreserved", "boundedSinglePass", "binaryAlpha", "transparentRGBZero",
    "framePreserved", "bboxPreserved", "holePixelsPreserved", "thinStructuresPreserved",
    "inferred", "sourceRecoveryClaimed", "automaticRollback", "reviewRequired",
)
DIAGNOSTIC_HASHES = (
    "specSha256", "sourceRuleCodeSha256", "sourceRuleSpecSha256", "inputRGBAHash",
    "outputRGBAHash", "sourceInputRGBAHash", "originalSourceRGBAHash", "sourceChangesSha256",
)


class ClientError(Exception):
    pass


def clean_error(value):
    # The client never requests provider settings. Redact common credential
    # forms if a server nevertheless includes one in an error message.
    value = str(value)
    value = re.sub(r"\bsk-[A-Za-z0-9_-]{8,}", "[redacted]", value)
    value = re.sub(r"(?i)(bearer\s+)[A-Za-z0-9._~+/-]+", r"\1[redacted]", value)
    return value[:1600]


def safe_id(value):
    if not isinstance(value, str) or not value or len(value) > 180 or any(ord(c) < 32 or c in "/\\?#" for c in value):
        raise ClientError("Invalid saved asset or job identifier")
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class StudioClient:
    def __init__(self, base_url=DEFAULT_URL, allow_remote=False, timeout=60):
        parsed = urllib.parse.urlsplit(base_url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
            raise ClientError("Base URL must be an HTTP(S) origin without credentials, query, or path")
        try:
            loopback = ipaddress.ip_address(parsed.hostname).is_loopback
        except ValueError:
            loopback = parsed.hostname.lower() == "localhost"
        if not loopback and not allow_remote:
            raise ClientError("Non-loopback service requires --allow-remote; files would leave this computer")
        if timeout <= 0:
            raise ClientError("HTTP timeout must be positive")
        self.base_url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))
        self.timeout = timeout
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, path, body=None, content_type="application/json", binary=False):
        if not path.startswith("/api/studio/"):
            raise ClientError("Only Pixel Studio API paths are supported")
        data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"Accept": "image/png" if binary else "application/json", "Origin": self.base_url}
        if data is not None:
            headers["Content-Type"] = content_type
        request = urllib.request.Request(self.base_url + path, data=data, headers=headers, method="POST" if data is not None else "GET")
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                payload = response.read((MAX_PNG if binary else 32 * 1024 * 1024) + 1)
        except urllib.error.HTTPError as error:
            payload = error.read(64 * 1024)
            try:
                message = json.loads(payload).get("error", "HTTP " + str(error.code))
            except (ValueError, AttributeError):
                message = "HTTP " + str(error.code)
            raise ClientError(clean_error(message)) from None
        except (OSError, urllib.error.URLError, TimeoutError) as error:
            raise ClientError("Service request failed: " + clean_error(error)) from None
        if len(payload) > (MAX_PNG if binary else 32 * 1024 * 1024):
            raise ClientError("Service response exceeds the client size limit")
        if binary:
            return payload
        try:
            result = json.loads(payload)
        except (ValueError, UnicodeError):
            raise ClientError("Service did not return JSON") from None
        if not isinstance(result, dict):
            raise ClientError("Service response must be a JSON object")
        return result

    def import_png(self, filename):
        source = Path(filename)
        if not source.is_file() or source.stat().st_size > 40 * 1024 * 1024:
            raise ClientError("Input must be an existing PNG no larger than 40 MiB")
        with source.open("rb") as handle:
            png = handle.read(40 * 1024 * 1024 + 1)
        if not png or len(png) > 40 * 1024 * 1024:
            raise ClientError("Input must be an existing PNG no larger than 40 MiB")
        png_info(png)
        boundary = "pixel-skill-" + uuid.uuid4().hex
        # Never put a full source path or unsanitized file name into a header.
        name = re.sub(r"[^A-Za-z0-9_.-]", "_", source.name)[:120] or "input.png"
        prefix = ('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + name + '"\r\nContent-Type: image/png\r\n\r\n').encode("ascii")
        body = prefix + png + ("\r\n--" + boundary + "--\r\n").encode("ascii")
        response = self.request("/api/studio/assets", body, "multipart/form-data; boundary=" + boundary)
        asset = response.get("asset")
        if not isinstance(asset, dict):
            raise ClientError("Import did not return a saved asset")
        safe_id(asset.get("id"))
        return {"assetId": asset["id"], "name": asset.get("name"), "width": asset.get("width"), "height": asset.get("height"), "sourceSha256": hashlib.sha256(png).hexdigest()}

    def inspect(self, asset_id):
        result = self.request("/api/studio/assets/" + urllib.parse.quote(safe_id(asset_id), safe="") + "/preparation")
        info = result.get("inspection")
        if not isinstance(info, dict) or info.get("assetId") != asset_id:
            raise ClientError("Inspection does not match the saved source")
        return info

    def plan(self, asset_id, profile=None):
        body = {"mode": "automatic"}
        if profile:
            body["detailProfile"] = profile
        result = self.request("/api/studio/assets/" + urllib.parse.quote(safe_id(asset_id), safe="") + "/preparation", body)
        return validate_plan(result, asset_id, profile)

    def job(self, job_id):
        response = self.request("/api/studio/jobs/" + urllib.parse.quote(safe_id(job_id), safe=""))
        job = response.get("job", response)
        if not isinstance(job, dict) or job.get("id") != job_id:
            raise ClientError("Job response does not match the requested ID")
        return job


def png_info(png):
    """Check PNG structure, CRCs and IHDR dimensions, not artistic quality."""
    if png[:8] != b"\x89PNG\r\n\x1a\n":
        raise ClientError("Export is not a PNG")
    offset, dimensions, has_data, ended = 8, None, False, False
    while offset + 12 <= len(png):
        length = struct.unpack(">I", png[offset:offset + 4])[0]
        kind = png[offset + 4:offset + 8]
        end = offset + 12 + length
        if end > len(png):
            raise ClientError("PNG is truncated")
        payload = png[offset + 8:end - 4]
        crc = struct.unpack(">I", png[end - 4:end])[0]
        if zlib.crc32(kind + payload) & 0xffffffff != crc:
            raise ClientError("PNG chunk checksum failed")
        if dimensions is None:
            if kind != b"IHDR" or length != 13:
                raise ClientError("PNG is missing IHDR")
            width, height = struct.unpack(">II", payload[:8])
            if width <= 0 or height <= 0 or width * height > 32_000_000:
                raise ClientError("PNG dimensions are invalid or too large")
            dimensions = {"width": width, "height": height}
        elif kind == b"IHDR":
            raise ClientError("PNG contains duplicate IHDR")
        if kind == b"IDAT":
            has_data = True
        if kind == b"IEND":
            if length or end != len(png):
                raise ClientError("PNG has an invalid ending")
            ended = True
            break
        offset = end
    if not dimensions or not has_data or not ended:
        raise ClientError("PNG data or ending is missing")
    return dimensions


def validate_plan(value, asset_id, expected_profile=None):
    plan, graph, review = value.get("plan"), value.get("graph"), value.get("review")
    if not isinstance(plan, dict) or not isinstance(graph, dict) or not isinstance(review, dict):
        raise ClientError("Service does not provide the fixed preparation planning API")
    manifest = plan.get("fixedWorkflow", {})
    if not isinstance(manifest, dict) or manifest.get("id") != "local-pixel-fixed" or manifest.get("version") != 1 or manifest.get("sourceAssetId") != asset_id:
        raise ClientError("Unsupported fixed workflow version or source")
    dimensions = [manifest.get("width"), manifest.get("height")]
    if any(type(n) is not int or n <= 0 for n in dimensions) or dimensions[0] * dimensions[1] > 32_000_000:
        raise ClientError("Fixed manifest dimensions are invalid")
    sampling = manifest.get("sampling")
    if sampling not in ("source-center", "majority") or manifest.get("paletteBudget") != 96 or manifest.get("detailProfile") != expected_profile:
        raise ClientError("Plan differs from the requested default recipe or explicit material")
    policy = manifest.get("refinementPolicy")
    if policy not in (None, "automatic-v1") or policy == "automatic-v1" and (sampling != "source-center" or expected_profile is not None):
        raise ClientError("Unsupported automatic refinement policy")
    stages = manifest.get("stages")
    if not isinstance(stages, list) or not all(isinstance(s, dict) for s in stages) or tuple(s.get("id") for s in stages) not in (STAGES, SEGMENTATION_STAGES):
        raise ClientError("Fixed stage order does not match local-pixel-fixed/v1")
    if any(s.get("status") not in ("run", "skip") for s in stages) or review.get("generationCount") != 0:
        raise ClientError("Plan must contain only declared local stages and zero image generation")
    nodes, edges = graph.get("nodes"), graph.get("edges")
    running = [s for s in stages if s["status"] == "run"]
    if not isinstance(nodes, list) or len(nodes) != len(running) + 1 or not isinstance(edges, list) or len(edges) != len(nodes) - 1:
        raise ClientError("Graph is not the declared single fixed pipeline")
    ids = [n.get("id") for n in nodes if isinstance(n, dict)]
    if len(ids) != len(nodes):
        raise ClientError("Graph node IDs must be unique")
    for node_id in ids:
        safe_id(node_id)
    if len(set(ids)) != len(ids) or any(not isinstance(n.get("data"), dict) for n in nodes):
        raise ClientError("Graph node IDs or data are invalid")
    source = nodes[0].get("data", {})
    if source.get("role") != "asset" or source.get("assetId") != asset_id or source.get("assetIds"):
        raise ClientError("Graph source must be the one fixed saved asset")
    allowed = {"source-colors": "color-cleanup", "material-detail": "detail-refine", "color-clusters": "color-clusters", "outer-contour": "outer-contour"}
    for node, stage in zip(nodes[1:], running):
        data, params = node.get("data", {}), node.get("data", {}).get("parameters", {})
        if not isinstance(params, dict) or data.get("role") != stage.get("role") or params != stage.get("parameters"):
            raise ClientError("Graph operation differs from its fixed manifest")
        stage_id = stage["id"]
        if stage_id == "background":
            if data.get("role") != "cutout" or params.get("method") not in ("chroma", "flood", "rembg") or params.get("method") == "rembg" and params.get("model") != "birefnet-lite":
                raise ClientError("Unexpected background operation")
        elif stage_id == "grid":
            if data.get("role") != "pixel" or params.get("mode") != "strict":
                raise ClientError("Experimental grid recovery is not part of the fixed workflow")
            if params.get("sampler") != sampling or type(params.get("paletteSize")) is not int or params.get("paletteSize") != (0 if sampling == "source-center" else 256):
                raise ClientError("Grid sampling or source palette differs from the fixed manifest")
        elif stage_id in allowed:
            expected_mode = "automatic-refine" if stage_id == "outer-contour" and policy == "automatic-v1" else allowed[stage_id]
            if data.get("role") != "repair" or params.get("mode") != expected_mode:
                raise ClientError("Unexpected refinement operation")
            if stage_id == "material-detail" and params.get("profile") != expected_profile:
                raise ClientError("Material refinement must use the explicitly requested material")
            if stage_id == "source-colors":
                if "keyColorMode" in params and params["keyColorMode"] != "removed-source":
                    raise ClientError("Unsupported source cleanup key-color mode")
                if params.get("keyColorMode") == "removed-source":
                    if "keyColor" in params:
                        raise ClientError("Runtime source cleanup cannot also specify a key color")
                    if params.get("cleanKeyShades", False) is not False:
                        raise ClientError("Runtime source cleanup must preserve alpha")
                    if params.get("protectInkGrowth", True) is not True:
                        raise ClientError("Runtime source cleanup requires ink-growth protection")
            if stage_id == "source-colors" and policy == "automatic-v1" and params.get("cleanKeyShades", False) is not False:
                raise ClientError("Automatic refinement cannot delete global key-color shades before validation")
            if stage_id == "outer-contour" and policy == "automatic-v1" and params != {"mode": "automatic-refine"}:
                raise ClientError("Automatic refinement takes no client material or evidence overrides")
            if stage_id == "outer-contour" and policy is None and (expected_profile != "bamboo" or params.get("profile") != "bamboo"):
                raise ClientError("Outer contour refinement requires explicit bamboo selection")
            if stage_id == "color-clusters" and params.get("paletteBudget") != 96:
                raise ClientError("Unexpected palette budget")
        elif stage_id == "background-segmentation":
            # Optional newer-service suffix. It uses only the server's recorded
            # source evidence, after automatic refinement; no client mask or
            # alternate operation may enter this finite graph.
            outer = next(s for s in stages if s["id"] == "outer-contour")
            if policy != "automatic-v1" or outer["status"] != "run" or data.get("role") != "repair" or params != {"mode": "background-segmentation"}:
                raise ClientError("Background segmentation requires the fixed automatic suffix without client overrides")
        elif stage_id == "export":
            if data.get("role") != "export" or params.get("format") != "png" or params.get("native") is not True or params.get("scale") != 1:
                raise ClientError("Only native 1x PNG export is supported")
        else:
            raise ClientError("Unknown stage")
    if not running or running[-1]["id"] != "export" or graph.get("targetNodeId") != ids[-1]:
        raise ClientError("Fixed graph must end at the native PNG export")
    expected_edges = {(ids[i], ids[i + 1]) for i in range(len(ids) - 1)}
    if {(e.get("source"), e.get("target")) for e in edges if isinstance(e, dict)} != expected_edges:
        raise ClientError("Fixed graph connections are invalid")
    # Strip any extra server metadata before a job submission or report. Only
    # the validated source, operation params and connections are executable.
    safe_nodes = [{"id": n["id"], "data": {k: n["data"][k] for k in ("role", "assetId", "parameters") if k in n["data"]}} for n in nodes]
    return {"inspection": value.get("inspection", {}), "plan": plan, "graph": {"nodes": safe_nodes, "edges": [{"source": ids[i], "target": ids[i + 1]} for i in range(len(ids) - 1)], "targetNodeId": ids[-1]}, "review": {"generationCount": 0, "operationCount": review.get("operationCount")}}


def diagnostic_token(value):
    # Diagnostics are machine codes, not free text. Never copy paths, URLs,
    # prompts, settings or arbitrary nested proof data into the public report.
    return value if isinstance(value, str) and re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,159}", value) and clean_error(value) == value else None


def bounded_diagnostics(value, nested=True):
    if not isinstance(value, dict):
        return {}
    result = {}
    for key in ("algorithm", "sourceRuleAlgorithm", "skipReason", "projectionStatus"):
        token = diagnostic_token(value.get(key))
        if token is not None:
            result[key] = token
    if value.get("status") in ("applied", "unchanged", "skipped", "accepted", "rejected", "run", "skip"):
        result["status"] = value["status"]
    for key in DIAGNOSTIC_COUNTERS:
        count = value.get(key)
        if type(count) is int and 0 <= count <= 2**53 - 1:
            result[key] = count
    for key in DIAGNOSTIC_FLAGS:
        if type(value.get(key)) is bool:
            result[key] = value[key]
    for key in DIAGNOSTIC_HASHES:
        if isinstance(value.get(key), str) and re.fullmatch(r"[a-f0-9]{64}", value[key]):
            result[key] = value[key]
    if nested:
        for key in ("sourceRefinement", "sourceKernel", "baseRefinement"):
            fields = bounded_diagnostics(value.get(key), nested=False)
            if fields:
                result[key] = fields
    return result


def processing_summary(assets):
    stages = []
    eligible = [a for a in assets if isinstance(a, dict) and a.get("kind") in ("remove-background", "pixel", "repair-outline", "apply-palette")]
    for asset in eligible[:MAX_PROCESSING_STAGES]:
        params = asset.get("params") if isinstance(asset.get("params"), dict) else {}
        stage = {"operation": asset["kind"], "diagnostics": bounded_diagnostics(params.get("diagnostics"))}
        for source, target in (("id", "assetId"), ("parentId", "parentAssetId")):
            identifier = asset.get(source)
            if isinstance(identifier, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,180}", identifier) and clean_error(identifier) == identifier:
                stage[target] = identifier
        mode = diagnostic_token(params.get("mode"))
        if mode is not None:
            stage["mode"] = mode
        stages.append(stage)
    return {"processingStages": stages, "processingStagesTruncated": max(0, len(eligible) - MAX_PROCESSING_STAGES)}


def summary(job):
    assets = job.get("assets", [])
    return {"jobId": job["id"], "status": job.get("status"), "progress": job.get("progress"), "error": clean_error(job["error"]) if job.get("error") else None, "assetIds": [a.get("id") for a in assets if isinstance(a, dict)], "exports": [{k: e.get(k) for k in ("name", "format", "width", "height", "bytes")} for e in job.get("exports", []) if isinstance(e, dict)], **processing_summary(assets)}


def new_output(value):
    output = Path(value).expanduser().absolute()
    try:
        output.mkdir(parents=True, exist_ok=False)
    except FileExistsError:
        raise ClientError("Output directory already exists; choose a new directory") from None
    return output


def write_report(output, value):
    temporary = output / (".report-" + uuid.uuid4().hex + ".json")
    with temporary.open("x", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(str(temporary), str(output / "run-report.json"))


def wait_job(client, job_id, wait, poll_interval):
    deadline = time.monotonic() + wait
    while True:
        job = client.job(job_id)
        if job.get("status") not in ACTIVE:
            return job, False
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return job, True
        time.sleep(min(poll_interval, remaining))


def download_exports(client, job, output, dimensions=None, downloads=None):
    if job.get("status") != "succeeded":
        raise ClientError("Only succeeded jobs can be exported")
    exports = job.get("exports")
    if not isinstance(exports, list) or not exports:
        raise ClientError("Succeeded job has no saved exports")
    names = set()
    if downloads is None:
        downloads = []
    for exported in exports:
        name = exported.get("name")
        if not isinstance(name, str) or not name.lower().endswith(".png") or len(name) > 240 or name in (".", "..") or any(ord(c) < 32 or c in '<>:"/\\|?*' for c in name) or name in names or name.endswith((" ", ".")):
            raise ClientError("Unsafe or duplicate export filename")
        names.add(name)
        expected = "/api/studio/workflow/files/" + urllib.parse.quote(safe_id(job["id"]), safe="") + "/" + urllib.parse.quote(name, safe="")
        url = urllib.parse.urlsplit(exported.get("url", ""))
        if url.scheme or url.netloc or url.query or url.fragment or urllib.parse.unquote(url.path) != urllib.parse.unquote(expected):
            raise ClientError("Export URL does not belong to this job on the selected service")
        if exported.get("format") != "png":
            raise ClientError("Only PNG export is supported")
        png = client.request(expected, binary=True)
        actual = png_info(png)
        expected_size = dimensions or exported
        if actual["width"] != expected_size.get("width") or actual["height"] != expected_size.get("height"):
            raise ClientError("PNG dimensions differ from the native export record")
        target = output / name
        with target.open("xb") as handle:
            handle.write(png)
        downloads.append({"name": name, "path": str(target), **actual, "bytes": len(png), "sha256": hashlib.sha256(png).hexdigest(), "validation": "PNG structure, CRCs and dimensions; inspect pixels separately"})
    return downloads


def collect(client, job_id, output, report, wait, poll):
    report["jobId"] = job_id
    write_report(output, report)  # Durable ID exists before any wait or download.
    try:
        job, timed_out = wait_job(client, job_id, wait, poll)
        report.update(summary(job))
        if timed_out:
            report["recovery"] = "Use resume --job-id with a NEW output directory; do not submit run again"
            write_report(output, report)
            return report, 3
        if job.get("status") != "succeeded":
            report["recovery"] = "Inspect this existing job; failed/interrupted/stopped jobs are not restarted by this adapter"
            write_report(output, report)
            return report, 2
        dimensions = report.get("fixedWorkflow", {})
        report["downloads"] = []
        download_exports(client, job, output, dimensions if dimensions else None, report["downloads"])
        report["status"] = "succeeded"
        write_report(output, report)
        return report, 0
    except ClientError as error:
        report.update({"status": "collection-error", "error": clean_error(error), "recovery": "Use status or resume on this job ID; do not submit run again"})
        write_report(output, report)
        return report, 3


def parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base-url", default=DEFAULT_URL)
    p.add_argument("--allow-remote", action="store_true", help="Allow an explicitly selected non-loopback service; its own access policy still applies")
    p.add_argument("--http-timeout", type=float, default=60)
    commands = p.add_subparsers(dest="command", required=True)
    commands.add_parser("doctor", help="Read availability/capabilities without starting a workflow or downloading models")
    imp = commands.add_parser("import", help="Save a copy of a PNG in the selected service")
    imp.add_argument("--input", required=True)
    inspect = commands.add_parser("inspect", help="Read actual saved-image inspection")
    inspect.add_argument("--asset-id", required=True)
    plan = commands.add_parser("plan", help="Plan/preflight only; no job or import is created")
    plan.add_argument("--asset-id", required=True)
    plan.add_argument("--profile", choices=("foliage", "bamboo", "glass"))
    run = commands.add_parser("run", help="Import if requested, create exactly one fixed local workflow, wait and download")
    source = run.add_mutually_exclusive_group(required=True)
    source.add_argument("--asset-id")
    source.add_argument("--input")
    run.add_argument("--profile", choices=("foliage", "bamboo", "glass"))
    run.add_argument("--output", "--output-dir", dest="output")
    run.add_argument("--dry-run", action="store_true", help="Only plan a SAVED asset; --input is rejected to avoid an implicit upload")
    run.add_argument("--wait", type=float, default=300)
    run.add_argument("--poll-interval", type=float, default=1)
    status = commands.add_parser("status", help="Read one existing job without resubmitting it")
    status.add_argument("--job-id", required=True)
    for name in ("export", "resume"):
        sub = commands.add_parser(name, help="Collect an existing job; never POST the server's generation-resume endpoint")
        sub.add_argument("--job-id", required=True)
        sub.add_argument("--output", "--output-dir", dest="output", required=True)
        if name == "resume":
            sub.add_argument("--wait", type=float, default=300)
            sub.add_argument("--poll-interval", type=float, default=1)
    return p


def execute(args):
    client = StudioClient(args.base_url, args.allow_remote, args.http_timeout)
    if args.command == "doctor":
        caps = client.request("/api/studio/process")
        # This capability-only endpoint does not read provider settings,
        # prompts, projects or the asset library.
        return {"reachable": True, "service": client.base_url, "capabilities": {key: value for key, value in caps.items() if isinstance(value, bool)}, "models": {key: value for key, value in caps.get("models", {}).items() if isinstance(value, bool)} if isinstance(caps.get("models"), dict) else {}, "requiredRecipe": "local-pixel-fixed/v1", "note": "Use plan on a saved asset to verify the preparation API version"}, 0
    if args.command == "import":
        return client.import_png(args.input), 0
    if args.command == "inspect":
        return {"inspection": client.inspect(args.asset_id)}, 0
    if args.command == "plan":
        return {**client.plan(args.asset_id, args.profile), "jobSubmitted": False}, 0
    if args.command == "status":
        return summary(client.job(args.job_id)), 0
    wait, poll = getattr(args, "wait", 0), getattr(args, "poll_interval", 1)
    if wait < 0 or poll <= 0:
        raise ClientError("Wait must be nonnegative and poll interval must be positive")
    if args.command in ("export", "resume"):
        output = new_output(args.output)
        return collect(client, safe_id(args.job_id), output, {"service": client.base_url, "resubmitted": False}, wait, poll)
    if args.dry_run:
        if args.input:
            raise ClientError("Dry-run does not upload files; use import explicitly, then plan --asset-id")
        return {**client.plan(args.asset_id, args.profile), "jobSubmitted": False}, 0
    if not args.output:
        raise ClientError("run requires --output unless --dry-run is selected")
    output = new_output(args.output)
    report = {"service": client.base_url, "status": "preparing", "jobSubmitted": False}
    write_report(output, report)
    try:
        imported = client.import_png(args.input) if args.input else None
        asset_id = imported["assetId"] if imported else safe_id(args.asset_id)
        prepared = client.plan(asset_id, args.profile)
        manifest, graph = prepared["plan"]["fixedWorkflow"], prepared["graph"]
        report.update({"sourceAssetId": asset_id, "import": imported, "fixedWorkflow": manifest, "warnings": prepared["plan"].get("warnings", []), "status": "submitting"})
        write_report(output, report)
        try:
            started = client.request("/api/studio/workflow", {"nodes": graph["nodes"], "edges": graph["edges"], "targetNodeIds": [graph["targetNodeId"]]})
            job_id = safe_id(started.get("jobId"))
        except ClientError as error:
            report.update({"status": "submission-outcome-unknown", "error": clean_error(error), "recovery": "Do not resubmit automatically. Check Pixel Studio job history for a job created from this saved source."})
            write_report(output, report)
            return report, 3
        report["jobSubmitted"] = True
        return collect(client, job_id, output, report, wait, poll)
    except ClientError as error:
        report.update({"status": "preparation-error", "error": clean_error(error)})
        write_report(output, report)
        return report, 2


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        result, code = execute(args)
    except (ClientError, OSError, ValueError) as error:
        result, code = {"error": clean_error(error)}, 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return code


if __name__ == "__main__":
    sys.exit(main())
