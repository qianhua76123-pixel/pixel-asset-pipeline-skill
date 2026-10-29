// Adapted from processor.ts at the pinned source commit; retain LICENSE.upstream.
import sharp from "sharp";
import { planPixelLayout } from "./pixel-layout";
import { StudioError } from "./image-types";
import type { SourceGuidedImage as RawImage } from "./image-types";
interface PaletteEntry { key: number; rgba: number[]; count: number }
interface PaletteBox { entries: PaletteEntry[]; axis: number; score: number }
const MAX_INPUT_PIXELS = 16_777_216, MAX_EXPORT_PIXELS = 32_000_000;
async function decode(buffer: Buffer): Promise<RawImage> {
  try {
    const result = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, animated: false }).rotate().toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data: new Uint8ClampedArray(result.data), width: result.info.width, height: result.info.height };
  } catch { throw new StudioError("图片无法读取或超过 1677 万像素处理上限"); }
}

function binaryAlpha(image: RawImage, threshold: number): void {
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = image.data[i + 3] >= threshold ? 255 : 0;
    image.data[i + 3] = alpha;
    if (!alpha) image.data[i] = image.data[i + 1] = image.data[i + 2] = 0;
  }
}

export function imageStatistics(image: RawImage): Record<string, unknown> {
  const colors = new Set<number>();
  let transparent = 0, partial = 0, colorCountExact = true;
  for (let i = 0; i < image.data.length; i += 4) {
    const a = image.data[i + 3];
    if (!a) transparent++; else if (a < 255) partial++;
    if (colorCountExact) {
      colors.add(((image.data[i] << 24) | (image.data[i + 1] << 16) | (image.data[i + 2] << 8) | a) >>> 0);
      if (colors.size > 1_000_000) colorCountExact = false;
    }
  }
  return { width: image.width, height: image.height, colorCount: colors.size, colorCountExact, transparentPixels: transparent, partialAlphaPixels: partial, transparentPercent: +(100 * transparent / (image.width * image.height)).toFixed(3), binaryAlpha: partial === 0 };
}

function rgbaKey(data: Uint8ClampedArray, offset: number): number {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

function constrainPalette(image: RawImage, maximum: number): RawImage {
  const histogram = new Map<number, PaletteEntry>();
  let hasTransparent = false;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset + 3] === 0) { hasTransparent = true; continue; }
    const key = rgbaKey(image.data, offset), existing = histogram.get(key);
    if (existing) existing.count++;
    else histogram.set(key, { key, rgba: Array.from(image.data.subarray(offset, offset + 4)), count: 1 });
  }
  const foregroundLimit = Math.max(1, maximum - (hasTransparent ? 1 : 0));
  function makeBox(entries: PaletteEntry[]): PaletteBox {
    const means = [0, 0, 0, 0], variances = [0, 0, 0, 0], weights = [1, 1.7, 0.7, 1];
    const mass = entries.reduce((sum, entry) => sum + entry.count, 0);
    for (const entry of entries) for (let axis = 0; axis < 4; axis++) means[axis] += entry.rgba[axis] * entry.count / mass;
    for (const entry of entries) for (let axis = 0; axis < 4; axis++) variances[axis] += (entry.rgba[axis] - means[axis]) ** 2 * entry.count * weights[axis];
    let axis = 0;
    for (let candidate = 1; candidate < 4; candidate++) if (variances[candidate] > variances[axis]) axis = candidate;
    return { entries, axis, score: entries.length > 1 ? variances[axis] : -1 };
  }
  const boxes = histogram.size ? [makeBox([...histogram.values()])] : [];
  while (boxes.length < foregroundLimit) {
    let index = -1;
    for (let candidate = 0; candidate < boxes.length; candidate++) if (boxes[candidate].entries.length > 1 && (index < 0 || boxes[candidate].score > boxes[index].score)) index = candidate;
    if (index < 0) break;
    const box = boxes[index], sorted = [...box.entries].sort((a, b) => a.rgba[box.axis] - b.rgba[box.axis] || a.key - b.key);
    const half = sorted.reduce((sum, entry) => sum + entry.count, 0) / 2;
    let cumulative = 0, split = 1;
    for (let cursor = 0; cursor < sorted.length - 1; cursor++) { cumulative += sorted[cursor].count; split = cursor + 1; if (cumulative >= half) break; }
    boxes.splice(index, 1, makeBox(sorted.slice(0, split)), makeBox(sorted.slice(split)));
  }
  const mapping = new Map<number, number[]>();
  for (const box of boxes) {
    const mass = box.entries.reduce((sum, entry) => sum + entry.count, 0), representative = [0, 0, 0, 0];
    for (const entry of box.entries) for (let axis = 0; axis < 4; axis++) representative[axis] += entry.rgba[axis] * entry.count / mass;
    const rounded = representative.map((value) => Math.round(value));
    for (const entry of box.entries) mapping.set(entry.key, rounded);
  }
  const data = new Uint8ClampedArray(image.data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    if (image.data[offset + 3] === 0) continue;
    data.set(mapping.get(rgbaKey(image.data, offset))!, offset);
  }
  return { data, width: image.width, height: image.height };
}

