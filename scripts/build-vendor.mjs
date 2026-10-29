import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
await build({
  entryPoints: [path.join(root, 'skills/pixel-asset-pipeline/scripts/runtime/vendor/index.ts')],
  outfile: path.join(root, 'skills/pixel-asset-pipeline/scripts/runtime/vendor/index.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22', legalComments: 'inline', external: ['sharp'],
  banner: { js: '// Derived from Pixel Studio commit 40e333545b84285d7f135eef1abfd29d2f376ffb. MIT notice: LICENSE.upstream.\n// Rebuild with npm run build; source and provenance are shipped alongside this file.' },
});
