/** Source-color palette learning and a single bounded, edge-aware Potts pass.
 * This changes RGB labels only. It does not infer a grid, alpha or semantics. */
export interface AdaptiveColorImage { data: Uint8ClampedArray; width: number; height: number }
export interface AdaptiveColorRefinementOptions { paletteBudget: "auto" | 40 | 64 | 96 }
export interface ColorDistanceProfile { mean: number; p95: number; p99: number; maximum: number }
interface ColorEntry { key: number; count: number; lab: readonly number[] }
interface Candidate { index: number; distanceSquared: number }
export interface AdaptiveColorRefinementDiagnostics {
  algorithm: "source-medoids-edge-potts-v1";
  paletteBudget: AdaptiveColorRefinementOptions["paletteBudget"];
  selectedBudget: number; sourcePaletteColors: number; actualPaletteColors: number;
  trainingColors: number; fallbackColors: number; opaquePixels: number;
  quantizedPixels: number; spatialChangedPixels: number; changedPixels: number;
  protectedPixels: number; passes: number; estimatedSpatialCandidateEvaluations: number;
  selectionTrials: { budget: number; error: ColorDistanceProfile }[];
  quantizationError: ColorDistanceProfile; outputError: ColorDistanceProfile;
  distanceSpace: "OKLab-times-100-Euclidean-not-CIEDE2000";
  maximumPixelDistance: 5; alphaPreserved: true; originalPaletteOnly: true;
  boundedSinglePass: true; idempotent: false; warnings: string[];
}

const MAX_PIXELS = 4_194_304, MAX_COLORS = 8192, TRAINING_COLORS = 2048;
const MAX_CANDIDATES = 4, PASSES = 3, MAX_SPATIAL_EVALUATIONS = 12_582_912;
const TRANSPARENT = 65535, MAX_DISTANCE_SQUARED = 25, LAMBDA = 8;
const EMPTY_ERROR: ColorDistanceProfile = { mean: 0, p95: 0, p99: 0, maximum: 0 };

export function normalizeAdaptiveColorRefinementOptions(parameters: Readonly<Record<string, unknown>> = {}): AdaptiveColorRefinementOptions {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) throw new Error("自动色簇整理参数须为配置对象");
  const paletteBudget = parameters.paletteBudget === undefined ? "auto" : parameters.paletteBudget;
  if (paletteBudget !== "auto" && paletteBudget !== 40 && paletteBudget !== 64 && paletteBudget !== 96) throw new Error("自动色簇整理的颜色预算须为auto、40、64或96");
  return { paletteBudget };
}
function distanceSquared(a: readonly number[], b: readonly number[]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}
function oklab(key: number): readonly number[] {
  const linear = [key >>> 16 & 255, key >>> 8 & 255, key & 255].map(v => { const x = v / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; });
  const l = Math.cbrt(.4122214708 * linear[0] + .5363325363 * linear[1] + .0514459929 * linear[2]);
  const m = Math.cbrt(.2119034982 * linear[0] + .6806995451 * linear[1] + .1073969566 * linear[2]);
  const s = Math.cbrt(.0883024619 * linear[0] + .2817188376 * linear[1] + .6299787005 * linear[2]);
  return [100 * (.2104542553 * l + .793617785 * m - .0040720468 * s), 100 * (1.9779984951 * l - 2.428592205 * m + .4505937099 * s), 100 * (.0259040371 * l + .7827717662 * m - .808675766 * s)];
}
function keyAt(data: Uint8ClampedArray, p: number): number { return data[p * 4] << 16 | data[p * 4 + 1] << 8 | data[p * 4 + 2]; }
function writeKey(data: Uint8ClampedArray, p: number, key: number): void { data[p * 4] = key >>> 16 & 255; data[p * 4 + 1] = key >>> 8 & 255; data[p * 4 + 2] = key & 255; }
function profile(weighted: { distance: number; count: number }[]): ColorDistanceProfile {
  if (!weighted.length) return { ...EMPTY_ERROR };
  weighted.sort((a, b) => a.distance - b.distance);
  const total = weighted.reduce((sum, x) => sum + x.count, 0);
  let cumulative = 0, sum = 0, p95 = 0, p99 = 0;
  for (const x of weighted) { cumulative += x.count; sum += x.distance * x.count; if (cumulative - x.count < Math.ceil(total * .95)) p95 = x.distance; if (cumulative - x.count < Math.ceil(total * .99)) p99 = x.distance; }
  return { mean: sum / total, p95, p99, maximum: weighted[weighted.length - 1].distance };
}
function nearest(entry: ColorEntry, palette: readonly ColorEntry[]): Candidate[] {
  const best: Candidate[] = [];
  for (let index = 0; index < palette.length; index++) {
    const item = { index, distanceSquared: distanceSquared(entry.lab, palette[index].lab) };
    let at = 0; while (at < best.length && (best[at].distanceSquared < item.distanceSquared || best[at].distanceSquared === item.distanceSquared && palette[best[at].index].key < palette[index].key)) at++;
    if (at < MAX_CANDIDATES) { best.splice(at, 0, item); if (best.length > MAX_CANDIDATES) best.pop(); }
  }
  return best;
}
function learnPalette(training: readonly ColorEntry[], budget: number): ColorEntry[] {
  if (training.length <= budget) return [...training].sort((a, b) => a.key - b.key);
  const selected = [training[0]], remainingDistance = new Float64Array(training.length).fill(Infinity);
  while (selected.length < budget) {
    const added = selected[selected.length - 1]; let next = -1, bestScore = -1;
    for (let i = 0; i < training.length; i++) {
      remainingDistance[i] = Math.min(remainingDistance[i], distanceSquared(training[i].lab, added.lab));
      const score = remainingDistance[i] * Math.sqrt(training[i].count);
      if (score > bestScore || score === bestScore && next !== -1 && training[i].key < training[next].key) { bestScore = score; next = i; }
    }
    if (next === -1 || bestScore <= 0) break;
    selected.push(training[next]);
  }
  let palette = selected;
  // Six palette updates, independent of pixel count and spatial scan direction.
  for (let iteration = 0; iteration < 6; iteration++) {
    const groups: ColorEntry[][] = palette.map(() => []);
    for (const entry of training) groups[nearest(entry, palette)[0].index].push(entry);
    palette = groups.map((group, i) => {
      if (!group.length) return palette[i];
      const count = group.reduce((sum, entry) => sum + entry.count, 0);
      const mean = [0, 1, 2].map(c => group.reduce((sum, entry) => sum + entry.lab[c] * entry.count, 0) / count);
      return group.reduce((a, b) => { const da = distanceSquared(a.lab, mean), db = distanceSquared(b.lab, mean); return da < db || da === db && a.key < b.key ? a : b; });
    });
  }
  return [...new Map(palette.map(entry => [entry.key, entry])).values()].sort((a, b) => a.key - b.key);
}

