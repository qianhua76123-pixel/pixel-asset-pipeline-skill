# Third-party notices

## Game UI research and Studio integration example

`examples/game-ui-templates/studio-integration/game-ui-templates.patch` preserves
the local Pixel Studio change from `7bd21318e632a8e0b1e6a853db284a870d7989f3`
to `a4bc94db0061f1121ae9acdfe8a58da0498be401`, based on
[shrimbly/node-banana](https://github.com/shrimbly/node-banana). These identify
local modified snapshots, not commits asserted to exist in the upstream repo.
The upstream MIT notice is included verbatim as `LICENSE.upstream` beside the
patch; its SHA-256 and scope are recorded in `PROVENANCE.json`.

The example's commercial game screenshots are external official research links,
not bundled artwork or a grant to reuse game images. Game names and imagery
remain the property of their respective rightsholders. Authored layout SVGs are
explicitly labeled specification diagrams, not generated art or working game UI.

## Pixel refinement runtime

The pixel refinement modules in `skills/pixel-asset-pipeline/scripts/runtime/vendor/`
derive from the local Pixel Studio checkout at commit
`40e333545b84285d7f135eef1abfd29d2f376ffb`, based on
[shrimbly/node-banana](https://github.com/shrimbly/node-banana).
This commit identifies the local modified snapshot, not a commit asserted to be
available from that upstream GitHub repository. The upstream MIT copyright and
permission notice is preserved verbatim in
`skills/pixel-asset-pipeline/scripts/runtime/vendor/LICENSE.upstream`.
File hashes and narrowly scoped import changes are recorded in
`skills/pixel-asset-pipeline/scripts/runtime/PROVENANCE.json`.

The strict grid sampler in `pixel_local.mjs` adapts the same checkout's
`processor.ts`: fixed integer cuts, hard alpha, contain placement, and canonical
transparent RGB. Local v0.2.1 samples consistent source-cell centers before
palette reduction; it no longer uses exact-RGB plurality sampling. The source is MIT licensed;
the same upstream notice applies to those adaptations. The command interface,
portable file provenance, output validation, and standalone limitations are new.

Runtime dependency: **sharp 0.35.5**, Apache-2.0. Its platform-specific native
packages include libvips and other separately licensed dependencies. The audited
`@img/sharp-libvips-darwin-arm64` npm package declares **LGPL-3.0-or-later**;
retain the licenses distributed by npm when redistributing an installed runtime.
Other operating-system packages must be checked separately. This source
repository does not vendor native binaries; npm installs the platform packages.

Build dependency: **esbuild 0.27.2**, MIT. It is not needed to execute the committed
`vendor/index.mjs` bundle after runtime dependencies have been installed.

This standalone package does not bundle semantic model weights, Python virtual
environments, perfectPixel, unfake, Spritefusion, user images, or credentials.
Those capabilities are not implied by installing this Skill.
