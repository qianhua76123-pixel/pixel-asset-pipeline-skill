import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { removeKeyFringe, despillEdges, sampleCoverage, gridCuts, detectPixelGrid, subjectBounds, cropImage, quantizeMedoids, lockPalette, parsePalette, cleanupIsolated, magentaFringeCount } from '../skills/pixel-asset-pipeline/scripts/pixel_prepare.mjs';
import { runPipeline } from '../skills/pixel-asset-pipeline/scripts/pixel_local.mjs';

const image = (width, height, paint) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4);
  return { width, height, data };
};
const pixel = (im, x, y) => [...im.data.subarray((y * im.width + x) * 4, (y * im.width + x) * 4 + 4)];
async function temporary(t) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pixel-prepare-')); t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory; }
async function pngFile(directory, name, im) {
  const filename = path.join(directory, name);
  await fs.writeFile(filename, await sharp(Buffer.from(im.data), { raw: { width: im.width, height: im.height, channels: 4 } }).png().toBuffer());
  return filename;
}

test('fringe key removes border-connected magenta shades and keeps a solid interior accent', () => {
  const MAGENTA = [253, 2, 253, 255], GREEN = [40, 120, 50, 255], FRINGE = [176, 12, 168, 255], ACCENT = [155, 20, 155, 255];
  const source = image(28, 28, (x, y) => {
    const inside = x >= 4 && x <= 23 && y >= 4 && y <= 23;
    const edge = inside && (x < 6 || y < 6 || x > 21 || y > 21);
    const accent = x >= 10 && x <= 17 && y >= 10 && y <= 17;
    return accent ? ACCENT : edge ? FRINGE : inside ? GREEN : MAGENTA;
  });
  const frozen = new Uint8ClampedArray(source.data);
  const result = removeKeyFringe(source, '#fd02fd');
  assert.equal(result.diagnostics.algorithm, 'chroma-fringe-v1');
  assert.deepEqual(source.data, frozen);
  assert.deepEqual(pixel(result.image, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(result.image, 4, 4), [0, 0, 0, 0], 'outer magenta fringe is removed');
  assert.deepEqual(pixel(result.image, 13, 13), ACCENT, 'thick interior key-hue material stays');
  assert.equal(pixel(result.image, 8, 8)[3], 255);
  const fringe = magentaFringeCount(result.image);
  assert.equal(fringe.pinkEdge, 0);
});

test('despill recolors an edge key-hue pixel from the nearest real neighbor and keeps alpha', () => {
  const source = image(6, 6, (x, y) => x === 0 || y === 0 || x === 5 || y === 5 ? [0, 0, 0, 0] : x === 1 || y === 1 ? [190, 20, 180, 255] : [30, 110, 40, 255]);
  const result = despillEdges(source, '#ff00ff', 2);
  assert.equal(pixel(result.image, 1, 2)[3], 255);
  assert.ok(pixel(result.image, 1, 2)[1] > pixel(result.image, 1, 2)[0], 'edge magenta takes a green neighbor');
  assert.deepEqual(pixel(result.image, 3, 3).slice(0, 3), [30, 110, 40]);
  assert.equal(result.diagnostics.alphaPreserved, true);
});

test('coverage sampling picks the dominant side, not the center pixel or a blend', () => {
  const GREEN = [20, 140, 40, 255], RED = [180, 20, 20, 255], BLUE = [20, 30, 190, 255];
  const noisy = image(4, 1, x => x === 2 ? RED : GREEN);
  const dominant = sampleCoverage(noisy, 1, 1, { cols: 1, rows: 1, colCuts: gridCuts(4, 1), rowCuts: gridCuts(1, 1), contentX: 0, contentY: 0 });
  assert.deepEqual(pixel(dominant.image, 0, 0), GREEN);
  const split = image(4, 1, x => x < 2 ? GREEN : BLUE);
  const sided = sampleCoverage(split, 1, 1, { cols: 1, rows: 1, colCuts: gridCuts(4, 1), rowCuts: gridCuts(1, 1), contentX: 0, contentY: 0 });
  const [r, g, b] = pixel(sided.image, 0, 0);
  assert.ok(g > 100 || b > 100);
  assert.ok(!(g > 80 && b > 80), 'a split cell keeps one side instead of averaging both');
});

test('partial alpha contributes coverage and does not keep a mostly transparent cell', () => {
  const soft = image(4, 1, x => x === 3 ? [20, 140, 40, 0] : [20, 140, 40, 255]);
  const kept = sampleCoverage(soft, 1, 1, { cols: 1, rows: 1, colCuts: [0, 4], rowCuts: [0, 1], contentX: 0, contentY: 0 });
  assert.equal(pixel(kept.image, 0, 0)[3], 255);
  assert.equal(pixel(kept.image, 0, 0)[1], 140);
  const faint = image(4, 1, () => [20, 140, 40, 40]);
  const dropped = sampleCoverage(faint, 1, 1, { cols: 1, rows: 1, colCuts: [0, 4], rowCuts: [0, 1], contentX: 0, contentY: 0 });
  assert.deepEqual(pixel(dropped.image, 0, 0), [0, 0, 0, 0]);
});

test('grid detection locks onto a shifted pixel lattice and ignores a smooth ramp', () => {
  const blocks = image(32, 32, (x, y) => {
    const bx = Math.floor(((x - 3) + 32) / 8), by = Math.floor(((y - 3) + 32) / 8);
    return (bx + by) % 2 ? [20, 20, 20, 255] : [220, 180, 40, 255];
  });
  const found = detectPixelGrid(blocks);
  assert.equal(found.confident, true);
  assert.ok([8, 16].includes(found.periodX));
  assert.equal(found.phaseX % found.periodX, 3 % found.periodX);
  const ramp = image(32, 32, (x, y) => [x * 8, y * 8, 40, 255]);
  assert.equal(detectPixelGrid(ramp).confident, false);
});

test('hard palette and shared palette stay inside the requested colors', () => {
  const source = image(5, 4, (x, y) => [40 + x * 30, 20 + y * 25, 80, 255]);
  const medoids = quantizeMedoids(source, 3);
  assert.ok(medoids.diagnostics.actualPaletteColors <= 3);
  assert.equal(medoids.diagnostics.hardCeiling, true);
  const locked = lockPalette(source, [[0, 0, 0], [255, 255, 255]]);
  for (let i = 0; i < locked.image.data.length; i += 4) {
    const rgb = locked.image.data.slice(i, i + 3).join(',');
    assert.ok(rgb === '0,0,0' || rgb === '255,255,255');
  }
  const parsed = parsePalette('#112233\n445566\n; comment\n');
  assert.deepEqual(parsed, [[0x11, 0x22, 0x33], [0x44, 0x55, 0x66]]);
  const gpl = parsePalette('GIMP Palette\nName: test\n#\n  1  2  3 unnamed\n');
  assert.deepEqual(gpl, [[1, 2, 3]]);
});

test('isolated cleanup absorbs a near speck and keeps a high-contrast accent', () => {
  const WOOD = [150, 100, 40, 255], SPECK = [156, 108, 48, 255], INK = [12, 10, 8, 255];
  const source = image(5, 5, (x, y) => x === 2 && y === 2 ? SPECK : x === 4 && y === 4 ? INK : WOOD);
  const result = cleanupIsolated(source, 22);
  assert.deepEqual(pixel(result.image, 2, 2), WOOD);
  assert.deepEqual(pixel(result.image, 4, 4), INK);
  assert.equal(result.diagnostics.passes, 1);
});

test('crop uses the subject box and a palette file locks the exported sprite', async t => {
  const directory = await temporary(t);
  const MAGENTA = [253, 2, 253, 255], GREEN = [40, 130, 45, 255];
  const source = image(40, 40, (x, y) => x >= 8 && x <= 17 && y >= 8 && y <= 17 ? GREEN : MAGENTA);
  const filename = await pngFile(directory, 'margin.png', source);
  const cropped = await runPipeline({ input: filename, 'output-dir': path.join(directory, 'crop'), size: '10x10', background: 'chroma', key: '#fd02fd', crop: true, palette: '16' });
  const after = await sharp(cropped.output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(after.info.width, 10); assert.equal(after.info.height, 10);
  let green = 0;
  for (let i = 0; i < after.data.length; i += 4) if (after.data[i + 3] && after.data[i + 1] > 80) green++;
  assert.equal(green, 100, 'cropped subject fills the requested sprite');
  const palette = path.join(directory, 'two.hex');
  await fs.writeFile(palette, '#204020\n#d0c0a0\n');
  const locked = await runPipeline({ input: filename, 'output-dir': path.join(directory, 'pal'), size: '10x10', background: 'chroma', key: '#fd02fd', crop: true, 'palette-file': palette });
  const painted = await sharp(locked.output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const allowed = new Set(['32,64,32', '208,192,160']);
  for (let i = 0; i < painted.data.length; i += 4) if (painted.data[i + 3]) assert.ok(allowed.has([...painted.data.subarray(i, i + 3)].join(',')));
  const keyed = removeKeyFringe(source, '#fd02fd').image;
  assert.equal(subjectBounds(keyed).width, 10);
  assert.equal(cropImage(keyed, subjectBounds(keyed, 0)).width, 10);
});