/** All colors are source medoids; candidate distances are capped before smoothing.
 * Checkerboard updates read only the opposite parity in a four-neighbor graph.
 * Reapplying to this result is deliberately not an idempotence guarantee. */
export function refineAdaptiveColors(image: AdaptiveColorImage, supplied: Readonly<Record<string, unknown>> = {}): { image: AdaptiveColorImage; diagnostics: AdaptiveColorRefinementDiagnostics } {
  const options = normalizeAdaptiveColorRefinementOptions(supplied);
  if (!image || !(image.data instanceof Uint8ClampedArray) || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1 || !Number.isSafeInteger(image.width * image.height) || image.width * image.height > MAX_PIXELS || image.data.length !== image.width * image.height * 4) throw new Error("自动色簇整理需要不超过419万像素的有效逻辑RGBA图");
  const { width, height, data } = image, pixels = width * height;
  const entries: ColorEntry[] = [], colorIndices = new Map<number, number>(), original = new Uint16Array(pixels).fill(TRANSPARENT);
  let opaquePixels = 0;
  for (let p = 0; p < pixels; p++) {
    const alpha = data[p * 4 + 3], key = keyAt(data, p);
    if (alpha !== 0 && alpha !== 255) throw new Error("自动色簇整理仅支持硬透明逻辑像素");
    if (!alpha) { if (key) throw new Error("透明逻辑像素包含未清零的RGB"); continue; }
    let index = colorIndices.get(key);
    if (index === undefined) {
      if (entries.length >= MAX_COLORS) throw new Error("原图超过8192种颜色，请先恢复逻辑像素网格或限色后再精修");
      index = entries.length; colorIndices.set(key, index); entries.push({ key, count: 0, lab: oklab(key) });
    }
    entries[index].count++; original[p] = index; opaquePixels++;
  }
  const warnings = ["单次有界色簇整理不具备幂等保证；重复处理结果可能继续变平，调整时应从原始输入重跑。", "只整理相近RGB色簇，不识别眼睛、材质或造型语义，不修正透明轮廓、断线或残留背景。"];
  const training = [...entries].sort((a, b) => b.count - a.count || a.key - b.key).slice(0, TRAINING_COLORS);
  if (entries.length > training.length) warnings.push("用于学习色板的颜色已按频次确定性截取至2048种；罕见远色通过原色回退保护。");
  const budgets = options.paletteBudget === "auto" ? [40, 64, 96] : [options.paletteBudget];
  const trials: AdaptiveColorRefinementDiagnostics["selectionTrials"] = [];
  let palette: ColorEntry[] = [], selectedBudget = budgets[0];
  for (const budget of budgets) {
    palette = learnPalette(training, budget); selectedBudget = budget;
    const error = profile(entries.map(entry => ({ distance: palette.length ? Math.sqrt(nearest(entry, palette)[0].distanceSquared) : 0, count: entry.count })));
    trials.push({ budget, error });
    if (error.p95 <= 2 && error.p99 <= 4 && error.maximum <= 6) break;
  }
  const selectedError = trials[trials.length - 1]?.error ?? { ...EMPTY_ERROR };
  if (selectedError.p95 > 2 || selectedError.p99 > 4 || selectedError.maximum > 6) warnings.push("可选颜色预算未达到学习色差阈值；保留原色回退，不将自动选择当作美术质量合格。");
  const sourcePalette = [...palette], paletteKeys = new Map(palette.map((entry, i) => [entry.key, i]));
  const choices: Candidate[][] = entries.map(entry => {
    const candidates = nearest(entry, sourcePalette).filter(candidate => candidate.distanceSquared <= MAX_DISTANCE_SQUARED);
    if (candidates.length) return candidates;
    let index = paletteKeys.get(entry.key);
    if (index === undefined) { index = palette.length; paletteKeys.set(entry.key, index); palette.push(entry); }
    return [{ index, distanceSquared: 0 }];
  });
  const fallbackColors = palette.length - sourcePalette.length;
  if (fallbackColors) warnings.push("部分颜色超出允许距离，已回退为原图色值；实际颜色数可能高于目标预算。");
  const initialLabels = new Uint16Array(pixels).fill(TRANSPARENT), labels = new Uint16Array(pixels).fill(TRANSPARENT), protectedMask = new Uint8Array(pixels);
  let protectedPixels = 0, quantizedPixels = 0, estimatedSpatialCandidateEvaluations = 0;
  for (let p = 0; p < pixels; p++) {
    if (original[p] === TRANSPARENT) continue;
    const entry = entries[original[p]], initial = choices[original[p]][0].index;
    initialLabels[p] = labels[p] = initial; if (entry.key !== palette[initial].key) quantizedPixels++;
    const x = p % width, y = Math.floor(p / width);
    const around = [x > 0 ? p - 1 : -1, x + 1 < width ? p + 1 : -1, y > 0 ? p - width : -1, y + 1 < height ? p + width : -1];
    if (entry.lab[0] < 18 || around.some(n => n === -1 || original[n] === TRANSPARENT || distanceSquared(entry.lab, entries[original[n]].lab) >= 225)) { protectedMask[p] = 1; protectedPixels++; }
    else if (choices[original[p]].length > 1) estimatedSpatialCandidateEvaluations += choices[original[p]].length * PASSES;
  }
  const passes = estimatedSpatialCandidateEvaluations > 0 && estimatedSpatialCandidateEvaluations <= MAX_SPATIAL_EVALUATIONS ? PASSES : 0;
  if (estimatedSpatialCandidateEvaluations > MAX_SPATIAL_EVALUATIONS) warnings.push("空间候选计算超过本次资源预算，仅完成源色色板映射；请缩小逻辑画布后再整理色簇。");
  for (let pass = 0; pass < passes; pass++) for (let parity = 0; parity < 2; parity++) for (let y = 1; y + 1 < height; y++) for (let x = 1; x + 1 < width; x++) {
    const p = y * width + x, entryId = original[p];
    if (((x + y) & 1) !== parity || entryId === TRANSPARENT || protectedMask[p] || choices[entryId].length < 2) continue;
    const entry = entries[entryId], neighbors = [p - 1, p + 1, p - width, p + width];
    const weights = neighbors.map(n => LAMBDA * Math.exp(-distanceSquared(entry.lab, entries[original[n]].lab) / 64));
    let best = labels[p], score = Infinity;
    for (const candidate of choices[entryId]) {
      let next = candidate.distanceSquared;
      for (let i = 0; i < 4; i++) if (candidate.index !== labels[neighbors[i]]) next += weights[i];
      if (next < score || next === score && palette[candidate.index].key < palette[best].key) { score = next; best = candidate.index; }
    }
    labels[p] = best;
  }
  const output = new Uint8ClampedArray(data), outputColors = new Set<number>(), errorByPair = new Map<string, { distance: number; count: number }>();
  let changedPixels = 0, spatialChangedPixels = 0;
  for (let p = 0; p < pixels; p++) {
    if (original[p] === TRANSPARENT) continue;
    const entry = entries[original[p]], result = palette[labels[p]];
    if (labels[p] !== initialLabels[p]) spatialChangedPixels++;
    if (entry.key !== result.key) { writeKey(output, p, result.key); changedPixels++; }
    outputColors.add(result.key);
    const pair = `${original[p]}:${labels[p]}`, existing = errorByPair.get(pair);
    if (existing) existing.count++; else errorByPair.set(pair, { distance: Math.sqrt(distanceSquared(entry.lab, result.lab)), count: 1 });
  }
  return { image: { width, height, data: output }, diagnostics: {
    algorithm: "source-medoids-edge-potts-v1", ...options, selectedBudget, sourcePaletteColors: entries.length, actualPaletteColors: outputColors.size,
    trainingColors: training.length, fallbackColors, opaquePixels, quantizedPixels, spatialChangedPixels, changedPixels, protectedPixels,
    passes: opaquePixels ? passes : 0, estimatedSpatialCandidateEvaluations, selectionTrials: trials,
    quantizationError: profile(entries.map((entry, i) => ({ distance: Math.sqrt(choices[i][0].distanceSquared), count: entry.count }))), outputError: profile([...errorByPair.values()]), distanceSpace: "OKLab-times-100-Euclidean-not-CIEDE2000", maximumPixelDistance: 5,
    alphaPreserved: true, originalPaletteOnly: true, boundedSinglePass: true, idempotent: false, warnings,
  } };
}
