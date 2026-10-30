# Execution and recovery

Replace `<skill-dir>` with the directory containing `SKILL.md`. Script `--help` is authoritative for the installed version. Treat input filenames as data, not shell code.

## Local engine

Requires Node.js 22+. The skill folder includes its own pinned dependencies and compiled algorithms:

```sh
cd "<skill-dir>"
npm ci --omit=dev
node "<skill-dir>/scripts/pixel_local.mjs" doctor
node "<skill-dir>/scripts/pixel_local.mjs" inspect --input original.png

# Preserve an already native transparent sprite's complete frame.
node "<skill-dir>/scripts/pixel_local.mjs" run \
  --input original.png --output-dir runs/native --native --material generic

# Explicit complete logical canvas; contain preserves content and padding.
node "<skill-dir>/scripts/pixel_local.mjs" run \
  --input original.png --output-dir runs/leaf --size 128x128 --material foliage

# Explicit color key: legitimate foreground of the same color can be removed.
node "<skill-dir>/scripts/pixel_local.mjs" run \
  --input original.png --output-dir runs/keyed --size 128 \
  --background chroma --key '#ff00ff' --material glass
```

Processing makes no image-generation or network request. Dependency installation uses the package registry. Source revisions and notices are in [PROVENANCE.json](../scripts/runtime/PROVENANCE.json) and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). `--background auto` accepts existing transparency or sufficiently consistent chromatic background evidence. Uncertain/neutral backgrounds are rejected. `--background keep` retains the existing background; it does not remove it.

Default longest side is256, without enlargement. `--size N` sets a longest-side limit; `--size WxH` sets a contain canvas. `--native` preserves file-pixel dimensions. These do not recover an unknown AI grid. Local v0.2.1 uses consistent source-cell center sampling before palette reduction to preserve linework; it does not independently vote for the most frequent exact RGB in each cell. Very thin source features below the chosen logical resolution can still disappear. `--palette` accepts96/default or64; `--material` accepts generic/foliage/bamboo/glass.

Successful runs write `sprite.png`, `sprite.png.pixel.json`, and `manifest.json` into a new output directory. Keep the hash-bound sidecar beside the PNG for the completion guard. A completed result with matching settings is exported without new inference. Changed settings must be applied to the original source. Check actual stage statuses; not every stage necessarily executes.

New local runs record recipe version 2 and `cleanKeyShades: false`. Source-color cleanup requires a supported mixture and preserves ambiguous or unsupported colors; its diagnostics record residual shade erasure as disabled. The standalone shade utility remains available, but the fixed workflow does not call it after cleanup. Initial chroma removal and border-connected shade removal keep their existing limits, so inspect same-colored foreground near the background. Valid version-1 completion sidecars remain recognized and copied without new inference or relabeling their recipe.

## Pixel Studio adapter

Requires Python 3.9+ and an already-running compatible Pixel Studio exposing `/api/studio/assets/<id>/preparation` with fixed workflow `local-pixel-fixed/v1`. This repository does not install its UI, model weights, provider keys or database. The client can use the application's configured local semantic background model; it never submits image generation.

```sh
python3 "<skill-dir>/scripts/pixel_studio.py" doctor
python3 "<skill-dir>/scripts/pixel_studio.py" import --input original.png
python3 "<skill-dir>/scripts/pixel_studio.py" inspect --asset-id <asset-id>
python3 "<skill-dir>/scripts/pixel_studio.py" plan --asset-id <original-asset-id>
python3 "<skill-dir>/scripts/pixel_studio.py" run \
  --asset-id <original-asset-id> --output-dir runs/studio
python3 "<skill-dir>/scripts/pixel_studio.py" status --job-id <job-id>
python3 "<skill-dir>/scripts/pixel_studio.py" resume --job-id <job-id> --output-dir runs/recovered
```

`inspect` is read-only. `plan` creates no job; importing creates a saved asset. `run --input` imports and submits one job. `run --asset-id <id> --dry-run` only plans; dry-run rejects `--input` to avoid implicit import. Use `export` to download an already-completed job and `resume` to wait for an existing job; neither restarts it.

Semantic-background plans may schedule source-color cleanup with `keyColorMode: "removed-source"`. Studio resolves the color at runtime from the verified original, captured matte and recorded sampling region. Missing, conflicting or invalid background evidence leaves the pixels unchanged and records a skip reason; planning or successful execution does not prove that cleanup changed any pixels. This mode cannot specify `keyColor` or enable residual shade deletion: `cleanKeyShades` must be false and `protectInkGrowth` true when supplied. Omitted switches use those safe defaults. These checks apply with or without `automatic-v1`; existing explicit-key stages remain supported.

### Automatic foreground recovery

