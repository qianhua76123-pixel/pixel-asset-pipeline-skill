import test from 'node:test';
import assert from 'node:assert/strict';
import { removeChromaShades } from '../skills/pixel-asset-pipeline/scripts/chroma-shades.mjs';

function image(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) data.set(fill, p * 4);
  return { width, height, data };
}
const put = (im, x, y, color) => im.data.set(color, (y * im.width + x) * 4);
const pixel = (im, x, y) => [...im.data.subarray((y * im.width + x) * 4, (y * im.width + x) * 4 + 4)];

test('full-source hue key removes shaded backing in an enclosed opening without changing the frame', () => {
  const original = image(9, 9, [150, 108, 46, 255]);
  for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) put(original, x, y, [160, 23, 151, 255]);
  put(original, 4, 4, [124, 23, 96, 255]);
  const frozen = new Uint8ClampedArray(original.data), result = removeChromaShades(original, '#ff00ff');
  assert.equal(result.diagnostics.removedPixels, 9);
  assert.equal(result.image.width, 9); assert.equal(result.image.height, 9);
  for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) assert.deepEqual(pixel(result.image, x, y), [0, 0, 0, 0]);
  assert.deepEqual(pixel(result.image, 2, 4), [150, 108, 46, 255]);
  assert.deepEqual(original.data, frozen, 'the frozen source must not be mutated');
});

test('black thin rod, dark neutral boundary, bamboo, red strap and green detail retain exact colors and alpha', () => {
  const original = image(12, 12, [255, 0, 255, 255]);
  const protectedColors = [[8, 6, 5, 255], [30, 29, 28, 255], [199, 148, 67, 255], [145, 76, 57, 255], [47, 85, 52, 255], [72, 102, 63, 255], [100, 40, 10, 255]];
  for (let y = 1; y <= 10; y++) put(original, 2, y, protectedColors[0]);
  protectedColors.forEach((color, index) => put(original, index + 3, 6, color));
  const result = removeChromaShades(original, '#ff00ff');
  for (let y = 1; y <= 10; y++) assert.deepEqual(pixel(result.image, 2, y), protectedColors[0], 'one-pixel rod remains intact');
  protectedColors.forEach((color, index) => assert.deepEqual(pixel(result.image, index + 3, 6), color));
  assert.equal(result.diagnostics.retainedRgbUnchanged, true);
});

test('classification supports darkened chromatic keys while retaining low-value uncertain pixels', () => {
  const original = image(6, 1, [0, 0, 0, 0]);
  [[255, 0, 255, 255], [103, 20, 75, 255], [60, 4, 57, 255], [28, 0, 28, 255], [80, 70, 80, 255], [60, 75, 50, 255]].forEach((color, x) => put(original, x, 0, color));
  const result = removeChromaShades(original, '#ff00ff');
  assert.equal(result.diagnostics.removedPixels, 3);
  for (let x = 0; x < 3; x++) assert.deepEqual(pixel(result.image, x, 0), [0, 0, 0, 0]);
  for (let x = 3; x < 6; x++) assert.deepEqual(pixel(result.image, x, 0), pixel(original, x, 0));
});

test('hue comparison wraps at red and works with cyan keys', () => {
  const original = image(3, 1, [0, 0, 0, 0]);
  put(original, 0, 0, [130, 10, 20, 255]); put(original, 1, 0, [10, 120, 117, 255]); put(original, 2, 0, [50, 100, 20, 255]);
  const red = removeChromaShades(original, '#ff0000');
  assert.deepEqual(pixel(red.image, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(red.image, 1, 0), pixel(original, 1, 0));
  const cyan = removeChromaShades(original, '#00ffff');
  assert.deepEqual(pixel(cyan.image, 1, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(cyan.image, 2, 0), pixel(original, 2, 0));
});

test('neutral key skips hue erasure, while canonicalization never changes retained RGB', () => {
  const original = image(3, 1, [0, 0, 0, 0]);
  put(original, 0, 0, [255, 255, 255, 255]); put(original, 1, 0, [103, 20, 75, 129]); put(original, 2, 0, [200, 20, 200, 30]);
  const result = removeChromaShades(original, '#ffffff');
  assert.equal(result.diagnostics.skipped, true); assert.equal(result.diagnostics.removedPixels, 0);
  assert.deepEqual(pixel(result.image, 0, 0), [255, 255, 255, 255]);
  assert.deepEqual(pixel(result.image, 1, 0), [103, 20, 75, 255]);
  assert.deepEqual(pixel(result.image, 2, 0), [0, 0, 0, 0]);
});

test('cleanup is idempotent and invalid input is rejected', () => {
  const original = image(3, 3, [160, 23, 151, 255]); put(original, 1, 1, [30, 60, 30, 255]);
  const a = removeChromaShades(original, '#ff00ff'), b = removeChromaShades(a.image, '#ff00ff');
  assert.deepEqual(b.image.data, a.image.data); assert.equal(b.diagnostics.removedPixels, 0);
  assert.throws(() => removeChromaShades(original, 'magenta'), /#RRGGBB/);
  assert.throws(() => removeChromaShades({ ...original, data: original.data.subarray(4) }, '#ff00ff'), /RGBA/);
});