async function encode(image: RawImage, paletteSize = 0, scale = 1, canonicalTransparent = false): Promise<{ buffer: Buffer; stats: Record<string, unknown> }> {
  if (image.width * image.height * scale * scale > MAX_EXPORT_PIXELS) throw new StudioError("整数倍导出后超过 3200 万像素，请降低放大倍数");
  let pipeline = sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 4 } });
  // Start with perceptual quantization, then enforce an exact tuple ceiling.
  // Neither fast-pixelizer.colorVariety nor Sharp PNG bit depth is a strict
  // user-requested palette-size guarantee.
  let native = await pipeline.png(paletteSize ? { palette: true, colours: paletteSize, dither: 0, effort: 8 } : {}).toBuffer();
  let nativeImage = await decode(native), nativeStats = imageStatistics(nativeImage);
  if (paletteSize && Number(nativeStats.colorCount) > paletteSize) {
    nativeImage = constrainPalette(nativeImage, paletteSize);
    native = await sharp(Buffer.from(nativeImage.data), { raw: { width: nativeImage.width, height: nativeImage.height, channels: 4 } }).png().toBuffer();
    nativeStats = imageStatistics(await decode(native));
  }
  if (paletteSize && nativeStats.colorCountExact && Number(nativeStats.colorCount) > paletteSize) throw new StudioError("色板约束校验失败，未保存超出颜色上限的结果", 500);
  if (canonicalTransparent) {
    // Palette encoders can assign arbitrary hidden RGB values to alpha=0.
    // Canonical zero RGB keeps native and enlarged strict exports identical
    // even when libvips drops hidden RGB during nearest-neighbor enlargement.
    let changed = false;
    for (let offset = 0; offset < nativeImage.data.length; offset += 4) if (nativeImage.data[offset + 3] === 0 && (nativeImage.data[offset] || nativeImage.data[offset + 1] || nativeImage.data[offset + 2])) {
      nativeImage.data[offset] = nativeImage.data[offset + 1] = nativeImage.data[offset + 2] = 0; changed = true;
    }
    if (changed) {
      native = await sharp(Buffer.from(nativeImage.data), { raw: { width: nativeImage.width, height: nativeImage.height, channels: 4 } }).png().toBuffer();
      nativeStats = imageStatistics(nativeImage);
    }
  }
  if (scale === 1) return { buffer: native, stats: { ...nativeStats, logicalWidth: image.width, logicalHeight: image.height, scale: 1 } };
  pipeline = sharp(native).resize(image.width * scale, image.height * scale, { kernel: "nearest" });
  const buffer = await pipeline.png().toBuffer();
  return { buffer, stats: { ...nativeStats, width: image.width * scale, height: image.height * scale, logicalWidth: image.width, logicalHeight: image.height, scale } };
}

