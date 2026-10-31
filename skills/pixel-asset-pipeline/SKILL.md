---
name: pixel-asset-pipeline
description: Generate pixel-art source images with nano-banana-2 or a custom Images/Gemini API, then prepare sprites with a fixed local workflow or Pixel Studio's recorded-source background and foreground-color recovery. Use for generation, strict grids, cutout, refinement and native PNG export. Terrain production is reference-only.
---

# Pixel Asset Pipeline

Generate a new source or turn a saved image into a native PNG sprite with an auditable workflow. Run the provided scripts rather than replacing the algorithms with an improvised resize or repeated smoothing.

## Generate and prepare

For a new asset, read [generation.md](references/generation.md). `pixel_workflow.mjs run` generates once, freezes the source, then runs the fixed recipe. Its default model is exactly `nano-banana-2`; availability and billing depend on the selected provider. Do not silently substitute another model.

Use a saved Studio connection when available: `pixel_generate.mjs providers` reads public connection metadata without retrieving keys. Other AI hosts can use a custom OpenAI Images-compatible or Gemini API with a named environment variable. Credentials are never CLI values or bundled settings. This skill supports AI hosts with local file and command access; a normal web chat does not gain those capabilities from the skill.

Choose `--processor local` for portable processing. Default sprite prompting requests a uniform magenta backing; actual background evidence is still checked. Choose `--processor studio` for semantic cutout through a ready service; it preflights Python and the local model before generation. `--size` describes the logical sprite canvas, while `--api-size` is the source API resolution. Keep the generated source and all reports. A successful generation is not a completed export.

Use `resume --output-dir EXISTING_RUN` after a timeout. It collects the saved generation or processing job and never resubmits generation. An unknown submission outcome requires checking provider/server history. Do not rerun `run` merely to recover files.

## Choose an execution mode

| Mode | Use when | Requirements |
|---|---|---|
| Local | Transparent input, verified chromatic background, or an explicitly supplied color key | Node.js 22+ and this skill's dependencies |
| Studio | Semantic background removal or recorded source-lineage cleanup is needed | Python 3.9+ and an existing compatible Pixel Studio service, normally `http://127.0.0.1:3410` |

The local engine is self-contained. The Studio adapter is a client, not a bundled application or ML model. A failed background check is not permission to erase white/gray foreground or silently choose a model. Use Studio when available, or request a prepared transparent input.

For the software's default automatic hole separation and contaminated-foreground color recovery, use **Studio without `--profile`**. On the tested service this runs `source-backed-final-background-refinement-v4`, including `source-connected-material-endpoint-restoration-v5`. The portable local recipe does not include this pass. Check the actual `processingStages` in `run-report.json`; a running server or a planned stage alone does not establish which algorithm executed.

Read [algorithm-status.md](references/algorithm-status.md) for the frozen evaluation, failure cases and preservation limits. Optional `proper-pipeline` and `proper-hybrid` are separate Studio server modes, not vendored local algorithms or automatic CLI upgrades. Use only a service that advertises the capability, with verified source lineage. `exclusive-background` requires an explicit asset contract reserving the key-color family for the backing; never silently assume legitimate cyan or magenta is contamination. See [optional server modes](references/execution.md#optional-proper-server-modes).

For an existing source, read [execution.md](references/execution.md) for commands and recovery. Run `doctor` for the chosen mode first. Install local dependencies with `npm ci --omit=dev` in this skill directory when needed. No credentials or model weights are included.

## Fixed sprite workflow

1. Inspect the saved file and choose its logical size. The default keeps the complete frame and padding. `--crop` trims to the subject box first, then fits that box into `--size WxH` without a 256px detour. `--native` means one file pixel per logical pixel. `--grid auto` estimates phase only when the source is already a nearest-neighbor pixel lattice; otherwise phase stays 0.
2. Process background, grid, evidence-based source-color cleanup, explicit material, hard color clusters, bamboo outer contour, then native PNG export. The default grid reads coverage in each source cell and keeps the median of the heaviest color bucket. It does not blend the two sides of an edge into a new color, and it does not read only the center pixel. `--sampler center` or `--keyer classic` restores the v0.2 path for comparison. Each stage records **run** or **skip** and its reason. Do not fabricate evidence to force a stage to run.
   Local recipe 3 removes border-connected key-hue fringe, then despills remaining edge pixels from the nearest non-key color. A solid interior blob of that hue can remain. Global residual hue erasure after source cleanup stays off. A subject painted only in the key color cannot be separated from the backing. Inspect the actual output.
3. Default palette ceiling is 24. It is a hard cap: extra shades stop once they are closer than about ΔE 8, so a sprite often uses fewer colors. `--palette-file` loads `.hex` or `.gpl` and locks every opaque pixel in CIE Lab (luminance weight 1.25). `--sampler center --keyer classic --palette 96` is the previous soft 96-color budget.
4. In local or explicit-material mode, use `foliage`, `bamboo`, or `glass` when the user or asset contract identifies the material; otherwise use generic/default. Bamboo contour runs once and permits bounded silhouette changes. Other material stages only change RGB. Studio's default automatic recovery uses no profile override.
5. Do not feed a completed result recursively through inference. Local completion requires a matching sidecar and file hash; keep the sidecar with the PNG. Without it, return to the original saved source instead of trusting a filename. Studio uses saved lineage and diagnostics.
   Valid recipe-1 completions remain export-only and retain their original recipe proof when copied.

Example, for an already native transparent bamboo sprite:

```sh
node "<skill-dir>/scripts/pixel_local.mjs" run \
  --input chair.png --output-dir runs/chair --native --material bamboo
```

For a complex background, inspect and plan through Studio first:

```sh
python3 "<skill-dir>/scripts/pixel_studio.py" doctor
python3 "<skill-dir>/scripts/pixel_studio.py" plan --asset-id <original-asset-id>
python3 "<skill-dir>/scripts/pixel_studio.py" run \
  --asset-id <original-asset-id> --output-dir runs/automatic
```

Explicit `--profile bamboo|foliage|glass` selects the separate material workflow. It is not a way to enable the default automatic recovery. For a new algorithm comparison, start from the immutable original asset; completed saved results may plan export-only, including older completed versions. Do not manufacture an upgrade graph or rerun inference on an exported PNG.

Studio `run` submits one job. On timeout or unknown outcome, retain its job ID and use `status`/`resume`; do not submit a replacement to recover a download. Do not rerun upstream image generation. Non-loopback access requires both the explicit remote option and authorization to send that chosen image to that destination.

## Verify the deliverable

Read the actual exported PNG and report. Verify dimensions, hard alpha, transparent RGB zero, frame/padding, and important holes and thin structures. Compare at native or integer nearest-neighbor zoom. Report actual algorithms, changed stages, skipped stages, uncertain repairs, and material limits.

Open the final image with the host's image-viewing tool when available. Passing pixel and topology checks establishes technical properties, not hand-drawn quality. Do not claim cyan/purple spill, uneven outlines or semantic details are all repaired without inspection. Preserve input files and use fresh output directories.

For tile textures or terrain atlases, read [terrain.md](references/terrain.md) first. Automatic object cutout and independent contour repair are unsuitable terrain defaults. This release does not implement seam validation, terrain topology generation, or Godot `.tres` export.
