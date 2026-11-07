# Generate, prepare and recover

Requires Node.js 22+ and this skill's dependencies. In the directory containing `SKILL.md`, run `npm ci --omit=dev` once. Commands print JSON. Source artwork and keys are not bundled; your provider controls model access and billing. `nano-banana-2` is sent exactly as named, without alias replacement.

## Use a saved Pixel Studio connection

Keep keys in the application's Settings. These commands read only public connection metadata and invoke the existing generation API:

```sh
node "<skill-dir>/scripts/pixel_generate.mjs" doctor --mode studio
node "<skill-dir>/scripts/pixel_generate.mjs" providers --mode studio

node "<skill-dir>/scripts/pixel_workflow.mjs" run \
  --mode studio --provider-id <saved-connection-id> --model nano-banana-2 \
  --prompt-file brief.txt --processor local --size 256x256 \
  --material bamboo --output-dir runs/new-basket
```

This uses the saved connection's URL and key but overrides this request's model. It does not change the saved connection. The selected connection must actually serve that model. Default Studio URL is `http://127.0.0.1:3410`; use `--base-url` to select another origin. Non-loopback Studio access also requires `--allow-remote` and authorization to transmit the selected prompt/artwork there.

## Ordered reference images through Studio

Use an existing Studio asset ID for each image. Repeat `--reference-asset-id` in the intended order (up to 8 unique IDs); the first image can be the character mother template and subsequent images clothing or style references. This CLI does not import local image paths. Import them once through Studio, retain the returned IDs, then use those IDs here.

```sh
node "<skill-dir>/scripts/pixel_generate.mjs" generate \
  --mode studio --provider-id <saved-connection-id> --model nano-banana-2 \
  --reference-asset-id <mother-template-id> \
  --reference-asset-id <clothing-reference-id> \
  --aspect-ratio 2:1 --resolution 1K \
  --prompt-file walk-brief.txt --output-dir runs/new-reference-source

node "<skill-dir>/scripts/pixel_workflow.mjs" run \
  --mode studio --provider-id <saved-connection-id> --model nano-banana-2 \
  --reference-asset-id <mother-template-id> \
  --reference-asset-id <clothing-reference-id> \
  --aspect-ratio 2:1 --resolution 1K --style none \
  --prompt-file walk-brief.txt --processor local --size 192x96 \
  --output-dir runs/new-reference-walk
```

The selected saved connection must serve the exact requested model; substitute its actual model explicitly when appropriate. The default remains `nano-banana-2`; no saved connection or model is changed. Studio sends OpenAI-compatible references to `/images/edits` as ordered `image[]` parts, or Gemini references as ordered inline image parts. Provider support for that edit endpoint is still required. Direct `--mode api` currently supports **text-only generation** and rejects reference asset IDs before any request; it does not silently discard them or implement direct API image edits.

Before submitting, the CLI reads each saved reference PNG and records its asset ID, SHA-256, width and height in `generation.json.references`. No credentials or image data are placed in that lineage. Reference IDs are also retained in `workflow.json.config.referenceAssetIds`. Recovery uses the saved job/result and retains that lineage: it does not import images, reload references, change reference IDs, or submit another generation request. Use `resume --output-dir EXISTING_DIRECTORY` only.

For a four-column, two-row sheet of 48×48 frames, `--size 192x96` describes the **entire sheet**, not one frame; `--aspect-ratio 2:1` requests its true ratio. Images API generic source presets are 1536×768 / 2048×1024 / 4096×2048 for 1K / 2K / 4K; Studio owns any model-specific mapping. `--style none` avoids the single-object boilerplate, so the supplied brief must state frame order, count, anchors, padding, background and palette explicitly. This workflow does not infer or repair frame boundaries, foot anchors or eight distinct poses. Preserve the whole source canvas and inspect every frame; do not crop individual frames or substitute 16:9 for 2:1. Reference conditioning alone does not establish a reusable rig.

## Use a custom API without Studio

Provide the credential in the process environment, using your host's secret mechanism. The default variable is `PIXEL_IMAGE_API_KEY`; `--api-key-env` selects another variable by **name**, never its value. Do not paste a real key into a command, prompt, config committed to Git, or a screenshot.

