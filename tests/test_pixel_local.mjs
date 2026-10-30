import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { runPipeline, inspectFile } from '../skills/pixel-asset-pipeline/scripts/pixel_local.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, 'skills/pixel-asset-pipeline/scripts/pixel_local.mjs');
const SHA = bytes => createHash('sha256').update(bytes).digest('hex');
async function temporary(t) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pixel-skill-test-')); t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory; }
async function image(directory, name, width, height, draw) {
  const data = new Uint8ClampedArray(width * height * 4); draw(data);
  const filename = path.join(directory, name); await fs.writeFile(filename, await sharp(Buffer.from(data), { raw: { width, height, channels: 4 } }).png().toBuffer()); return { filename, data, width, height };
}
function set(data, width, x, y, rgba) { data.set(rgba, (y * width + x) * 4); }
const rgba = (data, width, x, y) => [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
async function decoded(filename) { return sharp(filename).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); }
const manifest = async out => JSON.parse(await fs.readFile(out.manifest, 'utf8'));
const stage = (m, id) => m.stages.find(s => s.id === id);
function palette(data) { const result = new Set(); for (let i = 0; i < data.length; i += 4) if (data[i + 3]) result.add([...data.subarray(i, i + 3)].join(',')); return result; }
async function chair(directory) {
  return image(directory, 'synthetic-chair.png', 128, 128, data => {
    const wood = [190, 126, 48, 255], ink = [12, 10, 8, 255];
    for (let y = 10; y <= 116; y++) for (let x = 25; x <= 82 + Math.floor(y / 16); x++) set(data, 128, x, y, x < 28 || x > 79 + Math.floor(y / 16) || y < 13 || y > 113 ? ink : wood);
    for (let y = 30; y < 60; y++) for (let x = 44; x < 62; x++) set(data, 128, x, y, [0, 0, 0, 0]);
    for (let y = 60; y < 105; y++) for (let x = 96; x < 99; x++) set(data, 128, x, y, ink);
    for (let x = 75; x < 99; x++) for (let y = 89; y < 92; y++) set(data, 128, x, y, wood);
    set(data, 128, 29, 54, ink);
  });
}

