import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { applyGarment, cliMain } from '../skills/pixel-asset-pipeline/scripts/pixel_garment.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function writePng(file, data, width = 12, height = 10) {
  await fs.writeFile(file, await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer());
}
async function pixels(file) { return sharp(file).ensureAlpha().raw().toBuffer(); }
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixel garment 测试 '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const base = Buffer.alloc(12 * 10 * 4), proposal = Buffer.alloc(base.length), mask = Buffer.alloc(base.length);
  for (let y = 1; y < 9; y++) for (let x = 3; x < 9; x++) base.set([120 + x, 90 + y, 65, 255], (y * 12 + x) * 4);
  // The candidate intentionally changes pixels outside the clothing region.
  for (let i = 0; i < proposal.length; i += 4) proposal.set([200, 30, 45, 255], i);
  for (let y = 4; y < 7; y++) for (let x = 4; x < 7; x++) mask.set([5, 90, 210, 255], (y * 12 + x) * 4);
  const files = { base: path.join(root, 'mother.png'), proposal: path.join(root, 'proposal.png'), editMask: path.join(root, 'region.png'), outputDir: path.join(root, 'result') };
  await Promise.all([writePng(files.base, base), writePng(files.proposal, proposal), writePng(files.editMask, mask)]);
  return { root, files, base, proposal, mask };
}

test('garment CLI preserves every protected RGBA byte, frame and source; layer contains only explicit edits', async t => {
  const f = await fixture(t);
  const sourceBytes = await fs.readFile(f.files.base);
  const report = await cliMain(['apply', '--base', f.files.base, '--proposal', f.files.proposal, '--edit-mask', f.files.editMask, '--output-dir', f.files.outputDir]);
  const [composite, layer] = await Promise.all([pixels(path.join(f.files.outputDir, 'composite.png')), pixels(path.join(f.files.outputDir, 'garment-layer.png'))]);
  for (let i = 0; i < f.base.length; i += 4) {
    if (f.mask[i + 3]) {
      assert.deepEqual(composite.subarray(i, i + 4), f.proposal.subarray(i, i + 4));
      assert.deepEqual(layer.subarray(i, i + 4), f.proposal.subarray(i, i + 4));
    } else {
      assert.deepEqual(composite.subarray(i, i + 4), f.base.subarray(i, i + 4), 'head, hands, feet and transparent padding remain byte-identical');
      assert.deepEqual(layer.subarray(i, i + 4), Buffer.alloc(4));
    }
  }
  assert.equal(report.width, 12); assert.equal(report.height, 10);
  assert.equal(report.maskedPixels, 9); assert.equal(report.changedPixels, 9);
  assert.equal(report.protectedPixels, 111); assert.equal(report.protectedChanged, 0); assert.equal(report.silhouetteChanged, 0);
  assert.equal(report.sourceSha256, sha(sourceBytes));
  assert.deepEqual(await fs.readFile(f.files.base), sourceBytes, 'mother source file was not modified');
  const diskReport = JSON.parse(await fs.readFile(report.reportPath, 'utf8'));
  assert.equal(diskReport.inputs.proposal.sha256, sha(await fs.readFile(f.files.proposal)));
  assert.equal(diskReport.inputs.editMask.sha256, sha(await fs.readFile(f.files.editMask)));
  assert.equal(diskReport.outputs.composite.sha256, sha(await fs.readFile(path.join(f.files.outputDir, 'composite.png'))));
});

test('mask escaping the opaque mother and proposal gaps fail before creating output', async t => {
  const f = await fixture(t);
  f.mask.set([255, 255, 255, 255], 0); await writePng(f.files.editMask, f.mask);
  await assert.rejects(applyGarment(f.files), /escapes the solid base/);
  await assert.rejects(fs.stat(f.files.outputDir), { code: 'ENOENT' });
  f.mask.fill(0, 0, 4); await writePng(f.files.editMask, f.mask);
  const index = (4 * 12 + 4) * 4; f.proposal.fill(0, index, index + 4); await writePng(f.files.proposal, f.proposal);
  await assert.rejects(applyGarment(f.files), /missing opaque coverage/);
  await assert.rejects(fs.stat(f.files.outputDir), { code: 'ENOENT' });
});

