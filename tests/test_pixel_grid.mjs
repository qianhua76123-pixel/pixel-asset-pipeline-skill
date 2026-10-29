import test from 'node:test';
import assert from 'node:assert/strict';
import { strictGrid } from '../skills/pixel-asset-pipeline/scripts/runtime/vendor/index.mjs';

const image = (width, height, paint) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4);
  return { width, height, data };
};
const rgba = (im, x, y) => [...im.data.subarray((y * im.width + x) * 4, (y * im.width + x) * 4 + 4)];

test('source center preserves continuous horizontal and vertical details split across nearby source colors', async () => {
  const source = image(64, 32, (x, y) => y === 6 || x === 18 ? [90, 45, 20, 255] : [215 + (x + y) % 16, 205 + (x * 3 + y) % 16, 185 + (x + y * 3) % 16, 255]);
  const before = new Uint8ClampedArray(source.data);
  const output = await strictGrid(source, 16, 8);
  assert.equal(output.diagnostics.algorithm, 'fixed-grid-source-center-v2');
  assert.equal(output.diagnostics.sampler, 'center');
  for (let x = 0; x < 16; x++) assert.deepEqual(rgba(output.image, x, 1), [90, 45, 20, 255]);
  for (let y = 0; y < 8; y++) assert.deepEqual(rgba(output.image, 4, y), [90, 45, 20, 255]);
  assert.deepEqual(source.data, before, 'frozen source must be unchanged');
});

test('center color is independent of exact-color plurality while legacy majority stays selectable', async () => {
  const source = image(8, 4, (x, y) => {
    const lx = x % 4;
    if (lx === 2 && y === 2) return [160, 90, 40, 255];
    return lx < 3 ? [30, 20, 15, 255] : [161 + y, 91 + y, 41 + y, 255];
  });
  const centered = await strictGrid(source, 2, 1);
  const legacy = await strictGrid(source, 2, 1, { sampler: 'majority' });
  assert.deepEqual(rgba(centered.image, 0, 0), [160, 90, 40, 255]);
  assert.equal(legacy.diagnostics.algorithm, 'fixed-grid-palette-first-majority-v1');
  assert.equal(legacy.diagnostics.sampler, 'majority');
  assert.notDeepEqual(rgba(legacy.image, 0, 0), rgba(centered.image, 0, 0));
});

test('majority alpha keeps holes and a surviving foreground cell whose center is transparent', async () => {
  const source = image(8, 8, (x, y) => {
    if (x >= 4 && y >= 4 || x === 2 && y === 2) return [200, 90, 10, 0];
    return [110, 60, 20, 255];
  });
  const output = await strictGrid(source, 2, 2);
  assert.deepEqual(rgba(output.image, 1, 1), [0, 0, 0, 0]);
  assert.deepEqual(rgba(output.image, 0, 0), [110, 60, 20, 255]);
  assert.equal(output.diagnostics.alphaSampler, 'majority-coverage');
});

test('contain retains the full frame and canonical transparent padding', async () => {
  const output = await strictGrid(image(16, 8, () => [80, 100, 120, 255]), 8, 8);
  assert.deepEqual([output.image.width, output.image.height], [8, 8]);
  assert.deepEqual([output.diagnostics.contentX, output.diagnostics.contentY, output.diagnostics.contentWidth, output.diagnostics.contentHeight], [0, 2, 8, 4]);
  assert.deepEqual(rgba(output.image, 4, 0), [0, 0, 0, 0]);
  assert.deepEqual(rgba(output.image, 4, 7), [0, 0, 0, 0]);
  assert.deepEqual(rgba(output.image, 4, 3), [80, 100, 120, 255]);
});

test('excess sampled colors are bounded only after sampling, with hard alpha and deterministic output', async () => {
  const source = image(256, 256, (x, y) => [x, y, (x * 3 + y * 5) % 256, 255]);
  const a = await strictGrid(source, 128, 128), b = await strictGrid(source, 128, 128);
  assert.ok(a.diagnostics.sampledVisibleColors > 8192);
  assert.equal(a.diagnostics.paletteSize, 256);
  const colors = new Set();
  for (let i = 0; i < a.image.data.length; i += 4) {
    assert.ok(a.image.data[i + 3] === 0 || a.image.data[i + 3] === 255);
    colors.add(a.image.data[i] * 65536 + a.image.data[i + 1] * 256 + a.image.data[i + 2]);
  }
  assert.ok(colors.size <= 256);
  assert.deepEqual(a.image.data, b.image.data);
});

test('unrecognized sampling modes are rejected', async () => {
  await assert.rejects(strictGrid(image(4, 4, () => [0, 0, 0, 255]), 2, 2, { sampler: 'smooth' }), /center.*majority/);
});
