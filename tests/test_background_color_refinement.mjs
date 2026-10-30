import test from 'node:test';
import assert from 'node:assert/strict';
import { refineBackgroundColors } from '../skills/pixel-asset-pipeline/scripts/runtime/vendor/index.mjs';

const GREEN = [50, 105, 30], CYAN = [0, 253, 253], WHITE = [255, 255, 255];
const EMPTY = [0, 0, 0, 0], opaque = c => [...c, 255];
function image(width, height, draw) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(draw(x, y), (y * width + x) * 4);
  return { width, height, data };
}
const pixel = (im, x, y) => [...im.data.subarray((y * im.width + x) * 4, (y * im.width + x) * 4 + 4)];
const put = (im, x, y, rgba) => im.data.set(rgba, (y * im.width + x) * 4);
function evidenceFor(current, key) {
  const raw = image(current.width * 4, current.height * 4, (x, y) => {
    const c = pixel(current, Math.floor(x / 4), Math.floor(y / 4)); return c[3] ? c : opaque(key);
  });
  const source = image(raw.width, raw.height, (x, y) => pixel(current, Math.floor(x / 4), Math.floor(y / 4)));
  return {
    sourceRGBA: source, unmattedSourceRGBA: raw, keyColor: '#' + key.map(v => v.toString(16).padStart(2, '0')).join(''),
    colCuts: Array.from({ length: current.width + 1 }, (_, i) => i * 4), rowCuts: Array.from({ length: current.height + 1 }, (_, i) => i * 4), paletteMappingPreserved: true,
  };
}
function cell(e, x, y, colors) {
  const key = [1, 3, 5].map(i => parseInt(e.keyColor.slice(i, i + 2), 16)); let n = 0;
  for (let yy = e.rowCuts[y]; yy < e.rowCuts[y + 1]; yy++) for (let xx = e.colCuts[x]; xx < e.colCuts[x + 1]; xx++) {
    const c = colors[n++]; put(e.unmattedSourceRGBA, xx, yy, opaque(c ?? key)); put(e.sourceRGBA, xx, yy, c ? opaque(c) : EMPTY);
  }
}
function invariants(before, after) {
  assert.equal(after.width, before.width); assert.equal(after.height, before.height);
  for (let p = 0; p < before.width * before.height; p++) {
    assert.equal(after.data[p * 4 + 3], before.data[p * 4 + 3]);
    if (!before.data[p * 4 + 3]) assert.deepEqual([...after.data.subarray(p * 4, p * 4 + 4)], EMPTY);
  }
}

test('bundled helper repairs a quantized mixture while preserving source, hole and thin-line alpha', () => {
  const mixed = GREEN.map((v, i) => Math.round((v + CYAN[i]) / 2));
  const current = image(8, 8, (x, y) => x >= 1 && x <= 5 && y >= 1 && y <= 5 && !(x === 4 && y === 4) || x === 3 && y === 6 ? opaque(GREEN) : EMPTY);
  put(current, 2, 2, opaque(mixed)); const e = evidenceFor(current, CYAN);
  cell(e, 2, 2, [...Array(6).fill(GREEN), ...Array(8).fill(mixed), null, null]);
  const before = current.data.slice(), sourceBefore = e.sourceRGBA.data.slice(), rawBefore = e.unmattedSourceRGBA.data.slice();
  const r = refineBackgroundColors(current, e);
  assert.deepEqual(pixel(r.image, 2, 2), opaque(GREEN)); assert.equal(r.diagnostics.changedPixels, 1);
  assert.equal(r.diagnostics.sourceMixtureRequired, true); assert.equal(r.diagnostics.donorAmbiguityPolicy, 'equivalent-evidence-preserve-v1');
  assert.equal(r.diagnostics.originalPaletteOnly, true); assert.equal(r.diagnostics.alphaPreserved, true);
  assert.deepEqual(pixel(r.image, 4, 4), EMPTY); assert.deepEqual(pixel(r.image, 3, 6), opaque(GREEN));
  invariants(current, r.image); assert.deepEqual(current.data, before); assert.deepEqual(e.sourceRGBA.data, sourceBefore); assert.deepEqual(e.unmattedSourceRGBA.data, rawBefore);
});

for (const [name, key, accent] of [['cyan', CYAN, [0, 120, 120]], ['pink', [253, 0, 253], [155, 20, 155]]]) {
  test(`bundled helper preserves source-majority ${name} unsupported by a donor/background mixture`, () => {
    const current = image(5, 5, (x, y) => x >= 1 && x <= 3 && y >= 1 && y <= 3 ? opaque(GREEN) : EMPTY);
    put(current, 2, 2, opaque(accent)); const e = evidenceFor(current, key);
    cell(e, 2, 2, [...Array(6).fill(GREEN), ...Array(8).fill(accent), null, null]);
    const r = refineBackgroundColors(current, e);
    assert.deepEqual(r.image.data, current.data); assert.equal(r.diagnostics.changedPixels, 0);
    assert.equal(r.diagnostics.refusedReasons['insufficient-local-source-material-evidence'], 1); invariants(current, r.image);
  });
}

test('bundled helper refuses equivalent different donors under source and native permutations', () => {
  const low = [0, 0, 0], high = [48, 48, 48], gray = [125, 125, 125], brown = [110, 60, 25];
  for (const reverseSource of [false, true]) for (const reverseNative of [false, true]) {
    const current = image(5, 5, (x, y) => x >= 1 && x <= 3 && y >= 1 && y <= 3 ? opaque(brown) : EMPTY); put(current, 2, 2, opaque(gray));
    for (const [x, y] of [[1, 1], [1, 2]]) put(current, x, y, opaque(reverseNative ? high : low));
    for (const [x, y] of [[3, 2], [3, 3]]) put(current, x, y, opaque(reverseNative ? low : high));
    const e = evidenceFor(current, WHITE);
    cell(e, 2, 2, [...Array(6).fill(reverseSource ? high : low), ...Array(6).fill(reverseSource ? low : high), ...Array(4).fill(gray)]);
    const r = refineBackgroundColors(current, e);
    assert.deepEqual(r.image.data, current.data); assert.equal(r.diagnostics.changedPixels, 0);
    assert.equal(r.diagnostics.refusedReasons['ambiguous-local-source-material'], 1); invariants(current, r.image);
  }
});