```sh
node "<skill-dir>/scripts/pixel_generate.mjs" doctor \
  --mode api --protocol openai --base-url https://your-provider.example/v1

node "<skill-dir>/scripts/pixel_workflow.mjs" run \
  --mode api --protocol openai --base-url https://your-provider.example/v1 \
  --api-key-env PIXEL_IMAGE_API_KEY --model nano-banana-2 \
  --prompt-file brief.txt --processor local --size 256x256 \
  --material bamboo --output-dir runs/custom-basket
```

- `openai` means Images-compatible `POST <base-url>/images/generations` with `model/prompt/n:1/size`. It accepts `data[].b64_json` or `data[].url`. An arbitrary chat/completions endpoint is not supported.
- `gemini` means `POST <base-url>/models/<model>:generateContent`, image modalities and inline image response. Example base: `https://generativelanguage.googleapis.com/v1beta`. Set `--model` to the **exact identifier your endpoint accepts**; native Google identifiers may differ from a relay's `nano-banana-2` alias. [Google image API contract](https://ai.google.dev/gemini-api/docs/generate-content/image-generation).
- Remote custom APIs require HTTPS. Model availability, account permissions, size presets and quota remain provider-specific. This client does not discover or create credentials.

`--size` is the final logical canvas or longest-side limit, default256. `--api-size 1024x1024` is the generated source size for Images-compatible APIs. Gemini and Studio use `--aspect-ratio` and `--resolution` (`1K/2K/4K`). Changing source resolution does not increase final sprite dimensions.

## Pick processing deliberately

`--processor local` is independently runnable. The default `--style sprite` appends a complete-object pixel-art brief and uniform magenta backing. The program still measures the actual background; it refuses unsafe neutral backgrounds rather than deleting white or gray foreground. `--background chroma --key '#ff00ff'` is an explicit key decision. Matching legitimate foreground can also be removed, so inspect the source. Use `--style none` only when supplying your own complete brief.

`--processor studio` uses the existing semantic cutout and fixed preparation API. Requires Python3.9+ plus a ready compatible Studio and BiRefNet model; `run` checks them before generation. Select the processor with `--studio-url` (defaults to local port3410). In Studio generation mode, logical `--size WxH` is recorded as the generation standard so the fixed preparation can use it. Imported custom API images use Studio's inspected plan and may choose a different logical size. Palette/key overrides belong to the local processor. Set `PIXEL_PYTHON` only when a different Python executable is needed.

Processing keeps the established order: background → strict grid → source-evidence cleanup → explicit material → color clusters → bamboo contour when requested → native export. It does not smooth or repeatedly process a finished sprite. Background preparation before grid sampling prevents the color key being averaged into the foreground.

Local v0.3 samples each original cell by coverage and a dominant-bucket median, then applies the palette. This avoids both a single noisy center pixel and an average of two different sides. `--sampler center` still reads one consistent source position when that comparison is needed. The Studio processor uses its server's own recorded sampler; updating this portable skill does not change an older service's processing algorithms. Use the local processor for a verified chroma backing.

## Files and recovery

A run creates `workflow.json`, `generation/generation.json`, the frozen `generation/source.png`, and a `prepare-N` bundle containing the exported PNG and processing report. A local bundle also includes the hash-bound `.pixel.json` sidecar. Keep the entire run directory.

```sh
# Continue the SAME run; no new generation request.
node "<skill-dir>/scripts/pixel_workflow.mjs" resume --output-dir runs/new-basket

# Generation alone, if no preparation is requested.
node "<skill-dir>/scripts/pixel_generate.mjs" generate \
  --mode studio --provider-id <saved-id> --model nano-banana-2 \
  --prompt-file brief.txt --output-dir runs/source-only

node "<skill-dir>/scripts/pixel_generate.mjs" status --output-dir runs/source-only
node "<skill-dir>/scripts/pixel_generate.mjs" resume --output-dir runs/source-only
```

Never repeat `run`/`generate` to recover a timeout. Studio recovery only queries the known job and downloads its saved image; it does not POST the server's generation-resume action. If submission outcome is unknown and no job ID is known, inspect server/provider history. A synchronous API timeout has no generic job recovery protocol.

For API media-URL download recovery, a minimal returned descriptor is encrypted using the same environment key; keep that key available until collection finishes. API credentials are not written to reports. Do not publish a whole run directory: it contains your prompts, artwork and private recovery artifacts.

Passing native-size, hard-alpha and hash checks establishes technical export properties. It does not prove hand-drawn quality, all intentional holes or semantic correctness. Open the actual PNG at integer nearest-neighbor zoom before accepting it.