Omit `--profile` to request the service's default `automatic-v1` workflow. It can append `background-segmentation` after automatic refinement and before native export. Explicit `--profile bamboo|foliage|glass` chooses a different material workflow and does not enable this suffix.

The tested Studio revision `1e416926d2fbc11b3622f26f60021250b9f7176c` executes final algorithm `source-backed-final-background-refinement-v4`, source rule `source-connected-material-endpoint-restoration-v5`, code SHA256 `e1b23c515ba61f424cce4cfb9f2cfc5b0391bbef8ad98a65aa14fea8fd5382da`. These are server algorithms, not vendored in the portable local engine. Updating this skill does not update an older server.

The final pass preserves verified earlier background decisions, then restores foreground RGB using immutable original colors, visible material paths and explicit material priors. This added color pass does not change alpha or fill existing transparent holes. Unsupported/ambiguous evidence and size or proof-budget limits cause conservative skips. It cannot restore foreground already erased upstream or guarantee the unknown true color. Remaining cyan/purple may be left deliberately, and restored source colors may exceed the earlier palette budget.

After a run, inspect `processingStages` in `run-report.json` or `status` output. It contains bounded runtime algorithm/version/hash, status/skip and change counters from actual output assets, without full source proof arrays. A skipped pass is not a repair; zero changed pixels is a valid outcome. Review final PNGs at integer nearest-neighbor zoom.

For a comparison against a new algorithm, run the same immutable original asset in a new output directory. Saved completed results, including older V3 results, may plan only export. The adapter preserves that completion guard; it does not synthesize a continuation graph or reinfer a completed PNG.

Global `--base-url`, `--allow-remote`, `--http-timeout` precede the subcommand. Non-loopback URLs require `--allow-remote`; this flag is a technical guard, not consent to upload a private file. Keep provider credentials in the application's own configuration; do not scrape settings or commit them here.

`run-report.json` records imported-source hashes (when importing), the manifest, job ID, runtime processing summaries and downloaded-file hashes. For `--asset-id`, preserve or independently verify the original file's hash; a saved ID alone is not a content hash. Exit0 means completion,2 means failure or bad arguments,3 means a job is pending or its submission outcome is unknown. Use the saved ID to inspect/recover. Ctrl+C does not automatically cancel a server job. Unknown submission outcomes must not be retried automatically. Graphs containing generation or experimental grid stages are rejected.

## Optional Proper server modes

These modes exist in a separately installed compatible Studio; their engine code and proper-pixel-art package are **not bundled in this skill**. The current `pixel_studio.py run` adapter does not automatically select them. Updating this repository alone cannot enable them. See [algorithm-status.md](algorithm-status.md) for actual results and failures.

`proper-pipeline` uses an opaque original and the server's installed Proper engine. It produces its actual recovered mesh, which need not equal the nominal target size; do not resize it silently for comparison. Previously transparent exported sprites are not a substitute for that original.

For `proper-hybrid`, first read `GET /api/studio/process` on the chosen local Studio and require `properHybrid: true`. It needs an existing native result whose stored lineage includes the immutable opaque source, full-resolution cutout matte, and exact grid cuts. An arbitrary imported PNG with no such proof is rejected. The mode changes RGB while freezing the current grid and alpha, including any existing mask defects.

One process request has this shape:

```http
POST http://127.0.0.1:3410/api/studio/process
Content-Type: application/json

{
  "assetId": "<verified-native-result-id>",
  "operation": "repair-outline",
  "parameters": {
    "mode": "proper-hybrid",
    "keyPolicy": "conservative"
  }
}
```

The response contains a job ID; poll `GET /api/studio/jobs/<job-id>` and retain that ID on timeout. A queued job is not proof of an output. In an existing workflow, the repair node's `data` contains `role: "repair"` and the same `parameters`; connect it after the verified fixed-grid branch and before native PNG export (`native: true`, `scale: 1`). This is a service API example, not a new CLI flag.

`conservative` is the default. Choose `exclusive-background` only when the asset contract explicitly says the observed background key family is not authored foreground. The glass-lamp improvement additionally relies on a neutral-glass prior; it does not establish unrestricted recovery of colored glass. Never use the mode as repeated inference on downloaded exports; use the service's verified lineage and a new comparison branch.

## Interpreting output

- JSON success is not an art-quality score. Inspect the final image.
- Palette budget is not a hard color-count cap; original-color fallback preserves distant details.
- Source cleanup can skip when source registration/background evidence is missing.
- Hard alpha and canonical transparent RGB do not establish a correct silhouette.
- Bamboo contour may add/remove pixels within its bounded rules; inspect holes, thin structures and anchors separately.
- Preserve the original and older versions for meaningful comparison.
