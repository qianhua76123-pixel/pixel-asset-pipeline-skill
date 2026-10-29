# Terrain reference: not an implemented engine

This release processes individual sprites. It does not create terrain atlases, recover peering bits, check cross-tile seams or export Godot resources.

| Asset contract | Verification |
|---|---|
| Seamless material texture | Left/right and top/bottom matching, repeated-map appearance |
| Terrain atlas | Corners, edges, islands, narrow paths, holes, junctions, chosen adjacency rule |
| Prop sprite sheet | Individual silhouettes, padding, anchors and relative scale |

Ground tiles are often opaque; terrain overlays may have rule-controlled transparency. Do not apply semantic object removal, tight cropping or independent contour repair to every ground tile. Process a complete atlas with one grid phase and frozen palette mapping while preserving its edge contract.

Keep an existing game's base grid unless a new contract requires changing it. A16x16 base supports32x32/64x64 multi-tile components. Gameplay plots and crop states are separate from PNG dimensions. Separate soil/water/ridges from growing plants.

Southern-China village material relationships can include rice-field water, earth ridges, irrigation channels, damp soil, mossy flagstones and drying courtyards. Keep large surfaces readable and concentrate detail at transitions. These are design starting points, not a universal style mandate.

Corner, edge and mixed matching are distinct rules. Two-state corner sets have16 combinations.47-blob is a constrained mixed-neighborhood subset, not a quality tier or complete arbitrary multi-terrain solution. A nine-tile rectangle template does not necessarily cover concave corners and narrow passages.

A future terrain pipeline needs whole-atlas grid/palette processing, boundary protection, repeated3x3 texture tests, concave corners, islands, one-cell channels, enclosed holes and multi-material intersections. Verify engine metadata as well as rendered maps.

## Primary references

- [Godot TileSets](https://docs.godotengine.org/en/stable/tutorials/2d/using_tilesets.html): atlas geometry and terrain data.
- [Tiled terrains](https://doc.mapeditor.org/en/stable/manual/terrain/): Corner/Edge/Mixed sets and missing patterns.
- [LDtk auto-layers](https://ldtk.io/docs/general/auto-layers/): logical grid and visual rules.
- [Mana Seed Summer Forest](https://seliel-the-shaper.itch.io/summer-forest): detailed16x16 art reference.
- [LimeZu Modern Farm](https://limezu.itch.io/modernfarm): farming assets and crop states.

No artwork from these packs is included. Referencing an author grants no rights to copy their art.