test('dimensions and partial alpha in each input are rejected instead of resized or thresholded', async t => {
  const f = await fixture(t);
  await writePng(f.files.proposal, Buffer.alloc(8 * 8 * 4), 8, 8);
  await assert.rejects(applyGarment(f.files), /identical native dimensions/);
  await writePng(f.files.proposal, f.proposal);
  for (const [name, bytes] of [['base', f.base], ['proposal', f.proposal], ['editMask', f.mask]]) {
    const modified = Buffer.from(bytes); modified[(4 * 12 + 4) * 4 + 3] = 128;
    await writePng(f.files[name], modified);
    await assert.rejects(applyGarment(f.files), /hard alpha/);
    await writePng(f.files[name], bytes);
  }
  await assert.rejects(fs.stat(f.files.outputDir), { code: 'ENOENT' });
});

test('an empty mask, unsupported format and existing destination cannot produce a misleading success', async t => {
  const f = await fixture(t);
  await writePng(f.files.editMask, Buffer.alloc(f.mask.length));
  await assert.rejects(applyGarment(f.files), /mask is empty/);
  await writePng(f.files.editMask, f.mask);
  await fs.writeFile(f.files.proposal, await sharp(f.files.base).jpeg().toBuffer());
  await assert.rejects(applyGarment(f.files), /must be PNG/);
  await writePng(f.files.proposal, f.proposal);
  await fs.mkdir(f.files.outputDir); await fs.writeFile(path.join(f.files.outputDir, 'keep.txt'), 'existing');
  await assert.rejects(applyGarment(f.files), /already exists/);
  assert.equal(await fs.readFile(path.join(f.files.outputDir, 'keep.txt'), 'utf8'), 'existing');
});

test('embedded provenance rejects copied/renamed outputs as recursive bases; the frozen original remains reusable', async t => {
  const f = await fixture(t); await applyGarment(f.files);
  for (const output of ['composite.png', 'garment-layer.png']) {
    const renamed = path.join(f.root, 'renamed-' + output); await fs.copyFile(path.join(f.files.outputDir, output), renamed);
    await assert.rejects(applyGarment({ ...f.files, base: renamed, outputDir: path.join(f.root, 'recursive-' + output) }), /recursive application is disabled/);
  }
  const next = await applyGarment({ ...f.files, outputDir: path.join(f.root, 'same-original-again') });
  assert.equal(next.protectedChanged, 0);
  assert.deepEqual(await fs.readFile(path.join(next.outputDirectory, 'composite.png')), await fs.readFile(path.join(f.files.outputDir, 'composite.png')), 'same frozen source and mask remain deterministic');
});

test('mask RGB does not tint the garment and repeated/unknown flags are explicit errors', async t => {
  const f = await fixture(t); const first = await applyGarment(f.files);
  for (let i = 0; i < f.mask.length; i += 4) { f.mask[i] = 220; f.mask[i + 1] = 250; f.mask[i + 2] = 180; }
  await writePng(f.files.editMask, f.mask);
  const second = await applyGarment({ ...f.files, outputDir: path.join(f.root, 'different-mask-rgb') });
  assert.deepEqual(await fs.readFile(path.join(first.outputDirectory, 'garment-layer.png')), await fs.readFile(path.join(second.outputDirectory, 'garment-layer.png')));
  await assert.rejects(cliMain(['apply', '--base', 'a', '--base', 'b']), /Duplicate/);
  await assert.rejects(cliMain(['apply', '--edit-mask']), /Missing value/);
  await assert.rejects(cliMain(['apply', '--resize', '48']), /Unknown/);
});

test('protected transparent RGB is not normalized and ICC conversions are refused', async t => {
  const f = await fixture(t);
  f.base.set([13, 27, 41, 0], 0); await writePng(f.files.base, f.base);
  const sourcePixels = await pixels(f.files.base);
  await applyGarment(f.files);
  const output = await pixels(path.join(f.files.outputDir, 'composite.png'));
  assert.deepEqual(output.subarray(0, 4), sourcePixels.subarray(0, 4));
  assert.deepEqual(output.subarray(0, 4), Buffer.from([13, 27, 41, 0]));
  const tagged = path.join(f.root, 'profile-tagged.png');
  await fs.writeFile(tagged, await sharp(f.files.base).withIccProfile('srgb').png().toBuffer());
  await assert.rejects(applyGarment({ ...f.files, base: tagged, outputDir: path.join(f.root, 'profile-result') }), /ICC color profile/);
});