test('doctor has JSON output and exposes only implemented local capabilities', () => {
  const child = spawnSync(process.execPath, [cli, 'doctor'], { encoding: 'utf8' });
  assert.equal(child.status, 0); const result = JSON.parse(child.stdout);
  assert.equal(result.sharp, '0.35.5'); assert.equal(result.capabilities.semanticModels, false); assert.equal(result.capabilities.imageGeneration, false); assert.equal(result.capabilities.terrainAtlasValidation, false); assert.equal(child.stderr, '');
});
test('standard help flags expose the structured usage without processing images', () => {
  for (const flag of ['--help', '-h']) {
    const child = spawnSync(process.execPath, [cli, flag], { encoding: 'utf8' });
    assert.equal(child.status, 0); const result = JSON.parse(child.stdout);
    assert.equal(result.ok, true); assert.match(result.commands.run, /--output-dir/); assert.equal(child.stderr, '');
  }
});
test('explicit native processing preserves complete frame, holes, thin rods and original palette', async t => {
  const directory = await temporary(t), source = await chair(directory), before = await fs.readFile(source.filename);
  const out = await runPipeline({ input: source.filename, 'output-dir': path.join(directory, 'out'), native: true, material: 'bamboo' }), after = await decoded(out.output), m = await manifest(out);
  assert.equal(after.info.width, 128); assert.equal(after.info.height, 128);
  for (let y = 30; y < 60; y++) for (let x = 44; x < 62; x++) assert.equal(rgba(after.data, 128, x, y)[3], 0, 'enclosed hole must remain empty');
  for (let y = 60; y < 105; y++) for (let x = 96; x < 99; x++) assert.equal(rgba(after.data, 128, x, y)[3], 255, 'thin rod must remain visible');
  assert([...palette(after.data)].every(c => palette(source.data).has(c)));
  for (let i = 0; i < after.data.length; i += 4) assert(after.data[i + 3] === 255 || after.data.subarray(i, i + 4).every(v => v === 0));
  assert.equal(stage(m, 'grid').algorithm, 'explicit-native-hard-alpha-v1');
  assert.equal(stage(m, 'outer-contour').algorithm, 'bounded-bamboo-joint-rhythm-v2');
  assert.equal(m.stages.filter(s => s.id === 'outer-contour' && s.status === 'run').length, 1);
  assert.equal(stage(m, 'source-colors').status, 'skip'); assert.equal(m.qualityStatus, 'candidate-needs-visual-review');
  assert.equal(SHA(await fs.readFile(source.filename)), SHA(before));
});
test('strict contain never crops markers or changes their frame anchor', async t => {
  const directory = await temporary(t), colors = [[220, 40, 20, 255], [20, 170, 60, 255], [20, 70, 210, 255], [200, 180, 30, 255]];
  const source = await image(directory, 'markers.png', 64, 32, data => {
    for (let i = 0; i < 4; i++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) set(data, 64, (i % 2 ? 62 : 0) + x, (i >= 2 ? 30 : 0) + y, colors[i]);
  });
  const out = await runPipeline({ input: source.filename, 'output-dir': path.join(directory, 'out'), size: '64x64' }), after = await decoded(out.output);
  assert.deepEqual(rgba(after.data, 64, 0, 16), colors[0]); assert.deepEqual(rgba(after.data, 64, 63, 16), colors[1]);
  assert.deepEqual(rgba(after.data, 64, 0, 47), colors[2]); assert.deepEqual(rgba(after.data, 64, 63, 47), colors[3]);
  assert.deepEqual(rgba(after.data, 64, 0, 0), [0, 0, 0, 0]); assert.deepEqual(rgba(after.data, 64, 63, 63), [0, 0, 0, 0]);
  const m = await manifest(out); assert.equal(stage(m, 'grid').diagnostics.contentY, 16);
});
test('same frozen source produces byte-identical native PNG and repeat sidecar prevents another inference', async t => {
  const directory = await temporary(t), source = await chair(directory);
  const options = { input: source.filename, native: true, material: 'bamboo' };
  const a = await runPipeline({ ...options, 'output-dir': path.join(directory, 'a') }), b = await runPipeline({ ...options, 'output-dir': path.join(directory, 'b') });
  assert.deepEqual(await fs.readFile(a.output), await fs.readFile(b.output));
  assert.equal((await inspectFile(a.output)).verifiedCompletion, true);
  const repeated = await runPipeline({ input: a.output, material: 'bamboo', 'output-dir': path.join(directory, 'repeat') }), m = await manifest(repeated);
  assert.equal(repeated.repeatedCompletedInput, true); assert.deepEqual(await fs.readFile(a.output), await fs.readFile(repeated.output));
  assert.deepEqual(m.stages.filter(s => s.status === 'run').map(s => s.id), ['export']);
  assert.equal((await inspectFile(repeated.output)).verifiedCompletion, true);
});
test('64 palette is explicit, fixed, recorded and completed input cannot silently be re-inferred', async t => {
  const directory = await temporary(t), source = await chair(directory);
  const a = await runPipeline({ input: source.filename, 'output-dir': path.join(directory, 'a'), native: true, palette: '64' }), m = await manifest(a);
  assert.equal(m.recipe.paletteBudget, 64); assert.equal(stage(m, 'color-clusters').diagnostics.paletteBudget, 64);
  const repeated = await runPipeline({ input: a.output, 'output-dir': path.join(directory, 'repeat'), palette: '64' }); assert.equal(repeated.repeatedCompletedInput, true);
  await assert.rejects(runPipeline({ input: a.output, 'output-dir': path.join(directory, 'wrong'), palette: '96' }), /frozen original/);
  await assert.rejects(fs.stat(path.join(directory, 'wrong')), /ENOENT/);
});
test('auto chroma uses measured four-edge proof and records actual source registration for cleanup', async t => {
  const directory = await temporary(t), KEY = [0, 253, 253, 255], GREEN = [50, 105, 30, 255];
  const MIXED = [...GREEN.slice(0, 3).map((v, i) => Math.round((v + KEY[i]) / 2)), 255];
  const source = await image(directory, 'cyan-source.png', 48, 32, data => {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) { const nx = Math.floor(x / 4), ny = Math.floor(y / 4), foreground = nx >= 2 && nx <= 9 && ny >= 1 && ny <= 6 && !(nx === 8 && ny === 4); set(data, 48, x, y, foreground ? GREEN : KEY); }
    const colors = [...Array(6).fill(GREEN), ...Array(8).fill(MIXED), ...Array(2).fill(KEY)];
    for (let n = 0; n < 16; n++) set(data, 48, 16 + n % 4, 12 + Math.floor(n / 4), colors[n]);
  });
  const out = await runPipeline({ input: source.filename, 'output-dir': path.join(directory, 'out'), size: '12x12' }), m = await manifest(out), after = await decoded(out.output);
  assert.equal(stage(m, 'background').status, 'run'); assert.equal(stage(m, 'background').diagnostics.keyColor, '#00fdfd');
  assert.equal(stage(m, 'source-colors').status, 'run'); assert.equal(stage(m, 'source-colors').algorithm, 'source-cell-local-background-color-v1');
  assert.equal(stage(m, 'source-colors').diagnostics.alphaPreserved, true);
  assert.equal(stage(m, 'source-colors').diagnostics.sourceMixtureRequired, true);
  assert.equal(stage(m, 'source-colors').diagnostics.donorAmbiguityPolicy, 'equivalent-evidence-preserve-v1');
  assert.deepEqual(rgba(after.data, 12, 8, 6), [0, 0, 0, 0], 'original key-colored hole stays transparent');
  assert.deepEqual(rgba(after.data, 12, 4, 5), GREEN, 'registered source support repairs the mixed-source cell');
});
for (const [name, KEY, ACCENT] of [['cyan', [0, 253, 253, 255], [0, 120, 120, 255]], ['pink', [253, 0, 253, 255], [155, 20, 155, 255]]]) {
  test(`saved-source workflow preserves unresolved intentional ${name} without downstream hue erasure`, async t => {
    const directory = await temporary(t), GREEN = [50, 105, 30, 255];
    const source = await image(directory, `${name}-accent.png`, 48, 32, data => {
      for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) {
        const nx = Math.floor(x / 4), ny = Math.floor(y / 4), visible = nx >= 2 && nx <= 9 && ny >= 1 && ny <= 6 && !(nx === 8 && ny === 4);
        set(data, 48, x, y, visible ? GREEN : KEY);
      }
      const colors = [...Array(6).fill(GREEN), ...Array(8).fill(ACCENT), ...Array(2).fill(KEY)];
      for (let n = 0; n < 16; n++) set(data, 48, 16 + n % 4, 12 + Math.floor(n / 4), colors[n]);
    });
    const before = await fs.readFile(source.filename), out = await runPipeline({ input: source.filename, 'output-dir': path.join(directory, 'out'), size: '12x12' });
    const m = await manifest(out), after = await decoded(out.output), d = stage(m, 'source-colors').diagnostics;
    assert.equal(m.version, 2); assert.equal(m.recipe.cleanKeyShades, false);
    assert.equal(d.sourceMixtureRequired, true); assert.equal(d.changedPixels, 0); assert.equal(d.alphaPreserved, true);
    assert.equal(d.refusedReasons['insufficient-local-source-material-evidence'], 1);
    assert.deepEqual(d.residualKeyShades, { skipped: true, skipReason: 'disabled-by-default', policy: 'preserve-unresolved-v1', removedPixels: 0 });
    assert.deepEqual(rgba(after.data, 12, 4, 5), ACCENT);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
      const visible = x >= 2 && x <= 9 && y >= 3 && y <= 8 && !(x === 8 && y === 6);
      assert.equal(rgba(after.data, 12, x, y)[3], visible ? 255 : 0);
    }
    assert.deepEqual(await fs.readFile(source.filename), before); assert.equal((await inspectFile(out.output)).verifiedCompletion, true);
  });
}
test('valid version-one completion sidecars remain export-only and retain their original recipe proof', async t => {
  const directory = await temporary(t), source = await chair(directory);
  const out = await runPipeline({ input: source.filename, 'output-dir': path.join(directory, 'current'), native: true });
  const legacy = path.join(directory, 'legacy-finished.png'), bytes = await fs.readFile(out.output);
  const proof = JSON.parse(await fs.readFile(out.sidecar, 'utf8'));
  // Version-one files have these same hash, geometry and stage proofs, without
  // the new residual policy field. Build that historical format around a PNG.
  proof.version = 1; proof.recipe.version = 1; delete proof.recipe.cleanKeyShades;
  await fs.writeFile(legacy, bytes); await fs.writeFile(legacy + '.pixel.json', JSON.stringify(proof));
  assert.equal((await inspectFile(legacy)).verifiedCompletion, true);
  const copied = await runPipeline({ input: legacy, 'output-dir': path.join(directory, 'copied') }), m = await manifest(copied);
  assert.equal(copied.repeatedCompletedInput, true); assert.deepEqual(await fs.readFile(copied.output), bytes);
  assert.deepEqual(m.stages.filter(s => s.status === 'run').map(s => s.id), ['export']);
  assert.equal(m.version, 1); assert.deepEqual(m.recipe, proof.recipe);
  assert.deepEqual(JSON.parse(await fs.readFile(copied.sidecar, 'utf8')), proof);
  assert.equal((await inspectFile(copied.output)).verifiedCompletion, true);
});
test('neutral or complex automatic background fails before writing, while explicit keep is honored', async t => {
  const directory = await temporary(t), source = await image(directory, 'white.png', 16, 16, data => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) set(data, 16, x, y, x >= 5 && x <= 10 && y >= 5 && y <= 10 ? [70, 150, 80, 255] : [255, 255, 255, 255]); });
  await assert.rejects(runPipeline({ input: source.filename, 'output-dir': path.join(directory, 'rejected') }), /does not contain semantic models/);
  await assert.rejects(fs.stat(path.join(directory, 'rejected')), /ENOENT/);
  const kept = await runPipeline({ input: source.filename, 'output-dir': path.join(directory, 'kept'), background: 'keep', native: true }); assert.equal(kept.visiblePixels, 256);
});
test('native normalization clears invisible RGB, binarizes alpha, and rejects an overlarge palette', async t => {
  const directory = await temporary(t), source = await image(directory, 'partial.png', 4, 4, data => { data.set([60, 150, 80, 129], 20); data.set([200, 10, 190, 127], 24); });
  const out = await runPipeline({ input: source.filename, 'output-dir': path.join(directory, 'out'), native: true }), after = await decoded(out.output);
  assert.equal(after.data[23], 255); assert.deepEqual([...after.data.subarray(24, 28)], [0, 0, 0, 0]);
  const many = await image(directory, 'many.png', 100, 100, data => { for (let p = 0; p < 10000; p++) data.set([p >>> 8, p & 255, 75, 255], p * 4); });
  await assert.rejects(runPipeline({ input: many.filename, 'output-dir': path.join(directory, 'many-out'), native: true, background: 'keep' }), /8192/);
});
test('completion requires matching SHA, dimensions and complete algorithm proofs, not a filename', async t => {
  const directory = await temporary(t), source = await chair(directory), out = await runPipeline({ input: source.filename, 'output-dir': path.join(directory, 'out'), native: true });
  const sidecar = JSON.parse(await fs.readFile(out.sidecar, 'utf8')); sidecar.stageProofs[4].algorithm = 'request-only-placeholder'; await fs.writeFile(out.sidecar, JSON.stringify(sidecar));
  assert.equal((await inspectFile(out.output)).verifiedCompletion, false);
  await assert.rejects(runPipeline({ input: out.output, 'output-dir': path.join(directory, 'bad') }), /sidecar is invalid/);
  const naked = path.join(directory, 'sprite.png'); await fs.copyFile(source.filename, naked);
  assert.equal((await inspectFile(naked)).verifiedCompletion, false);
  const fresh = await runPipeline({ input: naked, 'output-dir': path.join(directory, 'fresh'), native: true }); assert.equal(fresh.repeatedCompletedInput, false);
});
test('input and prior output directories cannot be overwritten, CLI failures return structured errors', async t => {
  const directory = await temporary(t), source = await chair(directory), before = await fs.readFile(source.filename);
  await assert.rejects(runPipeline({ input: source.filename, 'output-dir': directory }), /already exists/);
  const result = spawnSync(process.execPath, [cli, 'run', '--input', source.filename, '--output-dir', path.join(directory, 'error'), '--native', '--size', '64'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.equal(result.stdout, ''); assert.equal(JSON.parse(result.stderr).ok, false);
  assert.deepEqual(await fs.readFile(source.filename), before);
});
