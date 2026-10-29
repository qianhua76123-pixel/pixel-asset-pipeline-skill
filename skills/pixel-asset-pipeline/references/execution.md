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

Default longest side is256, without enlargement. `--size N` sets a longest-side limit; `--size WxH` sets a contain canvas. `--native` preserves file-pixel dimensions. These do not recover an unknown AI grid. `--palette` accepts96/default or64; `--material` accepts generic/foliage/bamboo/glass.

Successful runs write `sprite.png`, `sprite.png.pixel.json`, and `manifest.json` into a new output directory. Keep the hash-bound sidecar beside the PNG for the completion guard. A completed result with matching settings is exported without new inference. Changed settings must be applied to the original source. Check actual stage statuses; not every stage necessarily executes.

## Pixel Studio adapter

Requires Python 3.9+ and an already-running compatible Pixel Studio exposing `/api/studio/assets/<id>/preparation` with fixed workflow `local-pixel-fixed/v1`. This repository does not install its UI, model weights, provider keys or database. The client can use the application's configured local semantic background model; it never submits image generation.

```sh
python3 "<skill-dir>/scripts/pixel_studio.py" doctor
python3 "<skill-dir>/scripts/pixel_studio.py" import --input original.png
python3 "<skill-dir>/scripts/pixel_studio.py" inspect --asset-id <asset-id>
python3 "<skill-dir>/scripts/pixel_studio.py" plan --asset-id <asset-id> --profile bamboo
python3 "<skill-dir>/scripts/pixel_studio.py" run \
  --input original.png --output-dir runs/studio --profile bamboo
python3 "<skill-dir>/scripts/pixel_studio.py" status --job-id <job-id>
python3 "<skill-dir>/scripts/pixel_studio.py" resume --job-id <job-id> --output-dir runs/recovered
```

`inspect` is read-only. `plan` creates no job; importing creates a saved asset. `run --input` imports and submits one job. `run --asset-id <id> --dry-run` only plans; dry-run rejects `--input` to avoid implicit import. Use `export` to download an already-completed job and `resume` to wait for an existing job; neither restarts it.

Global `--base-url`, `--allow-remote`, `--http-timeout` precede the subcommand. Non-loopback URLs require `--allow-remote`; this flag is a technical guard, not consent to upload a private file. Keep provider credentials in the application's own configuration; do not scrape settings or commit them here.

`run-report.json` records source hashes, manifest, job ID and downloaded files. Exit0 means completion,2 means failure or bad arguments,3 means a job is pending or its submission outcome is unknown. Use the saved ID to inspect/recover. Ctrl+C does not automatically cancel a server job. Unknown submission outcomes must not be retried automatically. Graphs containing generation or experimental grid stages are rejected.

## Interpreting output

- JSON success is not an art-quality score. Inspect the final image.
- Palette budget is not a hard color-count cap; original-color fallback preserves distant details.
- Source cleanup can skip when source registration/background evidence is missing.
- Hard alpha and canonical transparent RGB do not establish a correct silhouette.
- Bamboo contour may add/remove pixels within its bounded rules; inspect holes, thin structures and anchors separately.
- Preserve the original and older versions for meaningful comparison.