function gridCuts(size: number, count: number, phase: number): number[] {
  const cuts = [0];
  for (let i = 1; i < count; i++) cuts.push(Math.max(cuts[i - 1] + 1, Math.min(size - (count - i), Math.round(size * i / count + phase))));
  cuts.push(size);
  return cuts;
}

function sampleGrid(source: RawImage, cols: number, rows: number, phaseX: number, phaseY: number, alphaMode: string, threshold: number): { image: RawImage; colCuts: number[]; rowCuts: number[] } {
  const colCuts = gridCuts(source.width, cols, phaseX), rowCuts = gridCuts(source.height, rows, phaseY);
  const data = new Uint8ClampedArray(cols * rows * 4);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const frequency = new Map<number, number>();
    let alphaSum = 0, visible = 0, total = 0;
    for (let y = rowCuts[row]; y < rowCuts[row + 1]; y++) for (let x = colCuts[col]; x < colCuts[col + 1]; x++) {
      const index = (y * source.width + x) * 4, a = source.data[index + 3];
      total++; alphaSum += a;
      if (a < (alphaMode === "binary" ? threshold : 1)) continue;
      visible++;
      const key = (source.data[index] << 16) | (source.data[index + 1] << 8) | source.data[index + 2];
      frequency.set(key, (frequency.get(key) || 0) + 1);
    }
    const out = (row * cols + col) * 4;
    if (!visible || (alphaMode === "binary" && visible * 2 < total)) continue;
    let best = 0, bestCount = -1;
    for (const [key, count] of frequency) if (count > bestCount) { bestCount = count; best = key; }
    data[out] = (best >>> 16) & 255; data[out + 1] = (best >>> 8) & 255; data[out + 2] = best & 255;
    data[out + 3] = alphaMode === "binary" ? 255 : Math.round(alphaSum / total);
  }
  return { image: { data, width: cols, height: rows }, colCuts, rowCuts };
}

export async function strictGrid(source: RawImage, width: number, height: number) {
  const layout = planPixelLayout(source.width, source.height, { fit: "contain", anchor: "center", cols: width, rows: height, scale: 1 });
  const prepared = { ...source, data: new Uint8ClampedArray(source.data) };
  binaryAlpha(prepared, 128);
  const sourcePalette = await encode(prepared, 256, 1, true);
  const paletteImage = await decode(sourcePalette.buffer);
  const sampled = sampleGrid(paletteImage, layout.content.width, layout.content.height, 0, 0, "binary", 128);
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < sampled.image.height; y++) frame.set(sampled.image.data.subarray(y * sampled.image.width * 4, (y + 1) * sampled.image.width * 4), ((layout.content.y + y) * width + layout.content.x) * 4);
  const encoded = await encode({ data: frame, width, height }, 256, 1, true);
  const image = await decode(encoded.buffer);
  const palette = new Map<number, readonly [number, number, number]>();
  for (let i = 0; i < paletteImage.data.length; i += 4) if (paletteImage.data[i + 3]) { const rgb = [paletteImage.data[i], paletteImage.data[i + 1], paletteImage.data[i + 2]] as const; palette.set(rgb[0] << 16 | rgb[1] << 8 | rgb[2], rgb); }
  return { image, diagnostics: { algorithm: "fixed-grid-palette-first-majority-v1", sourceWidth: source.width, sourceHeight: source.height, width, height, fit: "contain", anchor: "center", contentX: layout.content.x, contentY: layout.content.y, contentWidth: layout.content.width, contentHeight: layout.content.height, colCuts: sampled.colCuts, rowCuts: sampled.rowCuts, alphaThreshold: 128, phaseX: 0, phaseY: 0, sampler: "majority", paletteSize: 256, dither: 0, interpolation: "nearest", verifiedUniformBlocks: true, colorQuantization: "256-entry perceptual pre-palette may create RGB colors; later refinement uses grid colors" }, evidence: { sourceRGBA: prepared, colCuts: sampled.colCuts, rowCuts: sampled.rowCuts, contentX: layout.content.x, contentY: layout.content.y, alphaThreshold: 128, paletteMappingPreserved: true, samplingPalette: [...palette.values()] } };
}
