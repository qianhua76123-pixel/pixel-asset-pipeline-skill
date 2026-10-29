---
name: pixel-asset-pipeline
description: Prepare saved AI-generated PNG sprites with a fixed local pixel workflow or an existing Pixel Studio service. Use for strict pixel grids, background removal, foliage/bamboo/glass refinement, color-cluster cleanup, and native PNG export. Terrain production is reference-only; image generation is not included.
---

# Pixel Asset Pipeline

Turn a saved image into a native PNG sprite with an auditable, bounded workflow. Run the provided scripts rather than replacing the algorithms with an improvised resize or repeated smoothing.

## Choose an execution mode

| Mode | Use when | Requirements |
|---|---|---|
| Local | Transparent input, verified chromatic background, or an explicitly supplied color key | Node.js 22+ and this skill's dependencies |
| Studio | Semantic background removal or recorded source-lineage cleanup is needed | Python 3.9+ and an existing compatible Pixel Studio service, normally `http://127.0.0.1:3410` |

The local engine is self-contained. The Studio adapter is a client, not a bundled application or ML model. A failed background check is not permission to erase white/gray foreground or silently choose a model. Use Studio when available, or request a prepared transparent input.

Read [execution.md](references/execution.md) for commands and recovery. Run `doctor` for the chosen mode first. Install local dependencies with `npm ci --omit=dev` in this skill directory when needed. No image-generation credentials or model weights are included.

## Fixed sprite workflow

1. Inspect the saved file and choose its logical size. Preserve the complete frame and padding. `--native` means one file pixel per logical pixel; it does not detect a hidden AI pixel grid.
2. Process background, strict grid, evidence-based source-color cleanup, explicit material, fixed-budget color clusters, bamboo outer contour, then native PNG export. Each stage records **run** or **skip** and its reason. Do not fabricate evidence to force a stage to run.
3. Default color budget is 96. Explicit 64 is a different color decision, not a guarantee of exactly 64 colors. Distant original colors can remain to protect detail.
4. Use `foliage`, `bamboo`, or `glass` when the user or asset contract identifies the material; otherwise use generic/default. Bamboo contour runs once and permits bounded silhouette changes. Other material stages only change RGB.
5. Do not feed a completed result recursively through inference. Local completion requires a matching sidecar and file hash; keep the sidecar with the PNG. Without it, return to the original saved source instead of trusting a filename. Studio uses saved lineage and diagnostics.

Example, for an already native transparent bamboo sprite:

```sh
node "<skill-dir>/scripts/pixel_local.mjs" run \
  --input chair.png --output-dir runs/chair --native --material bamboo
```

For a complex background, inspect and plan through Studio first:

```sh
python3 "<skill-dir>/scripts/pixel_studio.py" doctor
python3 "<skill-dir>/scripts/pixel_studio.py" plan --asset-id <saved-asset-id> --profile bamboo
```

Studio `run` submits one job. On timeout or unknown outcome, retain its job ID and use `status`/`resume`; do not submit a replacement to recover a download. Do not rerun upstream image generation. Non-loopback access requires both the explicit remote option and authorization to send that chosen image to that destination.

## Verify the deliverable

Read the actual exported PNG and report. Verify dimensions, hard alpha, transparent RGB zero, frame/padding, and important holes and thin structures. Compare at native or integer nearest-neighbor zoom. Report actual algorithms, changed stages, skipped stages, uncertain repairs, and material limits.

Open the final image with the host's image-viewing tool when available. Passing pixel and topology checks establishes technical properties, not hand-drawn quality. Do not claim cyan/purple spill, uneven outlines or semantic details are all repaired without inspection. Preserve input files and use fresh output directories.

For tile textures or terrain atlases, read [terrain.md](references/terrain.md) first. Automatic object cutout and independent contour repair are unsuitable terrain defaults. This release does not implement seam validation, terrain topology generation, or Godot `.tres` export.
