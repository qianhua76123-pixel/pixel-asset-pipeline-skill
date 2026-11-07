# Protect a frozen mother template while applying a garment

`pixel_garment.mjs` is a local, deterministic application step. It accepts a frozen mother PNG, a candidate garment rendering and an explicitly authored edit-region mask. It does not generate artwork or fit a garment to an animation.

```sh
node "<skill-dir>/scripts/pixel_garment.mjs" apply \
  --base mother-native.png \
  --proposal garment-proposal-native.png \
  --edit-mask clothing-region-native.png \
  --output-dir runs/garment-one
```

The three inputs must have exactly the same native canvas dimensions. One PNG pixel is treated as one logical pixel; the command does not infer an AI pixel grid. It never rescales, crops, recenters, samples, quantizes, repairs alpha or expands the mask. Use static 8-bit PNGs with alpha values only 0 or 255. ICC-tagged or orientation-transformed files are rejected to avoid changing protected colors. Each input is limited to 40 MiB and 1,048,576 pixels. Keep the entire animation sheet, its padding and its frame origins unchanged.

The mask uses **alpha only**: 255 permits an edit; 0 protects the mother. RGB values in the mask have no meaning. A fully opaque black/white image therefore selects every pixel; black is not automatically interpreted as “protected.” An empty mask is rejected.

Every selected pixel must be opaque in the mother and in the proposal. The first version supports only an existing silhouette and cannot add a wider sleeve, skirt, hat or hair beyond it. A gap in the proposed garment is an error, not permission to erase body pixels. Proposal changes outside the mask are ignored.

The output directory must be new. The command writes:

- `garment-layer.png`: proposal pixels inside the edit mask; transparent black everywhere else.
- `composite.png`: the layer applied to a copy of the mother. Outside the edit mask, every decoded 8-bit RGBA byte remains identical to the mother. The entire alpha silhouette remains identical as well. PNG compression bytes are not a per-pixel comparison.
- `report.json`: dimensions; input file and decoded RGBA SHA-256 hashes; the original mother's `sourceSha256`; output hashes; `maskedPixels`, `changedPixels`, `protectedPixels`, `protectedChanged: 0` and `silhouetteChanged: 0`.

The program decodes its newly encoded PNGs and verifies these guarantees before writing the bundle. It never changes the source files. If writing is interrupted, preserve the partial output for inspection and select a fresh output directory; a partial directory without a complete report is not a successful bundle.

Both output PNGs carry a provenance marker. They cannot be fed back as `--base`, including after copying or renaming. New variants must start from the same frozen original mother. Do not strip metadata to bypass this guard; the marker is an ordinary provenance safeguard, not tamper-proof authentication.

## What this mask means

An **edit-region mask** grants permission to replace specific pixels in an existing native canvas. It does not describe which skin or hair to hide at runtime, which palette colors to dye, or how cloth should deform. Those are separate visibility/occlusion and recoloring masks or animation data. It is not a skeletal binding, mesh weight map, UV map, pose generator or clothing geometry generator.

The program cannot identify faces, hands or feet. They remain protected only if the authored mask excludes them. Review that mask at integer nearest-neighbor zoom before applying it. A valid result proves preservation outside the mask; it does not prove that the garment is attractive, correctly shaded or aligned to the intended anatomy within the allowed region.

For a 4×2 sheet of 48px frames, prepare all three inputs at 192×96 and draw the edit regions against that exact mother sheet. Keep the same frame order and anchors. Use the generated garment layer alongside that frozen mother during animation; do not independently recenter the layer or alter the per-frame origin.
