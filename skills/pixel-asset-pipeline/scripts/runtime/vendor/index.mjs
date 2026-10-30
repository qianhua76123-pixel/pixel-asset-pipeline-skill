// Derived from Pixel Studio commit 40e333545b84285d7f135eef1abfd29d2f376ffb. MIT notice: LICENSE.upstream.
// Background-color mixture/ambiguity guard synchronized from 2696844e9b2fbf94f76e54b557654952695a308e; see ../PROVENANCE.json.
// Rebuild with npm run build; source and provenance are shipped alongside this file.

// skills/pixel-asset-pipeline/scripts/runtime/vendor/adaptive-color-refinement.ts
var MAX_PIXELS = 4194304;
var MAX_COLORS = 8192;
var TRAINING_COLORS = 2048;
var MAX_CANDIDATES = 4;
var PASSES = 3;
var MAX_SPATIAL_EVALUATIONS = 12582912;
var TRANSPARENT = 65535;
var MAX_DISTANCE_SQUARED = 25;
var LAMBDA = 8;
var EMPTY_ERROR = { mean: 0, p95: 0, p99: 0, maximum: 0 };
function normalizeAdaptiveColorRefinementOptions(parameters = {}) {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) throw new Error("\u81EA\u52A8\u8272\u7C07\u6574\u7406\u53C2\u6570\u987B\u4E3A\u914D\u7F6E\u5BF9\u8C61");
  const paletteBudget = parameters.paletteBudget === void 0 ? "auto" : parameters.paletteBudget;
  if (paletteBudget !== "auto" && paletteBudget !== 40 && paletteBudget !== 64 && paletteBudget !== 96) throw new Error("\u81EA\u52A8\u8272\u7C07\u6574\u7406\u7684\u989C\u8272\u9884\u7B97\u987B\u4E3Aauto\u300140\u300164\u621696");
  return { paletteBudget };
}
function distanceSquared(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}
function oklab(key) {
  const linear = [key >>> 16 & 255, key >>> 8 & 255, key & 255].map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * linear[0] + 0.5363325363 * linear[1] + 0.0514459929 * linear[2]);
  const m = Math.cbrt(0.2119034982 * linear[0] + 0.6806995451 * linear[1] + 0.1073969566 * linear[2]);
  const s = Math.cbrt(0.0883024619 * linear[0] + 0.2817188376 * linear[1] + 0.6299787005 * linear[2]);
  return [100 * (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s), 100 * (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s), 100 * (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s)];
}
function keyAt(data, p) {
  return data[p * 4] << 16 | data[p * 4 + 1] << 8 | data[p * 4 + 2];
}
function writeKey(data, p, key) {
  data[p * 4] = key >>> 16 & 255;
  data[p * 4 + 1] = key >>> 8 & 255;
  data[p * 4 + 2] = key & 255;
}
function profile(weighted) {
  if (!weighted.length) return { ...EMPTY_ERROR };
  weighted.sort((a, b) => a.distance - b.distance);
  const total = weighted.reduce((sum2, x) => sum2 + x.count, 0);
  let cumulative = 0, sum = 0, p95 = 0, p99 = 0;
  for (const x of weighted) {
    cumulative += x.count;
    sum += x.distance * x.count;
    if (cumulative - x.count < Math.ceil(total * 0.95)) p95 = x.distance;
    if (cumulative - x.count < Math.ceil(total * 0.99)) p99 = x.distance;
  }
  return { mean: sum / total, p95, p99, maximum: weighted[weighted.length - 1].distance };
}
function nearest(entry, palette) {
  const best = [];
  for (let index = 0; index < palette.length; index++) {
    const item = { index, distanceSquared: distanceSquared(entry.lab, palette[index].lab) };
    let at2 = 0;
    while (at2 < best.length && (best[at2].distanceSquared < item.distanceSquared || best[at2].distanceSquared === item.distanceSquared && palette[best[at2].index].key < palette[index].key)) at2++;
    if (at2 < MAX_CANDIDATES) {
      best.splice(at2, 0, item);
      if (best.length > MAX_CANDIDATES) best.pop();
    }
  }
  return best;
}
function learnPalette(training, budget) {
  if (training.length <= budget) return [...training].sort((a, b) => a.key - b.key);
  const selected = [training[0]], remainingDistance = new Float64Array(training.length).fill(Infinity);
  while (selected.length < budget) {
    const added = selected[selected.length - 1];
    let next = -1, bestScore = -1;
    for (let i = 0; i < training.length; i++) {
      remainingDistance[i] = Math.min(remainingDistance[i], distanceSquared(training[i].lab, added.lab));
      const score = remainingDistance[i] * Math.sqrt(training[i].count);
      if (score > bestScore || score === bestScore && next !== -1 && training[i].key < training[next].key) {
        bestScore = score;
        next = i;
      }
    }
    if (next === -1 || bestScore <= 0) break;
    selected.push(training[next]);
  }
  let palette = selected;
  for (let iteration = 0; iteration < 6; iteration++) {
    const groups = palette.map(() => []);
    for (const entry of training) groups[nearest(entry, palette)[0].index].push(entry);
    palette = groups.map((group, i) => {
      if (!group.length) return palette[i];
      const count = group.reduce((sum, entry) => sum + entry.count, 0);
      const mean = [0, 1, 2].map((c) => group.reduce((sum, entry) => sum + entry.lab[c] * entry.count, 0) / count);
      return group.reduce((a, b) => {
        const da = distanceSquared(a.lab, mean), db = distanceSquared(b.lab, mean);
        return da < db || da === db && a.key < b.key ? a : b;
      });
    });
  }
  return [...new Map(palette.map((entry) => [entry.key, entry])).values()].sort((a, b) => a.key - b.key);
}
function refineAdaptiveColors(image, supplied = {}) {
  const options = normalizeAdaptiveColorRefinementOptions(supplied);
  if (!image || !(image.data instanceof Uint8ClampedArray) || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1 || !Number.isSafeInteger(image.width * image.height) || image.width * image.height > MAX_PIXELS || image.data.length !== image.width * image.height * 4) throw new Error("\u81EA\u52A8\u8272\u7C07\u6574\u7406\u9700\u8981\u4E0D\u8D85\u8FC7419\u4E07\u50CF\u7D20\u7684\u6709\u6548\u903B\u8F91RGBA\u56FE");
  const { width, height, data } = image, pixels = width * height;
  const entries = [], colorIndices = /* @__PURE__ */ new Map(), original = new Uint16Array(pixels).fill(TRANSPARENT);
  let opaquePixels = 0;
  for (let p = 0; p < pixels; p++) {
    const alpha = data[p * 4 + 3], key = keyAt(data, p);
    if (alpha !== 0 && alpha !== 255) throw new Error("\u81EA\u52A8\u8272\u7C07\u6574\u7406\u4EC5\u652F\u6301\u786C\u900F\u660E\u903B\u8F91\u50CF\u7D20");
    if (!alpha) {
      if (key) throw new Error("\u900F\u660E\u903B\u8F91\u50CF\u7D20\u5305\u542B\u672A\u6E05\u96F6\u7684RGB");
      continue;
    }
    let index = colorIndices.get(key);
    if (index === void 0) {
      if (entries.length >= MAX_COLORS) throw new Error("\u539F\u56FE\u8D85\u8FC78192\u79CD\u989C\u8272\uFF0C\u8BF7\u5148\u6062\u590D\u903B\u8F91\u50CF\u7D20\u7F51\u683C\u6216\u9650\u8272\u540E\u518D\u7CBE\u4FEE");
      index = entries.length;
      colorIndices.set(key, index);
      entries.push({ key, count: 0, lab: oklab(key) });
    }
    entries[index].count++;
    original[p] = index;
    opaquePixels++;
  }
  const warnings = ["\u5355\u6B21\u6709\u754C\u8272\u7C07\u6574\u7406\u4E0D\u5177\u5907\u5E42\u7B49\u4FDD\u8BC1\uFF1B\u91CD\u590D\u5904\u7406\u7ED3\u679C\u53EF\u80FD\u7EE7\u7EED\u53D8\u5E73\uFF0C\u8C03\u6574\u65F6\u5E94\u4ECE\u539F\u59CB\u8F93\u5165\u91CD\u8DD1\u3002", "\u53EA\u6574\u7406\u76F8\u8FD1RGB\u8272\u7C07\uFF0C\u4E0D\u8BC6\u522B\u773C\u775B\u3001\u6750\u8D28\u6216\u9020\u578B\u8BED\u4E49\uFF0C\u4E0D\u4FEE\u6B63\u900F\u660E\u8F6E\u5ED3\u3001\u65AD\u7EBF\u6216\u6B8B\u7559\u80CC\u666F\u3002"];
  const training = [...entries].sort((a, b) => b.count - a.count || a.key - b.key).slice(0, TRAINING_COLORS);
  if (entries.length > training.length) warnings.push("\u7528\u4E8E\u5B66\u4E60\u8272\u677F\u7684\u989C\u8272\u5DF2\u6309\u9891\u6B21\u786E\u5B9A\u6027\u622A\u53D6\u81F32048\u79CD\uFF1B\u7F55\u89C1\u8FDC\u8272\u901A\u8FC7\u539F\u8272\u56DE\u9000\u4FDD\u62A4\u3002");
  const budgets = options.paletteBudget === "auto" ? [40, 64, 96] : [options.paletteBudget];
  const trials = [];
  let palette = [], selectedBudget = budgets[0];
  for (const budget of budgets) {
    palette = learnPalette(training, budget);
    selectedBudget = budget;
    const error = profile(entries.map((entry) => ({ distance: palette.length ? Math.sqrt(nearest(entry, palette)[0].distanceSquared) : 0, count: entry.count })));
    trials.push({ budget, error });
    if (error.p95 <= 2 && error.p99 <= 4 && error.maximum <= 6) break;
  }
  const selectedError = trials[trials.length - 1]?.error ?? { ...EMPTY_ERROR };
  if (selectedError.p95 > 2 || selectedError.p99 > 4 || selectedError.maximum > 6) warnings.push("\u53EF\u9009\u989C\u8272\u9884\u7B97\u672A\u8FBE\u5230\u5B66\u4E60\u8272\u5DEE\u9608\u503C\uFF1B\u4FDD\u7559\u539F\u8272\u56DE\u9000\uFF0C\u4E0D\u5C06\u81EA\u52A8\u9009\u62E9\u5F53\u4F5C\u7F8E\u672F\u8D28\u91CF\u5408\u683C\u3002");
  const sourcePalette = [...palette], paletteKeys = new Map(palette.map((entry, i) => [entry.key, i]));
  const choices = entries.map((entry) => {
    const candidates = nearest(entry, sourcePalette).filter((candidate) => candidate.distanceSquared <= MAX_DISTANCE_SQUARED);
    if (candidates.length) return candidates;
    let index = paletteKeys.get(entry.key);
    if (index === void 0) {
      index = palette.length;
      paletteKeys.set(entry.key, index);
      palette.push(entry);
    }
    return [{ index, distanceSquared: 0 }];
  });
  const fallbackColors = palette.length - sourcePalette.length;
  if (fallbackColors) warnings.push("\u90E8\u5206\u989C\u8272\u8D85\u51FA\u5141\u8BB8\u8DDD\u79BB\uFF0C\u5DF2\u56DE\u9000\u4E3A\u539F\u56FE\u8272\u503C\uFF1B\u5B9E\u9645\u989C\u8272\u6570\u53EF\u80FD\u9AD8\u4E8E\u76EE\u6807\u9884\u7B97\u3002");
  const initialLabels = new Uint16Array(pixels).fill(TRANSPARENT), labels = new Uint16Array(pixels).fill(TRANSPARENT), protectedMask = new Uint8Array(pixels);
  let protectedPixels = 0, quantizedPixels = 0, estimatedSpatialCandidateEvaluations = 0;
  for (let p = 0; p < pixels; p++) {
    if (original[p] === TRANSPARENT) continue;
    const entry = entries[original[p]], initial = choices[original[p]][0].index;
    initialLabels[p] = labels[p] = initial;
    if (entry.key !== palette[initial].key) quantizedPixels++;
    const x = p % width, y = Math.floor(p / width);
    const around2 = [x > 0 ? p - 1 : -1, x + 1 < width ? p + 1 : -1, y > 0 ? p - width : -1, y + 1 < height ? p + width : -1];
    if (entry.lab[0] < 18 || around2.some((n) => n === -1 || original[n] === TRANSPARENT || distanceSquared(entry.lab, entries[original[n]].lab) >= 225)) {
      protectedMask[p] = 1;
      protectedPixels++;
    } else if (choices[original[p]].length > 1) estimatedSpatialCandidateEvaluations += choices[original[p]].length * PASSES;
  }
  const passes = estimatedSpatialCandidateEvaluations > 0 && estimatedSpatialCandidateEvaluations <= MAX_SPATIAL_EVALUATIONS ? PASSES : 0;
  if (estimatedSpatialCandidateEvaluations > MAX_SPATIAL_EVALUATIONS) warnings.push("\u7A7A\u95F4\u5019\u9009\u8BA1\u7B97\u8D85\u8FC7\u672C\u6B21\u8D44\u6E90\u9884\u7B97\uFF0C\u4EC5\u5B8C\u6210\u6E90\u8272\u8272\u677F\u6620\u5C04\uFF1B\u8BF7\u7F29\u5C0F\u903B\u8F91\u753B\u5E03\u540E\u518D\u6574\u7406\u8272\u7C07\u3002");
  for (let pass = 0; pass < passes; pass++) for (let parity = 0; parity < 2; parity++) for (let y = 1; y + 1 < height; y++) for (let x = 1; x + 1 < width; x++) {
    const p = y * width + x, entryId = original[p];
    if ((x + y & 1) !== parity || entryId === TRANSPARENT || protectedMask[p] || choices[entryId].length < 2) continue;
    const entry = entries[entryId], neighbors4 = [p - 1, p + 1, p - width, p + width];
    const weights = neighbors4.map((n) => LAMBDA * Math.exp(-distanceSquared(entry.lab, entries[original[n]].lab) / 64));
    let best = labels[p], score = Infinity;
    for (const candidate of choices[entryId]) {
      let next = candidate.distanceSquared;
      for (let i = 0; i < 4; i++) if (candidate.index !== labels[neighbors4[i]]) next += weights[i];
      if (next < score || next === score && palette[candidate.index].key < palette[best].key) {
        score = next;
        best = candidate.index;
      }
    }
    labels[p] = best;
  }
  const output = new Uint8ClampedArray(data), outputColors = /* @__PURE__ */ new Set(), errorByPair = /* @__PURE__ */ new Map();
  let changedPixels = 0, spatialChangedPixels = 0;
  for (let p = 0; p < pixels; p++) {
    if (original[p] === TRANSPARENT) continue;
    const entry = entries[original[p]], result = palette[labels[p]];
    if (labels[p] !== initialLabels[p]) spatialChangedPixels++;
    if (entry.key !== result.key) {
      writeKey(output, p, result.key);
      changedPixels++;
    }
    outputColors.add(result.key);
    const pair = `${original[p]}:${labels[p]}`, existing = errorByPair.get(pair);
    if (existing) existing.count++;
    else errorByPair.set(pair, { distance: Math.sqrt(distanceSquared(entry.lab, result.lab)), count: 1 });
  }
  return { image: { width, height, data: output }, diagnostics: {
    algorithm: "source-medoids-edge-potts-v1",
    ...options,
    selectedBudget,
    sourcePaletteColors: entries.length,
    actualPaletteColors: outputColors.size,
    trainingColors: training.length,
    fallbackColors,
    opaquePixels,
    quantizedPixels,
    spatialChangedPixels,
    changedPixels,
    protectedPixels,
    passes: opaquePixels ? passes : 0,
    estimatedSpatialCandidateEvaluations,
    selectionTrials: trials,
    quantizationError: profile(entries.map((entry, i) => ({ distance: Math.sqrt(choices[i][0].distanceSquared), count: entry.count }))),
    outputError: profile([...errorByPair.values()]),
    distanceSpace: "OKLab-times-100-Euclidean-not-CIEDE2000",
    maximumPixelDistance: 5,
    alphaPreserved: true,
    originalPaletteOnly: true,
    boundedSinglePass: true,
    idempotent: false,
    warnings
  } };
}

// skills/pixel-asset-pipeline/scripts/runtime/vendor/background-color-refinement.ts
var MAX_NATIVE = 4194304;
var MAX_SOURCE = 16777216;
var MAX_CELL = 4096;
var MAX_COLORS2 = 8192;
var MAX_CANDIDATES2 = 1e4;
var MAX_COMPARISONS = 8e6;
var MAX_RECORDS = 2e3;
var AROUND = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
function validImage(im, max) {
  return !!im && im.data instanceof Uint8ClampedArray && Number.isSafeInteger(im.width) && Number.isSafeInteger(im.height) && im.width > 0 && im.height > 0 && im.width * im.height <= max && im.data.length === im.width * im.height * 4;
}
function cuts(v, max) {
  return Array.isArray(v) && v.length >= 2 && v.every((n, i) => Number.isSafeInteger(n) && n >= 0 && n <= max && (!i || n > v[i - 1]));
}
var at = (data, p) => [data[p * 4], data[p * 4 + 1], data[p * 4 + 2]];
var packed = (c) => c[0] * 65536 + c[1] * 256 + c[2];
var difference = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
var luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
function direction(c, key) {
  const cm = (c[0] + c[1] + c[2]) / 3, km = (key[0] + key[1] + key[2]) / 3;
  const u = [c[0] - cm, c[1] - cm, c[2] - cm], v = [key[0] - km, key[1] - km, key[2] - km];
  const a = Math.hypot(...u), b = Math.hypot(...v);
  return a < 10 || b < 10 ? -1 : (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (a * b);
}
function mixture(c, donor, key) {
  const d = [key[0] - donor[0], key[1] - donor[1], key[2] - donor[2]], denominator = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
  if (denominator < 4096) return { t: Infinity, residual: Infinity };
  const t = ((c[0] - donor[0]) * d[0] + (c[1] - donor[1]) * d[1] + (c[2] - donor[2]) * d[2]) / denominator;
  return { t, residual: Math.max(...c.map((n, i) => Math.abs(n - (donor[i] + t * d[i])))) };
}
function neighbors(p, width, height) {
  const x = p % width, y = Math.floor(p / width), result = [];
  for (const [dx, dy] of AROUND) if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height) result.push((y + dy) * width + x + dx);
  return result;
}
function refineBackgroundColors(current, evidence) {
  if (!validImage(current, MAX_NATIVE)) throw new Error("\u80CC\u666F\u53BB\u6C61\u67D3\u9700\u8981419\u4E07\u50CF\u7D20\u4EE5\u5185\u7684\u6709\u6548\u903B\u8F91RGBA\u56FE");
  const { width, height, data } = current, paletteBefore = /* @__PURE__ */ new Set();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 0 && data[i + 3] !== 255 || !data[i + 3] && (data[i] || data[i + 1] || data[i + 2])) throw new Error("\u80CC\u666F\u53BB\u6C61\u67D3\u9700\u8981\u786C\u900F\u660E\u4E14\u900F\u660ERGB\u6E05\u96F6\u7684\u903B\u8F91\u50CF\u7D20");
    if (data[i + 3]) paletteBefore.add(data[i] * 65536 + data[i + 1] * 256 + data[i + 2]);
  }
  if (paletteBefore.size > MAX_COLORS2) throw new Error("\u80CC\u666F\u53BB\u6C61\u67D3\u8F93\u5165\u8D85\u8FC78192\u79CD\u53EF\u89C1\u989C\u8272\uFF0C\u8BF7\u5148\u786E\u8BA4\u903B\u8F91\u7F51\u683C");
  const output = new Uint8ClampedArray(data), suppliedKey = evidence?.keyColor;
  const key = typeof suppliedKey === "string" && suppliedKey.length === 7 && /^#[0-9a-f]{6}$/i.test(suppliedKey) ? [1, 3, 5].map((i) => parseInt(suppliedKey.slice(i, i + 2), 16)) : [0, 0, 0];
  const neutral = Math.max(...key) - Math.min(...key) < 48;
  const diagnostics = {
    algorithm: "source-cell-local-background-color-v1",
    sourceMixtureRequired: true,
    donorAmbiguityPolicy: "equivalent-evidence-preserve-v1",
    skipped: false,
    keyColor: typeof suppliedKey === "string" ? suppliedKey.toLowerCase() : "",
    keyKind: neutral ? "neutral" : "chromatic",
    changedPixels: 0,
    recoloredPixels: 0,
    candidatePixels: 0,
    evaluatedPixels: 0,
    protectedMaterialPixels: 0,
    uncertainPixels: 0,
    unprocessedPixels: 0,
    alphaPreserved: true,
    sourceColorsOnly: true,
    inputOrSourceColorsOnly: true,
    colorOrigin: "frozen-input-or-verified-source",
    noInterpolatedColors: true,
    originalPaletteOnly: true,
    colorsBefore: paletteBefore.size,
    colorsAfter: paletteBefore.size,
    newSourceColors: 0,
    keyEvidencePixels: 0,
    removedRawPixels: 0,
    keyEvidenceRatio: 0,
    comparisonBudget: MAX_COMPARISONS,
    comparisonUnits: 0,
    budgetExhausted: false,
    candidateLimitReached: false,
    refusedReasons: {},
    changes: [],
    changesTruncated: 0,
    uncertain: [],
    uncertainTruncated: 0,
    warnings: ["\u4EC5\u7528\u914D\u51C6\u539F\u56FE\u548C\u5C40\u90E8\u6750\u8D28\u652F\u6301\u4FEE\u6B63\u80CC\u666F\u6DF7\u8272\uFF0C\u4E0D\u6539\u53D8\u900F\u660E\u8F6E\u5ED3\u6216\u8865\u5B54\uFF1B\u771F\u5B9E\u9AD8\u5149\u3001\u7C89\u8272\u73BB\u7483\u548C\u9752\u7EFF\u8272\u7EC6\u8282\u4ECD\u9700\u5BF9\u7167\u68C0\u67E5\u3002", "\u53D8\u5316\u91CF\u4E0D\u4EE3\u8868\u6B63\u786E\u7387\uFF1B\u6CA1\u6709\u53EF\u9760\u8BC1\u636E\u7684\u989C\u8272\u4FDD\u7559\u539F\u6837\u3002"]
  };
  const result = () => ({ image: { data: output, width, height }, diagnostics });
  const skip = (reason) => {
    diagnostics.skipped = true;
    diagnostics.skipReason = reason;
    return result();
  };
  if (!evidence) return skip("missing-source-evidence");
  if (typeof suppliedKey !== "string" || suppliedKey.length !== 7 || !/^#[0-9a-f]{6}$/i.test(suppliedKey)) return skip("invalid-key-color");
  if (evidence.paletteMappingPreserved !== true) return skip("palette-mapping-not-preserved");
  const source = evidence.sourceRGBA, raw = evidence.unmattedSourceRGBA;
  if (!raw) return skip("missing-verified-pre-cutout-source");
  if (!validImage(source, MAX_SOURCE) || !validImage(raw, MAX_SOURCE) || source.width !== raw.width || source.height !== raw.height) return skip("invalid-source-dimensions");
  const { colCuts, rowCuts } = evidence, contentX = evidence.contentX ?? 0, contentY = evidence.contentY ?? 0, threshold = evidence.alphaThreshold ?? 128;
  if (!cuts(colCuts, source.width) || !cuts(rowCuts, source.height) || !Number.isSafeInteger(contentX) || !Number.isSafeInteger(contentY) || contentX < 0 || contentY < 0 || colCuts.length - 1 + contentX > width || rowCuts.length - 1 + contentY > height || !Number.isSafeInteger(threshold) || threshold < 1 || threshold > 254) return skip("invalid-source-mapping");
  let maxCellWidth = 0, maxCellHeight = 0;
  for (let i = 1; i < colCuts.length; i++) maxCellWidth = Math.max(maxCellWidth, colCuts[i] - colCuts[i - 1]);
  for (let i = 1; i < rowCuts.length; i++) maxCellHeight = Math.max(maxCellHeight, rowCuts[i] - rowCuts[i - 1]);
  if (maxCellWidth * maxCellHeight > MAX_CELL) return skip("source-cell-too-large");
  if (Math.max(...key) < 96) return skip("dark-key-ambiguous");
  const inContent = (x, y) => x >= contentX && y >= contentY && x - contentX < colCuts.length - 1 && y - contentY < rowCuts.length - 1;
  for (let p = 0; p < width * height; p++) if (data[p * 4 + 3] && !inContent(p % width, Math.floor(p / width))) return skip("opaque-outside-recorded-content");
  for (let p = 0; p < source.width * source.height; p++) {
    const i = p * 4;
    if (source.data[i + 3] > raw.data[i + 3] || source.data[i + 3] > 0 && (source.data[i] !== raw.data[i] || source.data[i + 1] !== raw.data[i + 1] || source.data[i + 2] !== raw.data[i + 2])) return skip("retained-source-rgba-mismatch");
    const x = p % source.width, y = Math.floor(p / source.width);
    if (x < colCuts[0] || x >= colCuts[colCuts.length - 1] || y < rowCuts[0] || y >= rowCuts[rowCuts.length - 1] || source.data[i + 3] >= threshold || raw.data[i + 3] < threshold) continue;
    diagnostics.removedRawPixels++;
    if (difference(at(raw.data, p), key) <= 24) diagnostics.keyEvidencePixels++;
  }
  diagnostics.keyEvidenceRatio = diagnostics.removedRawPixels ? diagnostics.keyEvidencePixels / diagnostics.removedRawPixels : 0;
  if (diagnostics.keyEvidencePixels < 4 || diagnostics.keyEvidenceRatio < 0.6) return skip("key-evidence-mismatch");
  const isCandidateColor = (c) => neutral ? Math.max(...c) - Math.min(...c) <= 48 && luma(c) >= Math.max(48, luma(key) * 0.25) && luma(c) <= luma(key) : direction(c, key) >= 0.94;
  const isCleanColor = (c) => difference(c, key) > 32 && (neutral ? !isCandidateColor(c) : direction(c, key) < 0.85);
  const candidate = new Uint8Array(width * height), protectedMaterial = new Uint8Array(width * height);
  for (let p = 0; p < candidate.length; p++) if (data[p * 4 + 3] && isCandidateColor(at(data, p))) {
    candidate[p] = 1;
    diagnostics.candidatePixels++;
  }
  const visited = new Uint8Array(candidate.length);
  for (let p = 0; p < candidate.length; p++) if (candidate[p] && !visited[p]) {
    const group = [p];
    visited[p] = 1;
    let core = false;
    for (let head = 0; head < group.length; head++) {
      const q = group[head], ns = neighbors(q, width, height);
      if (ns.length === 8 && ns.every((n) => candidate[n])) core = true;
      for (const n of ns) if (candidate[n] && !visited[n]) {
        visited[n] = 1;
        group.push(n);
      }
    }
    if (core) for (const q of group) protectedMaterial[q] = 1;
  }
  const refuse = (p, reason, protectedColor = false) => {
    diagnostics.refusedReasons[reason] = (diagnostics.refusedReasons[reason] ?? 0) + 1;
    if (protectedColor) diagnostics.protectedMaterialPixels++;
    else {
      diagnostics.uncertainPixels++;
      if (diagnostics.uncertain.length < MAX_RECORDS) diagnostics.uncertain.push({ x: p % width, y: Math.floor(p / width), reason });
      else diagnostics.uncertainTruncated++;
    }
  };
  const compare = () => {
    if (diagnostics.comparisonUnits >= MAX_COMPARISONS) {
      diagnostics.budgetExhausted = true;
      return false;
    }
    diagnostics.comparisonUnits++;
    return true;
  };
  const cellFor = (p) => {
    const x = p % width - contentX, y = Math.floor(p / width) - contentY;
    return { left: colCuts[x], right: colCuts[x + 1], top: rowCuts[y], bottom: rowCuts[y + 1] };
  };
  const readCell = (p) => {
    const b = cellFor(p), cell = { colors: [], total: (b.right - b.left) * (b.bottom - b.top), visible: 0, removed: 0, keyLike: 0 };
    for (let y = b.top; y < b.bottom; y++) for (let x = b.left; x < b.right; x++) {
      if (!compare()) return;
      const q = y * source.width + x, i = q * 4;
      if (raw.data[i + 3] < threshold) continue;
      if (source.data[i + 3] < threshold) {
        if (difference(at(raw.data, q), key) <= 24) cell.removed++;
        continue;
      }
      const color = at(raw.data, q);
      cell.colors.push({ color, p: q });
      cell.visible++;
      if (isCandidateColor(color)) cell.keyLike++;
    }
    return cell;
  };
  const paletteAfter = new Set(paletteBefore);
  pixels: for (let p = 0; p < candidate.length; p++) if (candidate[p]) {
    if (diagnostics.evaluatedPixels >= MAX_CANDIDATES2) {
      diagnostics.candidateLimitReached = true;
      break;
    }
    diagnostics.evaluatedPixels++;
    if (protectedMaterial[p]) {
      refuse(p, "broad-key-like-material", true);
      continue;
    }
    const original = at(data, p);
    if (difference(original, key) <= 24) {
      refuse(p, "near-key-pixel-needs-alpha-decision");
      continue;
    }
    const cell = readCell(p);
    if (!cell) break pixels;
    const minMatches = Math.max(2, Math.ceil(cell.total * 0.2));
    if (cell.visible * 2 < cell.total) {
      refuse(p, "insufficient-source-foreground-coverage");
      continue;
    }
    let currentSupport = 0;
    for (const item of cell.colors) {
      if (!compare()) break pixels;
      if (difference(item.color, original) <= 16) currentSupport++;
    }
    const queue = [{ p, distance: 0 }], seen = /* @__PURE__ */ new Set([p]), nearby = [];
    let coherent = 0;
    for (let head = 0; head < queue.length; head++) {
      const point = queue[head];
      if (point.distance === 3) continue;
      for (const n of neighbors(point.p, width, height)) if (data[n * 4 + 3] && inContent(n % width, Math.floor(n / width)) && !seen.has(n)) {
        seen.add(n);
        const distance = point.distance + 1, color2 = at(data, n);
        queue.push({ p: n, distance });
        if (distance <= 1 && difference(color2, original) <= 16) coherent++;
        if (isCleanColor(color2)) nearby.push({ p: n, distance, color: color2 });
      }
    }
    if (!neutral && coherent >= 2 && currentSupport * 2 >= cell.visible) {
      refuse(p, "source-supported-colored-structure", true);
      continue;
    }
    if (!nearby.length) {
      refuse(p, "no-connected-clean-native-material");
      continue;
    }
    const b = cellFor(p);
    let exposure = cell.removed;
    for (let y = Math.max(0, b.top - 1); y < Math.min(source.height, b.bottom + 1); y++) for (let x = Math.max(0, b.left - 1); x < Math.min(source.width, b.right + 1); x++) {
      if (x >= b.left && x < b.right && y >= b.top && y < b.bottom) continue;
      if (!compare()) break pixels;
      const q = y * source.width + x;
      if (source.data[q * 4 + 3] < threshold && raw.data[q * 4 + 3] >= threshold && difference(at(raw.data, q), key) <= 24) exposure++;
    }
    const sourceColors = /* @__PURE__ */ new Map();
    for (const item of cell.colors) if (isCleanColor(item.color)) {
      const key2 = packed(item.color), old = sourceColors.get(key2);
      if (old) old.count++;
      else sourceColors.set(key2, { ...item, count: 1 });
    }
    const proposals = [...sourceColors.values()].sort((a, b2) => b2.count - a.count || a.p - b2.p).slice(0, 16).map((x) => ({ ...x, kind: "source", distance: 0 }));
    const used = /* @__PURE__ */ new Set();
    for (const n of nearby) if (!used.has(packed(n.color))) {
      used.add(packed(n.color));
      proposals.push({ ...n, kind: "native" });
      if (used.size === 16) break;
    }
    const qualified = [];
    let best;
    for (const proposal of proposals) {
      let support = 0;
      for (const n of nearby) {
        if (!compare()) break pixels;
        if (difference(n.color, proposal.color) <= 24) support++;
      }
      if (support < 2 || difference(original, proposal.color) < 12) continue;
      let cleanMatches = 0;
      for (const item of cell.colors) {
        if (!compare()) break pixels;
        if (isCleanColor(item.color) && difference(item.color, proposal.color) <= 20) cleanMatches++;
      }
      const fit = mixture(original, proposal.color, key);
      let reason;
      if (cleanMatches >= minMatches && cell.keyLike >= 2 && fit.t >= 0.04 && fit.t <= 0.9 && fit.residual <= 16) reason = "source-cell-clean-material";
      if (!reason && proposal.kind === "native" && exposure >= 2 && fit.t >= 0.08 && fit.t <= 0.85 && fit.residual <= 10) {
        const donorCell = readCell(proposal.p);
        if (!donorCell) break pixels;
        let donorMatches = 0;
        for (const item of donorCell.colors) {
          if (!compare()) break pixels;
          if (difference(item.color, proposal.color) <= 24 && isCleanColor(item.color)) donorMatches++;
        }
        if (donorCell.visible * 2 >= donorCell.total && donorMatches >= Math.max(2, Math.ceil(donorCell.total * 0.4))) {
          let explained = 0, weighted = 0;
          for (const item of cell.colors) {
            if (!compare()) break pixels;
            const f = mixture(item.color, proposal.color, key);
            if (f.t >= -0.05 && f.t <= 0.85 && f.residual <= 10) {
              explained++;
              weighted += 1 - Math.max(0, f.t);
            }
          }
          if (explained * 4 >= cell.visible * 3 && weighted >= cell.visible * 0.35) reason = "source-neighbor-mixture-material";
        }
      }
      if (!reason) continue;
      const residual = Number.isFinite(fit.residual) ? fit.residual : 255;
      const score = (reason === "source-cell-clean-material" ? -1e3 : 0) - cleanMatches * 10 + residual + proposal.distance - Math.min(6, support);
      qualified.push({ proposal, matches: cleanMatches, support, residual, score, reason });
      if (!best || score < best.score || score === best.score && (proposal.kind === "native" && best.proposal.kind !== "native" || proposal.kind === best.proposal.kind && proposal.p < best.proposal.p)) best = { proposal, matches: cleanMatches, support, residual, score, reason };
    }
    if (!best) {
      refuse(p, "insufficient-local-source-material-evidence");
      continue;
    }
    const selected = best;
    if (qualified.some((other) => other.reason === selected.reason && other.matches === selected.matches && Math.abs(Math.min(6, other.support) - Math.min(6, selected.support)) <= 1 && Math.abs(other.residual - selected.residual) <= 2 && difference(other.proposal.color, selected.proposal.color) > 24)) {
      refuse(p, "ambiguous-local-source-material");
      continue;
    }
    const color = packed(best.proposal.color);
    if (!paletteAfter.has(color) && paletteAfter.size >= MAX_COLORS2) {
      refuse(p, "output-color-budget");
      continue;
    }
    paletteAfter.add(color);
    output.set(best.proposal.color, p * 4);
    diagnostics.changedPixels++;
    diagnostics.recoloredPixels++;
    if (diagnostics.changes.length < MAX_RECORDS) diagnostics.changes.push({ x: p % width, y: Math.floor(p / width), beforeRGBA: [...original, 255], afterRGBA: [...best.proposal.color, 255], reason: best.reason, donor: { kind: best.proposal.kind, x: best.proposal.p % (best.proposal.kind === "source" ? source.width : width), y: Math.floor(best.proposal.p / (best.proposal.kind === "source" ? source.width : width)) }, nativeSupport: best.support, cleanSourceMatches: best.matches, sourceVisible: cell.visible, sourceTotal: cell.total, removedKeySamples: exposure, mixtureResidual: best.residual });
    else diagnostics.changesTruncated++;
  }
  diagnostics.unprocessedPixels = diagnostics.candidatePixels - diagnostics.evaluatedPixels;
  if (diagnostics.budgetExhausted) {
    diagnostics.unprocessedPixels++;
    diagnostics.evaluatedPixels--;
  }
  const actualColors = /* @__PURE__ */ new Set();
  for (let i = 0; i < output.length; i += 4) if (output[i + 3]) actualColors.add(output[i] * 65536 + output[i + 1] * 256 + output[i + 2]);
  diagnostics.colorsAfter = actualColors.size;
  diagnostics.newSourceColors = [...actualColors].filter((c) => !paletteBefore.has(c)).length;
  diagnostics.originalPaletteOnly = diagnostics.newSourceColors === 0;
  if (diagnostics.budgetExhausted || diagnostics.candidateLimitReached) diagnostics.warnings.push("\u8FBE\u5230\u672C\u6B21\u8BA1\u7B97\u4E0A\u9650\uFF0C\u672A\u5B8C\u6210\u8BC4\u4F30\u7684\u50CF\u7D20\u4FDD\u7559\u539F\u6837\u3002");
  return result();
}

// skills/pixel-asset-pipeline/scripts/runtime/vendor/material-color-refinement.ts
var MAX_PIXELS2 = 4194304;
var MAX_COLORS3 = 8192;
var MAX_EVALUATIONS = 1e4;
var MAX_COMPARISONS2 = 8e6;
var MAX_CHANGES = 4e3;
var AROUND2 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
var colorAt = (data, p) => [data[p * 4], data[p * 4 + 1], data[p * 4 + 2]];
var luma2 = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
var difference2 = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
function neighbors2(p, width, height) {
  const x = p % width, y = Math.floor(p / width), result = [];
  for (const [dx, dy] of AROUND2) if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height) result.push((y + dy) * width + x + dx);
  return result;
}
function normalizeMaterialColorOptions(parameters = {}) {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters) || parameters.profile !== "foliage" && parameters.profile !== "glass") throw new Error("\u8BF7\u9009\u62E9\u53F6\u7247\u6216\u73BB\u7483\u6750\u8D28\u540E\u518D\u6E05\u7406\u6B8B\u8272");
  return { profile: parameters.profile };
}
function refineMaterialColors(image, parameters) {
  const { profile: profile2 } = normalizeMaterialColorOptions(parameters);
  if (!image || !(image.data instanceof Uint8ClampedArray) || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > MAX_PIXELS2 || image.data.length !== image.width * image.height * 4) throw new Error("\u6750\u8D28\u6B8B\u8272\u6E05\u7406\u9700\u8981419\u4E07\u50CF\u7D20\u4EE5\u5185\u7684\u6709\u6548\u903B\u8F91RGBA\u56FE");
  const { data, width, height } = image, count = width * height, palette = /* @__PURE__ */ new Set();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 0 && data[i + 3] !== 255 || !data[i + 3] && (data[i] || data[i + 1] || data[i + 2])) throw new Error("\u6750\u8D28\u6B8B\u8272\u6E05\u7406\u9700\u8981\u786C\u900F\u660E\u4E14\u900F\u660ERGB\u6E05\u96F6\u7684\u903B\u8F91\u50CF\u7D20");
    if (data[i + 3]) palette.add(data[i] << 16 | data[i + 1] << 8 | data[i + 2]);
    if (palette.size > MAX_COLORS3) throw new Error("\u6750\u8D28\u6B8B\u8272\u6E05\u7406\u8F93\u5165\u8D85\u8FC78192\u79CD\u53EF\u89C1\u989C\u8272\uFF0C\u8BF7\u5148\u786E\u8BA4\u903B\u8F91\u7F51\u683C");
  }
  const output = new Uint8ClampedArray(data), candidate = new Uint8Array(count), protectedMap = new Uint8Array(count), boundaryDistance = new Uint8Array(count).fill(255);
  const diagnostics = {
    algorithm: "explicit-material-local-color-v1",
    profile: profile2,
    alphaPreserved: true,
    localPaletteOnly: true,
    inferred: true,
    sourceRecoveryClaimed: false,
    singleFrozenPass: true,
    idempotent: false,
    changedPixels: 0,
    candidatePixels: 0,
    evaluatedPixels: 0,
    protectedPixels: 0,
    uncertainPixels: 0,
    unprocessedPixels: 0,
    budgetExhausted: false,
    comparisonUnits: 0,
    comparisonBudget: MAX_COMPARISONS2,
    candidateBudget: MAX_EVALUATIONS,
    changes: [],
    changesTruncated: 0,
    refusedReasons: {},
    warnings: ["\u8FD9\u662F\u6309\u5DF2\u9009\u6750\u8D28\u4F5C\u5C40\u90E8\u63A8\u65AD\uFF0C\u4F7F\u7528\u90BB\u8FD1\u539F\u8272\uFF0C\u4E0D\u80FD\u8BC1\u660E\u627E\u56DE\u4E86\u4E22\u5931\u7684\u771F\u5B9E\u989C\u8272\u3002", "\u4FDD\u7559\u900F\u660E\u8F6E\u5ED3\u4E0E\u539F\u751F\u5C3A\u5BF8\uFF1B\u7EC6\u5C0F\u7684\u771F\u5B9E\u9752\u8272\u6216\u7D2B\u8272\u88C5\u9970\u4ECD\u53EF\u80FD\u8BEF\u5224\uFF0C\u8BF7\u5BF9\u7167\u539F\u56FE\u68C0\u67E5\u3002"]
  };
  for (let p = 0; p < count; p++) if (data[p * 4 + 3]) {
    const ns = neighbors2(p, width, height);
    if (ns.length !== 8 || ns.some((q) => !data[q * 4 + 3])) boundaryDistance[p] = 1;
  }
  if (profile2 === "glass") {
    for (let p = 0; p < count; p++) if (data[p * 4 + 3] && boundaryDistance[p] !== 1 && neighbors2(p, width, height).some((q) => boundaryDistance[q] === 1)) boundaryDistance[p] = 2;
  }
  const isCandidate = (c) => profile2 === "foliage" ? c[1] >= 160 && c[2] >= 140 && c[1] - c[0] >= 75 && c[2] - c[0] >= 70 && Math.abs(c[1] - c[2]) <= 50 : Math.min(c[0], c[2]) >= 30 && Math.min(c[0], c[2]) - c[1] >= 18 && c[1] < Math.min(c[0], c[2]) * 0.52;
  for (let p = 0; p < count; p++) if (data[p * 4 + 3] && isCandidate(colorAt(data, p))) candidate[p] = 1;
  const visited = new Uint8Array(count);
  for (let p = 0; p < count; p++) if (candidate[p] && !visited[p]) {
    const group = [p];
    visited[p] = 1;
    let core = false, line = false;
    for (let head = 0; head < group.length; head++) {
      const q = group[head], ns = neighbors2(q, width, height);
      if (ns.length === 8 && ns.every((n) => candidate[n])) core = true;
      for (const n of ns) if (candidate[n] && !visited[n]) {
        visited[n] = 1;
        group.push(n);
      }
      if (profile2 === "foliage" && !line && group.length <= 12) for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const x = q % width, y = Math.floor(q / width);
        if (Array.from({ length: 4 }, (_, k) => [x + k * dx, y + k * dy]).every(([xx, yy]) => xx >= 0 && yy >= 0 && xx < width && yy < height && candidate[yy * width + xx])) line = true;
      }
    }
    if (core || profile2 === "foliage" && (line || group.length > 12)) for (const q of group) protectedMap[q] = 1;
  }
  const refuse = (reason, protect = false) => {
    diagnostics.refusedReasons[reason] = (diagnostics.refusedReasons[reason] || 0) + 1;
    if (protect) diagnostics.protectedPixels++;
    else diagnostics.uncertainPixels++;
  };
  const compare = () => {
    if (diagnostics.comparisonUnits >= MAX_COMPARISONS2) {
      diagnostics.budgetExhausted = true;
      return false;
    }
    diagnostics.comparisonUnits++;
    return true;
  };
  for (let p = 0; p < count; p++) if (candidate[p]) diagnostics.candidatePixels++;
  pixels: for (let p = 0; p < count; p++) if (candidate[p]) {
    if (diagnostics.evaluatedPixels >= MAX_EVALUATIONS) {
      diagnostics.budgetExhausted = true;
      break;
    }
    diagnostics.evaluatedPixels++;
    if (protectedMap[p]) {
      refuse("coherent-colored-structure", true);
      continue;
    }
    if (profile2 === "glass" && boundaryDistance[p] > 2) {
      refuse("not-glass-alpha-boundary", true);
      continue;
    }
    const original = colorAt(data, p), queue = [{ p, distance: 0 }], seen = /* @__PURE__ */ new Set([p]), context = [];
    for (let head = 0; head < queue.length; head++) {
      const point = queue[head];
      if (point.distance === 4) continue;
      for (const q of neighbors2(point.p, width, height)) {
        if (!compare()) break pixels;
        if (!data[q * 4 + 3] || seen.has(q)) continue;
        seen.add(q);
        const distance = point.distance + 1;
        queue.push({ p: q, distance });
        if (!candidate[q]) context.push({ p: q, distance, color: colorAt(data, q) });
      }
    }
    const material = context.filter((n) => profile2 === "foliage" ? n.color[1] - n.color[0] >= 12 && n.color[1] - n.color[2] >= 14 && n.color[1] >= 35 : Math.max(...n.color) - Math.min(...n.color) <= 32 && luma2(n.color) <= Math.max(72, luma2(original) * 1.25));
    const coloredContext = context.filter((n) => Math.max(...n.color) - Math.min(...n.color) >= 12 && Math.max(...n.color) >= 35);
    if (material.length < (profile2 === "foliage" ? 5 : 3) || profile2 === "foliage" && material.length < coloredContext.length * 0.6) {
      refuse("insufficient-local-material-consensus");
      continue;
    }
    const proposals = material.filter((n) => n.distance <= 3);
    let best;
    for (const donor of proposals) {
      let support = 0;
      for (const n of material) {
        if (!compare()) break pixels;
        if (difference2(n.color, donor.color) <= (profile2 === "foliage" ? 32 : 18)) support++;
      }
      if (support < 3) continue;
      const closeLuma = profile2 === "foliage" ? Math.abs(luma2(donor.color) - Math.min(luma2(original), material.reduce((sum, n) => sum + luma2(n.color), 0) / material.length + 18)) : Math.abs(luma2(donor.color) - luma2(original));
      const score = donor.distance * 8 + closeLuma * 0.35 - Math.min(12, support) * 2;
      if (!best || score < best.score || score === best.score && donor.p < best.p) best = { p: donor.p, color: donor.color, support, score };
    }
    if (!best) {
      refuse("no-coherent-local-original-color");
      continue;
    }
    output.set(best.color, p * 4);
    diagnostics.changedPixels++;
    if (diagnostics.changes.length < MAX_CHANGES) diagnostics.changes.push({ x: p % width, y: Math.floor(p / width), beforeRGBA: [...original, 255], afterRGBA: [...best.color, 255], reason: profile2 === "foliage" ? "inferred-local-leaf-material" : "inferred-neutral-glass-outline", donor: { x: best.p % width, y: Math.floor(best.p / width), rgba: [...best.color, 255] }, supportPixels: best.support, materialPixels: material.length, contextPixels: context.length, confidence: "local-material-consensus", inferred: true });
    else diagnostics.changesTruncated++;
  }
  diagnostics.unprocessedPixels = diagnostics.candidatePixels - diagnostics.evaluatedPixels;
  if (diagnostics.budgetExhausted) diagnostics.warnings.push("\u8FBE\u5230\u672C\u6B21\u8BA1\u7B97\u4E0A\u9650\uFF0C\u5269\u4F59\u989C\u8272\u4FDD\u7559\u539F\u6837\u3002");
  return { image: { data: output, width, height }, diagnostics };
}

// skills/pixel-asset-pipeline/scripts/runtime/vendor/contour-detail-refinement.ts
var MAX_PIXELS3 = 4194304;
var MAX_CHANGES2 = 1e4;
var MAX_COMPARISONS3 = 8e6;
var EIGHT = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
var FOUR = [[0, -1], [-1, 0], [1, 0], [0, 1]];
var colorDistance = (a, ai, b, bi) => Math.max(Math.abs(a[ai] - b[bi]), Math.abs(a[ai + 1] - b[bi + 1]), Math.abs(a[ai + 2] - b[bi + 2]));
function componentCount(mask, four) {
  const visited = new Uint8Array(9);
  let count = 0;
  for (let p = 0; p < 9; p++) if (mask[p] && !visited[p]) {
    count++;
    const queue = [p];
    visited[p] = 1;
    for (let head = 0; head < queue.length; head++) {
      const x = queue[head] % 3, y = Math.floor(queue[head] / 3);
      for (const [dx, dy] of four ? FOUR : EIGHT) if (x + dx >= 0 && x + dx < 3 && y + dy >= 0 && y + dy < 3) {
        const q = (y + dy) * 3 + x + dx;
        if (mask[q] && !visited[q]) {
          visited[q] = 1;
          queue.push(q);
        }
      }
    }
  }
  return count;
}
function simpleDarkRemoval(dark, p, width) {
  const fg = new Uint8Array(9), bg = new Uint8Array(9), x = p % width, y = Math.floor(p / width);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) {
    const q = (dy + 1) * 3 + dx + 1;
    if (dark[(y + dy) * width + x + dx]) fg[q] = 1;
    else bg[q] = 1;
  }
  return componentCount(fg, false) === 1 && componentCount(bg, true) === 1;
}
function refineContourDetails(image, parameters = {}) {
  const { data, width, height } = image;
  if (!(data instanceof Uint8ClampedArray) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS3 || data.length !== width * height * 4) throw new Error("\u9ED1\u8FB9\u7EC6\u8282\u6574\u7406\u9700\u8981419\u4E07\u50CF\u7D20\u4EE5\u5185\u7684\u6709\u6548\u903B\u8F91RGBA\u56FE");
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters) || parameters.material !== void 0 && parameters.material !== "bamboo-wood") throw new Error("\u9ED1\u8FB9\u7EC6\u8282\u6574\u7406\u76EE\u524D\u4EC5\u652F\u6301\u7AF9\u6728\u6750\u8D28");
  const dark = new Uint8Array(width * height), warm = new Uint8Array(width * height);
  for (let p = 0; p < dark.length; p++) {
    const i = p * 4;
    if (data[i + 3] !== 0 && data[i + 3] !== 255 || !data[i + 3] && (data[i] || data[i + 1] || data[i + 2])) throw new Error("\u9ED1\u8FB9\u7EC6\u8282\u6574\u7406\u9700\u8981\u786C\u900F\u660E\u4E14\u900F\u660ERGB\u6E05\u96F6");
    if (!data[i + 3]) continue;
    dark[p] = Math.max(data[i], data[i + 1], data[i + 2]) <= 48 ? 1 : 0;
    warm[p] = data[i] >= 60 && data[i] >= data[i + 1] + 10 && data[i + 1] >= data[i + 2] + 10 ? 1 : 0;
  }
  const output = new Uint8ClampedArray(data), nearChanged = new Uint8Array(dark.length);
  const diagnostics = {
    algorithm: "frozen-warm-material-inner-outline-v1",
    material: "bamboo-wood",
    alphaPreserved: true,
    dimensionsPreserved: true,
    originalPaletteOnly: true,
    inferredMaterialColor: true,
    frozenInput: true,
    changedPixels: 0,
    recoloredPixels: 0,
    addedPixels: 0,
    removedPixels: 0,
    candidatePixels: 0,
    protectedPixels: 0,
    refusedReasons: {},
    changes: [],
    changesTruncated: 0,
    comparisonUnits: 0,
    comparisonBudget: MAX_COMPARISONS3,
    budgetExhausted: false,
    warnings: ["\u4EC5\u6574\u7406\u7AF9\u6728\u6750\u8D28\u5185\u4FA7\u7684\u5355\u50CF\u7D20\u9ED1\u8272\u7A81\u523A\uFF0C\u4E0D\u79FB\u52A8\u900F\u660E\u8F6E\u5ED3\u3001\u7EC6\u6746\u6216\u9542\u7A7A\u3002", "\u4F9B\u8272\u6765\u81EA\u51BB\u7ED3\u8F93\u5165\u7684\u5C40\u90E8\u7AF9\u6728\u539F\u8272\uFF0C\u4F46\u6750\u8D28\u5F52\u5C5E\u4ECD\u662F\u5C40\u90E8\u63A8\u65AD\uFF1B\u771F\u5B9E\u9ED1\u8272\u88C5\u9970\u548C\u5DF2\u6709\u5916\u8F6E\u5ED3\u6296\u52A8\u987B\u5BF9\u7167\u68C0\u67E5\u3002"]
  };
  const refuse = (reason) => {
    diagnostics.refusedReasons[reason] = (diagnostics.refusedReasons[reason] || 0) + 1;
    diagnostics.protectedPixels++;
  };
  const compare = () => {
    if (diagnostics.comparisonUnits >= MAX_COMPARISONS3) {
      diagnostics.budgetExhausted = true;
      return false;
    }
    diagnostics.comparisonUnits++;
    return true;
  };
  pixels: for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const p = y * width + x;
    if (!dark[p]) continue;
    const ring = EIGHT.map(([dx, dy]) => (y + dy) * width + x + dx), card = FOUR.map(([dx, dy]) => (y + dy) * width + x + dx);
    if (ring.some((q) => !data[q * 4 + 3])) {
      refuse("true-alpha-boundary-or-thin-rod");
      continue;
    }
    const warmCard = card.filter((q) => warm[q]), darkCard = card.filter((q) => dark[q]), darkRing = ring.filter((q) => dark[q]);
    if (warmCard.length !== 3 || darkCard.length !== 1 || darkRing.length < 3 || darkRing.length > 5) {
      refuse("not-an-isolated-inward-tooth");
      continue;
    }
    diagnostics.candidatePixels++;
    if (nearChanged[p]) {
      refuse("near-earlier-edit");
      continue;
    }
    if (!simpleDarkRemoval(dark, p, width)) {
      refuse("drawn-line-or-loop-topology");
      continue;
    }
    let distance = 5;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      if (!compare()) break pixels;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || !data[(ny * width + nx) * 4 + 3]) distance = Math.min(distance, Math.max(Math.abs(dx), Math.abs(dy)));
    }
    if (distance > 4) {
      refuse("interior-drawn-detail");
      continue;
    }
    const donors = new Set(warmCard);
    for (const q of warmCard) {
      const qx = q % width, qy = Math.floor(q / width);
      for (const [dx, dy] of FOUR) {
        const nx = qx + dx, ny = qy + dy;
        if (nx > 0 && ny > 0 && nx < width - 1 && ny < height - 1 && warm[ny * width + nx]) donors.add(ny * width + nx);
      }
    }
    let best;
    for (const q of donors) {
      let support = 0;
      for (const other of donors) {
        if (!compare()) break pixels;
        if (other !== q && colorDistance(data, q * 4, data, other * 4) <= 28) support++;
      }
      if (support < 2) continue;
      const distance2 = Math.abs(q % width - x) + Math.abs(Math.floor(q / width) - y);
      const contrast = colorDistance(data, p * 4, data, q * 4), score = contrast * 0.12 + distance2 * 3 - Math.min(support, 5);
      if (!best || score < best.score || score === best.score && q < best.p) best = { p: q, support, score };
    }
    if (!best) {
      refuse("no-supported-warm-original-color");
      continue;
    }
    if (diagnostics.changedPixels >= MAX_CHANGES2) {
      diagnostics.budgetExhausted = true;
      break pixels;
    }
    output.set(data.subarray(best.p * 4, best.p * 4 + 3), p * 4);
    diagnostics.changedPixels++;
    diagnostics.recoloredPixels++;
    diagnostics.changes.push({ x, y, beforeRGBA: Array.from(data.subarray(p * 4, p * 4 + 4)), afterRGBA: Array.from(output.subarray(p * 4, p * 4 + 4)), reason: "supported-inner-outline-tooth", donor: { x: best.p % width, y: Math.floor(best.p / width) }, warmCardinalSupport: warmCard.length, darkNeighborSupport: darkRing.length, transparencyDistance: distance });
    nearChanged[p] = 1;
    for (const q of ring) nearChanged[q] = 1;
  }
  return { image: { data: output, width, height }, diagnostics };
}

// skills/pixel-asset-pipeline/scripts/runtime/vendor/detail-refinement.ts
var DETAIL_PROFILE_LABELS = {
  foliage: "\u53F6\u7247\u6B8B\u8272",
  bamboo: "\u7AF9\u6728\u63CF\u8FB9",
  glass: "\u73BB\u7483\u7D2B\u8FB9"
};
function normalizeDetailRefinementOptions(parameters) {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters) || typeof parameters.profile !== "string" || !Object.hasOwn(DETAIL_PROFILE_LABELS, parameters.profile)) throw new Error("\u8BF7\u9009\u62E9\u53F6\u7247\u3001\u7AF9\u6728\u6216\u73BB\u7483\u7CBE\u4FEE\u65B9\u5F0F");
  return { profile: parameters.profile };
}
function refineImageDetails(image, parameters) {
  const { profile: profile2 } = normalizeDetailRefinementOptions(parameters);
  const result = profile2 === "bamboo" ? refineContourDetails(image) : refineMaterialColors(image, { profile: profile2 });
  return { image: result.image, diagnostics: { ...result.diagnostics, profile: profile2, materialSelectedByUser: true } };
}

// skills/pixel-asset-pipeline/scripts/runtime/vendor/contour-refinement.ts
var AROUND3 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
var CARDINAL = [[0, -1], [-1, 0], [1, 0], [0, 1]];
var MAX_PIXELS4 = 4194304;
var MAX_COORDINATES = 1e4;
function around(p, w, h, four = false) {
  const x = p % w, y = Math.floor(p / w), result = [];
  for (const [dx, dy] of four ? CARDINAL : AROUND3) if (x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h) result.push((y + dy) * w + x + dx);
  return result;
}
function components(mask, w, h, four = false) {
  const visited = new Uint8Array(mask.length), all = [];
  for (let p = 0; p < mask.length; p++) if (mask[p] && !visited[p]) {
    const queue = [p];
    visited[p] = 1;
    for (let head = 0; head < queue.length; head++) for (const q of around(queue[head], w, h, four)) if (mask[q] && !visited[q]) {
      visited[q] = 1;
      queue.push(q);
    }
    all.push(queue);
  }
  return all;
}
function exterior(mask, w, h) {
  const result = new Uint8Array(mask.length), queue = [];
  const add = (p) => {
    if (!mask[p] && !result[p]) {
      result[p] = 1;
      queue.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    add(x);
    add((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    add(y * w);
    add(y * w + w - 1);
  }
  for (let head = 0; head < queue.length; head++) for (const q of around(queue[head], w, h, true)) add(q);
  return result;
}
function topology(mask, w, h) {
  const ext = exterior(mask, w, h), holes = Uint8Array.from(mask, (v, p) => !v && !ext[p] ? 1 : 0);
  return { fg: components(mask, w, h).length, holes: components(holes, w, h, true).length };
}
function simple(mask, p, w, h) {
  const x = p % w, y = Math.floor(p / w), foreground = new Uint8Array(9), background = new Uint8Array(9);
  if (!x || !y || x + 1 === w || y + 1 === h) return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) {
    const q = (dy + 1) * 3 + dx + 1;
    if (mask[(y + dy) * w + x + dx]) foreground[q] = 1;
    else background[q] = 1;
  }
  return components(foreground, 3, 3).length === 1 && components(background, 3, 3, true).filter((group) => group.some((q) => q === 1 || q === 3 || q === 5 || q === 7)).length === 1;
}
function isLocalDigitalStraightProfile(values) {
  if (!values.length || values.some((value) => !Number.isSafeInteger(value))) return false;
  for (let b = 1; b <= 32; b++) for (let a = -b; a <= b; a++) {
    let low = Infinity, high = -Infinity;
    for (let x = 0; x < values.length; x++) {
      const value = a * x - b * (values[x] - values[0]);
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    if (high - low < b) return true;
  }
  return false;
}
function directions(w, h) {
  return [
    { name: "bottom", nx: 0, ny: 1, tx: 1, ty: 0, size: w, limit: h, point: (t, v) => [t, v] },
    { name: "top", nx: 0, ny: -1, tx: 1, ty: 0, size: w, limit: h, point: (t, v) => [t, h - 1 - v] },
    { name: "right", nx: 1, ny: 0, tx: 0, ty: 1, size: h, limit: w, point: (t, v) => [v, t] },
    { name: "left", nx: -1, ny: 0, tx: 0, ty: 1, size: h, limit: w, point: (t, v) => [w - 1 - v, t] }
  ];
}
function componentProfile(group, w, h, d) {
  const result = Array(d.size).fill(-1);
  for (const p of group) {
    const x = p % w, y = Math.floor(p / w), t = d.tx ? x : y;
    const value = d.nx === 1 ? x : d.nx === -1 ? w - 1 - x : d.ny === 1 ? y : h - 1 - y;
    result[t] = Math.max(result[t], value);
  }
  return result;
}
function filledDonor(p, image, mask, d) {
  const { width: w, height: h, data } = image, x = p % w, y = Math.floor(p / w), candidates = [];
  for (let depth = 1; depth <= 2; depth++) for (let lateral = -1; lateral <= 1; lateral++) {
    const nx = x - depth * d.nx + lateral * d.tx, ny = y - depth * d.ny + lateral * d.ty;
    if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx]) candidates.push(ny * w + nx);
  }
  let best;
  for (const q of candidates) {
    const near = candidates.filter((other) => [0, 1, 2].every((c) => Math.abs(data[q * 4 + c] - data[other * 4 + c]) <= 32));
    if (near.length < 2) continue;
    const distance = Math.abs(q % w - x) + Math.abs(Math.floor(q / w) - y);
    const score = distance * 3 - near.length;
    if (!best || score < best.score || score === best.score && q < best.p) best = { p: q, score };
  }
  return best?.p;
}
function refinePixelContour(input, options = {}) {
  const { width: w, height: h, data } = input;
  if (!(data instanceof Uint8ClampedArray) || !Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1 || w * h > MAX_PIXELS4 || data.length !== w * h * 4) throw new Error("\u8F6E\u5ED3\u6574\u7406\u9700\u8981\u6709\u6548\u7684\u903B\u8F91RGBA\u56FE");
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] !== 0 && data[i + 3] !== 255 || !data[i + 3] && (data[i] || data[i + 1] || data[i + 2])) throw new Error("\u8F6E\u5ED3\u6574\u7406\u9700\u8981\u786C\u900F\u660E\u53CA\u900F\u660ERGB\u5F52\u96F6");
  const variant = options.variant === void 0 ? "A" : options.variant;
  if (variant !== "A" && variant !== "B") throw new Error("\u8F6E\u5ED3\u6574\u7406\u5019\u9009\u987B\u4E3AA\u6216B");
  const mask = Uint8Array.from({ length: w * h }, (_, p) => data[p * 4 + 3] ? 1 : 0), original = mask.slice(), ext = exterior(mask, w, h), before = topology(mask, w, h);
  const edge = Uint8Array.from(mask, (v, p) => v && around(p, w, h).some((q) => ext[q]) ? 1 : 0), holeEdge = Uint8Array.from(mask, (v, p) => v && around(p, w, h).some((q) => !original[q] && !ext[q]) ? 1 : 0);
  const output = new Uint8ClampedArray(data), changedNear = new Uint8Array(mask.length), candidates = [];
  const diagnostics = { algorithm: "anchored-local-dss-reversal-v1", variant, displacementBudget: 1, removedPixels: 0, addedPixels: 0, changedPixels: 0, candidates: 0, changes: [], changesTruncated: 0, refused: {}, topology: { foreground8Before: before.fg, foreground8After: before.fg, holes4Before: before.holes, holes4After: before.holes }, protectedInteriorPixels: original.reduce((sum, v, p) => sum + (v && !edge[p] ? 1 : 0), 0), changedInteriorPixels: 0, warnings: ["\u5B9E\u9A8C\u6027\u5C40\u90E8\u8F6E\u5ED3\u6574\u7406\uFF1A\u53EA\u4FEE\u4F7F\u951A\u5B9A\u77ED\u5F27\u6062\u590D\u6570\u5B57\u76F4\u7EBF\u76841\u50CF\u7D20\u53CD\u5411\uFF0C\u4E0D\u63A8\u65AD\u539F\u753B\u8BED\u4E49\uFF1B\u4FDD\u7559\u5408\u6CD52/3\u4EA4\u66FF\u53F0\u9636\u3002"] };
  const refuse = (reason) => {
    diagnostics.refused[reason] = (diagnostics.refused[reason] ?? 0) + 1;
  };
  for (const group of components(original, w, h).filter((group2) => group2.length >= 16)) for (const d of directions(w, h)) {
    const values = componentProfile(group, w, h, d);
    for (let start = 3; start < values.length - 3; start++) {
      let end = start;
      while (end + 1 < values.length && values[end + 1] === values[start]) end++;
      if (end - start + 1 > (variant === "A" ? 1 : 2) || end + 3 >= values.length || values[start] < 0) {
        start = end;
        continue;
      }
      const left = values[start - 1], right = values[end + 1], v = values[start];
      const remove = v === Math.max(left, right) + 1, fill = variant === "B" && v === Math.min(left, right) - 1;
      if (!remove && !fill || Math.abs(left - right) > 1) {
        start = end;
        continue;
      }
      const arc = values.slice(start - 3, end + 4), proposed = [...arc];
      if (arc.some((v2) => v2 < 0) || isLocalDigitalStraightProfile(arc)) {
        start = end;
        continue;
      }
      for (let i = 3; i < 3 + end - start + 1; i++) proposed[i] += remove ? -1 : 1;
      if (!isLocalDigitalStraightProfile(proposed)) {
        refuse("uncertain-arc-or-real-turn");
        start = end;
        continue;
      }
      const points = [];
      for (let t = start; t <= end; t++) {
        const [x, y] = d.point(t, v + (remove ? 0 : 1));
        points.push(y * w + x);
      }
      candidates.push({ points, action: remove ? "remove-tooth" : "fill-notch", direction: d });
      start = end;
    }
  }
  diagnostics.candidates = candidates.length;
  for (const candidate of candidates) {
    const { points, action, direction: d } = candidate, remove = action === "remove-tooth";
    if (points.some((p) => changedNear[p])) {
      refuse("near-earlier-edit");
      continue;
    }
    const edits = [];
    let reason;
    for (const p of points) {
      const x = p % w, y = Math.floor(p / w);
      if (holeEdge[p] || remove && !edge[p] || !remove && !ext[p]) {
        reason = "interior-or-hole";
        break;
      }
      if ((remove ? 1 : 0) !== mask[p]) {
        reason = "changed-source";
        break;
      }
      const solidRow = [-1, 0, 1].every((lateral) => {
        const nx = x - 2 * d.nx + lateral * d.tx, ny = y - 2 * d.ny + lateral * d.ty;
        return nx >= 0 && ny >= 0 && nx < w && ny < h && original[ny * w + nx];
      });
      if (!solidRow || !around(p, w, h).some((q) => original[q] && around(q, w, h).filter((n) => original[n]).length >= 5)) {
        reason = "tip-whisker-or-thin-line";
        break;
      }
      if (!simple(mask, p, w, h)) {
        reason = "non-simple-topology";
        break;
      }
      const donor = remove ? void 0 : filledDonor(p, input, original, d);
      if (!remove && donor === void 0) {
        reason = "no-supported-original-color";
        break;
      }
      mask[p] = remove ? 0 : 1;
      edits.push({ p, donor });
    }
    if (reason) {
      for (const { p } of edits) mask[p] = original[p];
      refuse(reason);
      continue;
    }
    for (const { p, donor } of edits) {
      if (remove) {
        output.fill(0, p * 4, p * 4 + 4);
        diagnostics.removedPixels++;
      } else {
        output.set(data.subarray(donor * 4, donor * 4 + 4), p * 4);
        diagnostics.addedPixels++;
      }
      diagnostics.changedPixels++;
      changedNear[p] = 1;
      for (const q of around(p, w, h)) changedNear[q] = 1;
      if (diagnostics.changes.length < MAX_COORDINATES) diagnostics.changes.push({ x: p % w, y: Math.floor(p / w), before: Array.from(data.subarray(p * 4, p * 4 + 4)), after: Array.from(output.subarray(p * 4, p * 4 + 4)), action, direction: d.name, ...donor === void 0 ? {} : { donor: { x: donor % w, y: Math.floor(donor / w) } } });
      else diagnostics.changesTruncated++;
    }
  }
  const after = topology(mask, w, h);
  diagnostics.topology.foreground8After = after.fg;
  diagnostics.topology.holes4After = after.holes;
  for (let p = 0; p < mask.length; p++) if (original[p] && !edge[p] && [0, 1, 2, 3].some((c) => data[p * 4 + c] !== output[p * 4 + c])) diagnostics.changedInteriorPixels++;
  if (after.fg !== before.fg || after.holes !== before.holes || diagnostics.changedInteriorPixels) throw new Error("\u8F6E\u5ED3\u6574\u7406\u62D3\u6251\u6216\u5185\u90E8\u4FDD\u5168\u6821\u9A8C\u5931\u8D25");
  return { image: { data: output, width: w, height: h }, diagnostics };
}

// skills/pixel-asset-pipeline/scripts/runtime/vendor/outer-contour-refinement.ts
var MAX_PIXELS5 = 1048576;
var MAX_PROFILE_COMPARISONS = 8e6;
var FOUR2 = [[0, -1], [-1, 0], [1, 0], [0, 1]];
var EIGHT2 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
var DIRECTIONS = [[1, 0, 0, 1], [-1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0]];
function neighbors3(p, w, h, four = false) {
  const x = p % w, y = Math.floor(p / w), result = [];
  for (const [dx, dy] of four ? FOUR2 : EIGHT2) if (x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h) result.push((y + dy) * w + x + dx);
  return result;
}
function components2(mask, w, h, four = false) {
  const seen = new Uint8Array(mask.length);
  let count = 0;
  for (let p = 0; p < mask.length; p++) if (mask[p] && !seen[p]) {
    count++;
    const queue = [p];
    seen[p] = 1;
    for (let head = 0; head < queue.length; head++) for (const q of neighbors3(queue[head], w, h, four)) if (mask[q] && !seen[q]) {
      seen[q] = 1;
      queue.push(q);
    }
  }
  return count;
}
function exterior2(mask, w, h) {
  const result = new Uint8Array(mask.length), queue = [];
  const add = (p) => {
    if (!mask[p] && !result[p]) {
      result[p] = 1;
      queue.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    add(x);
    add((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    add(y * w);
    add(y * w + w - 1);
  }
  for (let head = 0; head < queue.length; head++) for (const q of neighbors3(queue[head], w, h, true)) add(q);
  return result;
}
function topology2(mask, w, h) {
  const ext = exterior2(mask, w, h);
  return { fg: components2(mask, w, h), holes: components2(Uint8Array.from(mask, (v, p) => !v && !ext[p] ? 1 : 0), w, h, true) };
}
function bounds(mask, w) {
  let left = w, top = mask.length / w, right = -1, bottom = -1;
  for (let p = 0; p < mask.length; p++) if (mask[p]) {
    left = Math.min(left, p % w);
    top = Math.min(top, Math.floor(p / w));
    right = Math.max(right, p % w);
    bottom = Math.max(bottom, Math.floor(p / w));
  }
  return [left, top, right, bottom];
}
function simple2(mask, p, w, h) {
  const x = p % w, y = Math.floor(p / w), fg = new Uint8Array(9), bg = new Uint8Array(9);
  if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) {
    const q = (dy + 1) * 3 + dx + 1;
    if (mask[(y + dy) * w + x + dx]) fg[q] = 1;
    else bg[q] = 1;
  }
  return components2(fg, 3, 3) === 1 && components2(bg, 3, 3, true) === 1;
}
var median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
function normalizeOuterContourOptions(parameters = {}) {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters) || parameters.profile !== void 0 && parameters.profile !== "bamboo") throw new Error("\u5916\u8F6E\u5ED3\u6574\u7406\u76EE\u524D\u53EA\u652F\u6301\u7AF9\u6728\u7EC6\u6746\u7269\u54C1");
  return { profile: "bamboo" };
}
var TRACE_WINDOW = 32;
var MIN_TRACE = 20;
function fitProfile(values) {
  const slopes = [];
  for (let a = 0; a < values.length; a++) for (let b = a + Math.min(8, Math.floor(values.length / 3)); b < values.length; b++) slopes.push((values[b] - values[a]) / (b - a));
  const slope = median(slopes), intercept = median(values.map((value, i) => value - slope * i));
  return { slope, intercept, errors: values.map((value, i) => value - intercept - slope * i) };
}
function regularPath(points, slope, intercept) {
  const sign = slope < 0 ? -1 : 1;
  const states = [/* @__PURE__ */ new Map([[points[0].s, { score: 0, previous: null }]])];
  for (let i = 1; i < points.length; i++) {
    const row = /* @__PURE__ */ new Map(), point = points[i];
    for (let shift = -1; shift <= 1; shift++) {
      if (shift && (!point.wood || point.depth < 1 || point.depth > 5 || i === points.length - 1)) continue;
      const value2 = point.s + shift, cost = (value2 - intercept - slope * i) ** 2 + Math.abs(shift) * 0.05;
      for (const [previous, state] of states[i - 1]) {
        const step = sign * (value2 - previous);
        if (step < 0 || step > 1) continue;
        const score = state.score + cost;
        if (!row.has(value2) || score < row.get(value2).score) row.set(value2, { score, previous });
      }
    }
    if (!row.size) return;
    states.push(row);
  }
  let value = [...states.at(-1)].sort((a, b) => a[1].score - b[1].score)[0][0];
  const result = [];
  for (let i = states.length - 1; i >= 0; i--) {
    result[i] = value;
    value = states[i].get(value).previous;
  }
  return result;
}
function refineOuterContour(image, parameters = {}) {
  normalizeOuterContourOptions(parameters);
  if (!image || !(image.data instanceof Uint8ClampedArray) || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > MAX_PIXELS5 || image.data.length !== image.width * image.height * 4) throw new Error("\u5916\u8F6E\u5ED3\u6574\u7406\u9700\u8981104\u4E07\u903B\u8F91\u50CF\u7D20\u4EE5\u5185\u7684\u6709\u6548RGBA\u56FE");
  const { data, width: w, height: h } = image, original = new Uint8Array(w * h);
  let visible = 0;
  for (let p = 0; p < original.length; p++) {
    const i = p * 4;
    if (data[i + 3] !== 0 && data[i + 3] !== 255 || !data[i + 3] && (data[i] || data[i + 1] || data[i + 2])) throw new Error("\u5916\u8F6E\u5ED3\u6574\u7406\u9700\u8981\u786C\u900F\u660E\u53CA\u900F\u660ERGB\u6E05\u96F6");
    if (data[i + 3]) {
      original[p] = 1;
      visible++;
    }
  }
  const mask = original.slice(), ext = exterior2(original, w, h), holeBand = new Uint8Array(original.length), output = new Uint8ClampedArray(data), before = topology2(original, w, h), bbox = bounds(original, w);
  const diagnostics = { algorithm: "bounded-bamboo-joint-rhythm-v2", profile: "bamboo", shapeInferred: true, sourceRecoveryClaimed: false, displacementBudget: 1, originalPaletteOnly: true, framePreserved: true, bboxPreserved: true, holePixelsPreserved: true, changedPixels: 0, addedPixels: 0, removedPixels: 0, recoloredPixels: 0, candidateGroups: 0, acceptedGroups: 0, rejectedChecks: 0, topology: { foreground8Before: before.fg, foreground8After: before.fg, holes4Before: before.holes, holes4After: before.holes }, changes: [], refusedReasons: {}, estimatedProfileComparisons: 0, comparisonBudget: MAX_PROFILE_COMPARISONS, budgetExhausted: false, alphaChangeBudget: Math.min(128, Math.floor(visible * 0.01)), warnings: ["\u6CBF\u7AF9\u6728\u7269\u54C1\u53D7\u652F\u6491\u7684\u5C40\u90E8\u76F4\u7EBF\u6BB5\u63A8\u65AD\u53F0\u9636\uFF0C\u5916\u7F18\u6700\u591A\u79FB\u52A81\u4E2A\u903B\u8F91\u50CF\u7D20\uFF1B\u4E0D\u4EE3\u8868\u6062\u590D\u4E86\u539F\u753B\u771F\u5B9E\u8F6E\u5ED3\u3002", "\u58A8\u5E26\u539A\u5EA6\u4F9D\u5C40\u90E8\u591A\u6570\u6574\u7406\uFF0C\u771F\u5B9E\u7AF9\u8282\u3001\u66F2\u7EBF\u3001\u63A5\u5934\u4ECD\u9700\u4EBA\u5DE5\u5BF9\u7167\uFF1B\u91CD\u590D\u8F93\u5165\u4E0A\u6B21\u7ED3\u679C\u53EF\u80FD\u7EE7\u7EED\u5C0F\u5E45\u53D8\u5316\uFF0C\u5EFA\u8BAE\u4ECE\u56FA\u5B9A\u4E0A\u6E38\u91CD\u8DD1\u5BF9\u7167\u3002"] };
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const has = (x, y) => inside(x, y) && !!original[y * w + x];
  const luminance = (p) => 0.2126 * data[p * 4] + 0.7152 * data[p * 4 + 1] + 0.0722 * data[p * 4 + 2];
  const dark = (p) => luminance(p) < 64;
  const warm = (p) => data[p * 4 + 3] === 255 && data[p * 4] >= 60 && data[p * 4] >= data[p * 4 + 1] + 10 && data[p * 4 + 1] >= data[p * 4 + 2] + 10;
  const refuse = (reason) => {
    diagnostics.refusedReasons[reason] = (diagnostics.refusedReasons[reason] || 0) + 1;
    diagnostics.rejectedChecks++;
  };
  const compare = () => {
    if (diagnostics.estimatedProfileComparisons >= MAX_PROFILE_COMPARISONS) {
      diagnostics.budgetExhausted = true;
      return false;
    }
    diagnostics.estimatedProfileComparisons++;
    return true;
  };
  for (let p = 0; p < original.length; p++) if (!original[p] && !ext[p]) {
    const x = p % w, y = Math.floor(p / w);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inside(x + dx, y + dy)) holeBand[(y + dy) * w + x + dx] = 1;
  }
  const edges = [], bands = [], bandVotes = [], traces = [];
  directionScan: for (let direction2 = 0; direction2 < DIRECTIONS.length; direction2++) {
    const [nx, ny, tx, ty] = DIRECTIONS[direction2], step = ny * w + nx, count = ty ? h : w, span = ny ? h : w;
    const rows = [], rowIndexes = [];
    for (let t = 0; t < count; t++) {
      const row = [];
      for (let s = 1; s < span - 1; s++) {
        if (!compare()) break directionScan;
        const x = t * tx + s * nx + (nx < 0 ? w - 1 : 0), y = t * ty + s * ny + (ny < 0 ? h - 1 : 0), p = y * w + x;
        if (!has(x, y) || !inside(x + nx, y + ny) || !ext[p + step]) continue;
        let depth = 0, inkDepth = 0;
        while (inkDepth < 7 && has(x - inkDepth * nx, y - inkDepth * ny) && luminance(p - inkDepth * step) < 32) inkDepth++;
        while (depth < 7 && has(x - depth * nx, y - depth * ny) && dark(p - depth * step)) depth++;
        if (![1, 2, 3, 4, 5, 6].every((k) => has(x - k * nx, y - k * ny))) continue;
        let narrow = false;
        for (let normalDepth = 7; normalDepth <= 36; normalDepth++) {
          if (!compare()) break directionScan;
          if (!has(x - normalDepth * nx, y - normalDepth * ny)) {
            narrow = true;
            break;
          }
        }
        row.push({ p, s, depth, inkDepth, wood: depth < 6 && warm(p - depth * step) && warm(p - (depth + 1) * step), narrow, direction: direction2 });
      }
      rows.push(row);
      rowIndexes.push(new Map(row.map((point) => [point.s, point])));
    }
    const visited = /* @__PURE__ */ new Set();
    for (let t = 0; t < count; t++) for (const start of rows[t]) {
      if (visited.has(start.p)) continue;
      const trace = [start];
      visited.add(start.p);
      for (let nextRow = t + 1; nextRow < count; nextRow++) {
        const previous = trace.at(-1), matches = [];
        for (let offset = -3; offset <= 3; offset++) {
          if (!compare()) break directionScan;
          const point = rowIndexes[nextRow].get(previous.s + offset);
          if (point) matches.push(point);
        }
        if (matches.length !== 1 || visited.has(matches[0].p)) break;
        trace.push(matches[0]);
        visited.add(matches[0].p);
      }
      if (trace.length < MIN_TRACE) continue;
      traces.push(trace);
      for (let from = 0; from <= trace.length - MIN_TRACE; from += TRACE_WINDOW / 2) {
        if (!compare()) break directionScan;
        const points = trace.slice(from, from + TRACE_WINDOW), values = points.map((point) => point.s), work = values.length * values.length * 2 + values.length * (9 + 1088);
        if (diagnostics.estimatedProfileComparisons + work > MAX_PROFILE_COMPARISONS) {
          diagnostics.budgetExhausted = true;
          break directionScan;
        }
        diagnostics.estimatedProfileComparisons += work;
        const fitted = fitProfile(values), middle = Math.floor(values.length / 2);
        const firstSlope = fitProfile(values.slice(0, middle + 1)).slope, lastSlope = fitProfile(values.slice(middle)).slope;
        if (Math.abs(fitted.slope) > 0.65 || Math.abs(firstSlope - lastSlope) > 0.13 || firstSlope * lastSlope < 0 && Math.max(Math.abs(firstSlope), Math.abs(lastSlope)) > 0.03 || Math.max(...fitted.errors.map(Math.abs)) > 2 || fitted.errors.reduce((sum, error) => sum + Math.abs(error), 0) / values.length > 0.85 || points.filter((point) => point.wood).length < points.length * 0.9) {
          refuse("curved-turn-or-insufficient-wood-support");
          continue;
        }
        const targets = isLocalDigitalStraightProfile(values) ? values : regularPath(points, fitted.slope, fitted.intercept);
        if (!targets) {
          refuse("no-bounded-monotone-path");
          continue;
        }
        const depths = points.map((point) => point.inkDepth), commonDepth = median([...depths]), supportedWidth = depths.filter((depth) => depth === commonDepth).length >= depths.length * 0.5;
        for (let i = 0; i < points.length; i++) {
          const point = points[i], delta = targets[i] - point.s;
          edges.push({ ...point, delta, score: Math.abs(fitted.errors[i]), votes: 1, deltaSum: delta });
          const widthDelta = i > 0 && i < points.length - 1 && supportedWidth && point.wood && point.narrow && point.inkDepth >= 1 && point.inkDepth <= 5 && commonDepth >= 1 && commonDepth <= 4 ? Math.sign(commonDepth - point.inkDepth) : 0;
          bandVotes.push({ point, delta: widthDelta, votes: 1, sum: widthDelta });
        }
      }
    }
  }
  const votes = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    const key = `${edge.p}:${edge.direction}`, prior = votes.get(key);
    if (prior) {
      prior.votes++;
      prior.deltaSum += edge.delta;
      prior.score = Math.max(prior.score, edge.score);
    } else votes.set(key, { ...edge });
  }
  const candidates = [...votes.values()].filter((edge) => edge.delta !== 0 && Math.abs(edge.deltaSum) === edge.votes).sort((a, b) => b.votes - a.votes || b.score - a.score);
  const widthVotes = /* @__PURE__ */ new Map();
  for (const vote of bandVotes) {
    const key = `${vote.point.p}:${vote.point.direction}`, prior = widthVotes.get(key);
    if (prior) {
      prior.votes++;
      prior.sum += vote.delta;
    } else widthVotes.set(key, { ...vote });
  }
  for (const vote of widthVotes.values()) if (vote.delta !== 0 && Math.abs(vote.sum) === vote.votes) {
    const { point } = vote, [nx, ny] = DIRECTIONS[point.direction], step = ny * w + nx, thinning = vote.delta < 0;
    bands.push({ p: point.p - (thinning ? point.inkDepth - 1 : point.inkDepth) * step, donor: thinning ? point.p - point.inkDepth * step : point.p, score: vote.votes });
  }
  const active = new Map(candidates.map((candidate) => [`${candidate.p}:${candidate.direction}`, candidate]));
  seamScan: for (let pass = 0; pass < TRACE_WINDOW; pass++) {
    let removed = false;
    for (const trace of traces) {
      const trend = Math.sign(trace.at(-1).s - trace[0].s);
      for (let i = 1; i < trace.length; i++) {
        if (!compare()) {
          active.clear();
          break seamScan;
        }
        const a = trace[i - 1], b = trace[i], ka = `${a.p}:${a.direction}`, kb = `${b.p}:${b.direction}`, da = active.get(ka)?.delta || 0, db = active.get(kb)?.delta || 0;
        if (!da && !db) continue;
        const oldStep = b.s - a.s, newStep = oldStep + db - da, reverse = (step) => trend ? Math.max(0, -trend * step) : Math.abs(step);
        if (reverse(newStep) > reverse(oldStep) || Math.abs(newStep) > Math.max(1, Math.abs(oldStep))) {
          if (active.delete(ka)) removed = true;
          if (active.delete(kb)) removed = true;
        }
      }
    }
    if (!removed) break;
  }
  diagnostics.candidateGroups = active.size + bands.length;
  const changed = /* @__PURE__ */ new Set(), changeInfo = /* @__PURE__ */ new Map();
  const set = (p, donor, action, group) => {
    output.set(donor === void 0 ? [0, 0, 0, 0] : data.subarray(donor * 4, donor * 4 + 4), p * 4);
    changed.add(p);
    changeInfo.set(p, { action, group, donor });
  };
  for (const candidate of active.values()) {
    if (diagnostics.acceptedGroups >= diagnostics.alphaChangeBudget) {
      diagnostics.budgetExhausted = true;
      break;
    }
    const [nx, ny] = DIRECTIONS[candidate.direction], step = ny * w + nx, remove = candidate.delta < 0, target = remove ? candidate.p : candidate.p + step;
    const recolor = remove ? candidate.p - candidate.depth * step : candidate.p - (candidate.depth - 1) * step, donor = remove ? candidate.p : candidate.p - candidate.depth * step;
    const x = target % w, y = Math.floor(target / w);
    if (x <= bbox[0] || x >= bbox[2] || y <= bbox[1] || y >= bbox[3] || holeBand[recolor] || changed.has(target) || changed.has(recolor) || mask[target] !== +remove || !simple2(mask, target, w, h)) {
      refuse("anchor-topology-or-overlapping-edit");
      continue;
    }
    const group = diagnostics.acceptedGroups++;
    mask[target] = remove ? 0 : 1;
    set(target, remove ? void 0 : candidate.p, remove ? "remove-outer-step" : "fill-outer-step", group);
    set(recolor, donor, "shift-original-outline-band", group);
  }
  const rollback = (groups) => {
    for (const [p, info] of changeInfo) if (groups.has(info.group)) {
      output.set(data.subarray(p * 4, p * 4 + 4), p * 4);
      mask[p] = original[p];
      changed.delete(p);
      changeInfo.delete(p);
    }
  };
  actualSeamScan: for (let pass = 0; pass < TRACE_WINDOW; pass++) {
    const groups = /* @__PURE__ */ new Set();
    for (const trace of traces) {
      const trend = Math.sign(trace.at(-1).s - trace[0].s);
      const delta = (point) => {
        const [nx, ny] = DIRECTIONS[point.direction], step = ny * w + nx;
        return !mask[point.p] ? -1 : !original[point.p + step] && mask[point.p + step] ? 1 : 0;
      };
      for (let i = 1; i < trace.length; i++) {
        if (!compare()) {
          rollback(new Set([...changeInfo.values()].map((info) => info.group)));
          break actualSeamScan;
        }
        const a = trace[i - 1], b = trace[i], da = delta(a), db = delta(b);
        const oldStep = b.s - a.s, newStep = oldStep + db - da, reverse = (step) => trend ? Math.max(0, -trend * step) : Math.abs(step);
        if (reverse(newStep) <= reverse(oldStep) && Math.abs(newStep) <= Math.max(1, Math.abs(oldStep))) continue;
        for (const point of [a, b]) {
          const [nx, ny] = DIRECTIONS[point.direction], step = ny * w + nx;
          for (const p of [point.p, point.p + step]) {
            const info = changeInfo.get(p);
            if (info) groups.add(info.group);
          }
        }
      }
    }
    if (!groups.size) break;
    rollback(groups);
    refuse("actual-window-seam-rollback");
    if (pass === TRACE_WINDOW - 1) {
      rollback(new Set([...changeInfo.values()].map((info) => info.group)));
      refuse("actual-seam-convergence-fallback");
    }
  }
  const colorBudget = Math.min(512, Math.floor(visible * 0.02));
  let colorChanges = 0;
  for (const band of bands.sort((a, b) => b.score - a.score)) {
    if (holeBand[band.p] || changed.has(band.p) || !mask[band.p]) continue;
    if (colorChanges >= colorBudget) {
      diagnostics.budgetExhausted = true;
      break;
    }
    set(band.p, band.donor, "regularize-original-outline-width", diagnostics.acceptedGroups++);
    colorChanges++;
  }
  const after = topology2(mask, w, h), afterBounds = bounds(mask, w), afterExterior = exterior2(mask, w, h);
  if (after.fg !== before.fg || after.holes !== before.holes || bbox.some((value, i) => value !== afterBounds[i]) || original.some((value, p) => (!value && !ext[p]) !== (!mask[p] && !afterExterior[p]))) throw new Error("\u5916\u8F6E\u5ED3\u6574\u7406\u7684\u62D3\u6251\u3001\u5B54\u6D1E\u6216\u951A\u70B9\u4FDD\u5168\u6821\u9A8C\u5931\u8D25");
  diagnostics.topology.foreground8After = after.fg;
  diagnostics.topology.holes4After = after.holes;
  for (let p = 0; p < mask.length; p++) if ([0, 1, 2, 3].some((channel) => data[p * 4 + channel] !== output[p * 4 + channel])) {
    diagnostics.changedPixels++;
    if (!original[p]) diagnostics.addedPixels++;
    else if (!mask[p]) diagnostics.removedPixels++;
    else diagnostics.recoloredPixels++;
    const info = changeInfo.get(p);
    diagnostics.changes.push({ x: p % w, y: Math.floor(p / w), beforeRGBA: Array.from(data.subarray(p * 4, p * 4 + 4)), afterRGBA: Array.from(output.subarray(p * 4, p * 4 + 4)), action: info.action, group: info.group, ...info.donor === void 0 ? {} : { donor: { x: info.donor % w, y: Math.floor(info.donor / w), rgba: Array.from(data.subarray(info.donor * 4, info.donor * 4 + 4)) } } });
  }
  diagnostics.acceptedGroups = new Set(diagnostics.changes.map((change) => change.group)).size;
  if (diagnostics.budgetExhausted) diagnostics.warnings.push("\u8FBE\u5230\u672C\u6B21\u8BA1\u7B97\u6216\u6539\u52A8\u4E0A\u9650\uFF0C\u5269\u4F59\u8F6E\u5ED3\u4FDD\u7559\u539F\u6837\u3002");
  return { image: { data: output, width: w, height: h }, diagnostics };
}

// skills/pixel-asset-pipeline/scripts/runtime/vendor/image-types.ts
var StudioError = class extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.name = "StudioError";
  }
};

// skills/pixel-asset-pipeline/scripts/runtime/vendor/pixel-layout.ts
var PIXEL_FITS = ["proportional", "contain", "cover", "stretch"];
var PIXEL_ANCHORS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];
function resolvePixelFit(parameters) {
  if (parameters.fit === void 0) return parameters.keepAspect === false ? "stretch" : "proportional";
  if (typeof parameters.fit !== "string" || !PIXEL_FITS.includes(parameters.fit)) throw new StudioError("\u753B\u5E03\u9002\u914D\u987B\u4E3Aproportional\u3001contain\u3001cover\u6216stretch");
  return parameters.fit;
}
function resolvePixelAnchor(parameters) {
  if (parameters.anchor === void 0) return "center";
  if (typeof parameters.anchor !== "string" || !PIXEL_ANCHORS.includes(parameters.anchor)) throw new StudioError("\u753B\u5E03\u951A\u70B9\u65E0\u6548\uFF0C\u8BF7\u9009\u62E9\u4E5D\u4E2A\u6807\u51C6\u4F4D\u7F6E\u4E4B\u4E00");
  return parameters.anchor;
}
function integer(value, fallback, minimum, maximum, label) {
  if (value === void 0 || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new StudioError(`${label}\u987B\u4E3A ${minimum}\u2013${maximum} \u4E4B\u95F4\u7684\u6574\u6570`);
  return parsed;
}
function alignment(anchor) {
  return [anchor.includes("left") ? 0 : anchor.includes("right") ? 1 : 0.5, anchor.startsWith("top") ? 0 : anchor.startsWith("bottom") ? 1 : 0.5];
}
function planPixelLayout(sourceWidth, sourceHeight, parameters) {
  if (!Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight) || sourceWidth < 1 || sourceHeight < 1 || !Number.isSafeInteger(sourceWidth * sourceHeight)) throw new StudioError("\u539F\u56FE\u5C3A\u5BF8\u987B\u4E3A\u6709\u6548\u7684\u6B63\u6574\u6570");
  const fit = resolvePixelFit(parameters), requestedAnchor = resolvePixelAnchor(parameters);
  const anchor = fit === "contain" || fit === "cover" ? requestedAnchor : "center";
  const width = integer(parameters.cols, Math.min(256, sourceWidth), 1, 4096, "\u903B\u8F91\u5BBD\u5EA6");
  if ((fit === "proportional" || fit === "stretch") && width > sourceWidth) throw new StudioError("\u903B\u8F91\u5BBD\u5EA6\u4E0D\u80FD\u8D85\u8FC7\u539F\u56FE\uFF1B\u5982\u9700\u7559\u8FB9\u8BF7\u4F7F\u7528contain");
  const proportionalHeight = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
  const legacyStretch = parameters.fit === void 0 && parameters.keepAspect === false;
  const rowDefault = fit === "proportional" || legacyStretch ? proportionalHeight : width;
  const rowMaximum = fit === "proportional" || fit === "stretch" ? Math.min(4096, sourceHeight) : 4096;
  const height = integer(parameters.rows, rowDefault, 1, rowMaximum, "\u903B\u8F91\u9AD8\u5EA6");
  if (fit === "proportional" && height !== proportionalHeight) throw new StudioError(`\u4FDD\u6301\u6BD4\u4F8B\u65F6\u903B\u8F91\u9AD8\u5EA6\u5E94\u4E3A ${proportionalHeight}\uFF0C\u8BF7\u8C03\u6574\u5BBD\u5EA6\u6216\u5173\u95ED\u4FDD\u6301\u6BD4\u4F8B`);
  if (height > rowMaximum) throw new StudioError("\u903B\u8F91\u9AD8\u5EA6\u8D85\u51FA\u539F\u56FE\u62164096\u50CF\u7D20\u4E0A\u9650\uFF0C\u8BF7\u51CF\u5C0F\u903B\u8F91\u5BBD\u5EA6\u6216\u4F7F\u7528contain\u7559\u8FB9");
  if (width * height > 4194304) throw new StudioError("\u76EE\u6807\u903B\u8F91\u753B\u5E03\u8D85\u8FC7419\u4E07\u50CF\u7D20\uFF0C\u8BF7\u51CF\u5C11\u5BBD\u9AD8");
  const scale = integer(parameters.scale, 1, 1, 8, "\u6574\u6570\u653E\u5927\u500D\u6570");
  if (![1, 2, 4, 8].includes(scale)) throw new StudioError("\u4E25\u683C\u50CF\u7D20\u6A21\u5F0F\u4EC5\u652F\u63011\u30012\u30014\u30018\u500D\u6700\u8FD1\u90BB\u653E\u5927");
  if (width * height * scale * scale > 32e6) throw new StudioError("\u6574\u6570\u500D\u5BFC\u51FA\u540E\u8D85\u8FC73200\u4E07\u50CF\u7D20\uFF0C\u8BF7\u964D\u4F4E\u653E\u5927\u500D\u6570");
  const canvas = { width, height }, source = { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  const content = { x: 0, y: 0, width, height }, [horizontal, vertical] = alignment(anchor);
  if (fit === "contain") {
    const ratio = Math.min(width / sourceWidth, height / sourceHeight, 1);
    content.width = Math.max(1, Math.min(width, sourceWidth, Math.round(sourceWidth * ratio)));
    content.height = Math.max(1, Math.min(height, sourceHeight, Math.round(sourceHeight * ratio)));
    content.x = Math.floor((width - content.width) * horizontal);
    content.y = Math.floor((height - content.height) * vertical);
  } else if (fit === "cover") {
    if (sourceWidth * height > sourceHeight * width) source.width = Math.max(1, Math.min(sourceWidth, Math.round(sourceHeight * width / height)));
    else source.height = Math.max(1, Math.min(sourceHeight, Math.round(sourceWidth * height / width)));
    if (source.width < width || source.height < height) throw new StudioError("\u8986\u76D6\u586B\u5145\u9700\u8981\u653E\u5927\u539F\u56FE\uFF1B\u8BF7\u51CF\u5C0F\u753B\u5E03\u6216\u4F7F\u7528contain\u7559\u8FB9");
    source.x = Math.floor((sourceWidth - source.width) * horizontal);
    source.y = Math.floor((sourceHeight - source.height) * vertical);
  }
  return { fit, anchor, canvas, content, source, croppedPixels: sourceWidth * sourceHeight - source.width * source.height };
}

// skills/pixel-asset-pipeline/scripts/runtime/vendor/border-key-shades.ts
var MAX_PIXELS6 = 16777216;
var COSINE = 0.985;
var MIN_RANGE = 48;
var MIN_MAXIMUM = 64;
function removeBorderKeyShades(image, keyColor) {
  if (!image || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > MAX_PIXELS6 || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) throw new StudioError("\u8FB9\u754C\u8272\u952E\u53D8\u5316\u6E05\u7406\u9700\u89811677\u4E07\u50CF\u7D20\u4EE5\u5185\u7684\u6709\u6548RGBA\u56FE\u50CF");
  if (typeof keyColor !== "string" || !/^#[a-f\d]{6}$/i.test(keyColor)) throw new StudioError("\u8FB9\u754C\u8272\u952E\u53D8\u5316\u6E05\u7406\u9700\u8981\u516D\u4F4D\u5341\u516D\u8FDB\u5236\u80CC\u666F\u8272");
  const key = [1, 3, 5].map((offset) => parseInt(keyColor.slice(offset, offset + 2), 16));
  if (Math.max(...key) - Math.min(...key) < MIN_RANGE) throw new StudioError("\u8FB9\u754C\u8272\u952E\u53D8\u5316\u6E05\u7406\u53EA\u652F\u6301\u901A\u9053\u5DEE\u81F3\u5C1148\u7684\u5F3A\u5F69\u8272\u80CC\u666F\uFF1B\u767D\u8272\u3001\u7070\u8272\u6216\u4F4E\u5F69\u5EA6\u80CC\u666F\u8BF7\u4F7F\u7528\u5176\u4ED6\u65B9\u5F0F");
  const mean = (key[0] + key[1] + key[2]) / 3, centered = key.map((c) => c - mean);
  const keyNorm = Math.hypot(...centered);
  const { width: w, height: h, data } = image, size = w * h;
  const state = new Uint8Array(size), queue = new Int32Array(size), output = data.slice();
  let tail = 0, examinedCount = 0, removedCount = 0;
  function enqueue(p) {
    if (state[p]) return;
    examinedCount++;
    const i = p * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    state[p] = 1;
    if (!data[i + 3]) {
      if (!r && !g && !b) {
        state[p] = 2;
        queue[tail++] = p;
      }
      return;
    }
    const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b);
    if (maximum < MIN_MAXIMUM || maximum - minimum < MIN_RANGE) return;
    const average = (r + g + b) / 3, red = r - average, green = g - average, blue = b - average;
    const cosine = (red * centered[0] + green * centered[1] + blue * centered[2]) / (Math.hypot(red, green, blue) * keyNorm);
    if (cosine >= COSINE) {
      state[p] = 3;
      queue[tail++] = p;
    }
  }
  for (let x = 0; x < w; x++) {
    enqueue(x);
    if (h > 1) enqueue((h - 1) * w + x);
  }
  for (let y = 1; y + 1 < h; y++) {
    enqueue(y * w);
    if (w > 1) enqueue(y * w + w - 1);
  }
  for (let head = 0; head < tail; head++) {
    const p = queue[head], x = p % w, y = Math.floor(p / w);
    if (state[p] === 3) {
      output.fill(0, p * 4, p * 4 + 4);
      removedCount++;
    }
    if (x) enqueue(p - 1);
    if (x + 1 < w) enqueue(p + 1);
    if (y) enqueue(p - w);
    if (y + 1 < h) enqueue(p + w);
  }
  return {
    image: { width: w, height: h, data: output },
    diagnostics: {
      algorithm: "border-connected-key-shades-v1",
      keyColor: keyColor.toUpperCase(),
      connectivity: 4,
      cosineThreshold: COSINE,
      minimumChannelRange: MIN_RANGE,
      minimumMaximumChannel: MIN_MAXIMUM,
      removedCount,
      visited: tail,
      examinedCount,
      warnings: [
        "\u4EC5\u5220\u9664\u4E0E\u753B\u5E03\u56DB\u8FB9\u7ECF\u56DB\u90BB\u57DF\u8FDE\u901A\u3001\u8272\u5EA6\u65B9\u5411\u63A5\u8FD1\u6307\u5B9A\u5F3A\u5F69\u8272\u8272\u952E\u7684\u50CF\u7D20\uFF1B\u4E0D\u505A\u6A21\u7CCA\u6216\u5168\u56FE\u6362\u8272\u3002",
        "\u771F\u5B9E\u7C89\u8272\u7B49\u540C\u8272\u524D\u666F\u82E5\u4E0E\u80CC\u666F\u76F4\u63A5\u8FDE\u901A\u4E5F\u53EF\u80FD\u88AB\u5220\u9664\uFF1B\u5C01\u95ED\u7684\u80CC\u666F\u6B8B\u8272\u3001\u4F4E\u5F69\u5EA6\u6D45\u8FB9\u548C\u8FD1\u9ED1\u6B8B\u8272\u53EF\u80FD\u4FDD\u7559\uFF0C\u8BF7\u653E\u5927\u68C0\u67E5\u3002"
      ]
    }
  };
}

// skills/pixel-asset-pipeline/scripts/runtime/vendor/strict-grid.ts
import sharp from "sharp";
var MAX_INPUT_PIXELS = 16777216;
var MAX_EXPORT_PIXELS = 32e6;
async function decode(buffer) {
  try {
    const result = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, animated: false }).rotate().toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data: new Uint8ClampedArray(result.data), width: result.info.width, height: result.info.height };
  } catch {
    throw new StudioError("\u56FE\u7247\u65E0\u6CD5\u8BFB\u53D6\u6216\u8D85\u8FC7 1677 \u4E07\u50CF\u7D20\u5904\u7406\u4E0A\u9650");
  }
}
function binaryAlpha(image, threshold) {
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = image.data[i + 3] >= threshold ? 255 : 0;
    image.data[i + 3] = alpha;
    if (!alpha) image.data[i] = image.data[i + 1] = image.data[i + 2] = 0;
  }
}
function imageStatistics(image) {
  const colors = /* @__PURE__ */ new Set();
  let transparent = 0, partial = 0, colorCountExact = true;
  for (let i = 0; i < image.data.length; i += 4) {
    const a = image.data[i + 3];
    if (!a) transparent++;
    else if (a < 255) partial++;
    if (colorCountExact) {
      colors.add((image.data[i] << 24 | image.data[i + 1] << 16 | image.data[i + 2] << 8 | a) >>> 0);
      if (colors.size > 1e6) colorCountExact = false;
    }
  }
  return { width: image.width, height: image.height, colorCount: colors.size, colorCountExact, transparentPixels: transparent, partialAlphaPixels: partial, transparentPercent: +(100 * transparent / (image.width * image.height)).toFixed(3), binaryAlpha: partial === 0 };
}
function rgbaKey(data, offset) {
  return (data[offset] << 24 | data[offset + 1] << 16 | data[offset + 2] << 8 | data[offset + 3]) >>> 0;
}
function constrainPalette(image, maximum) {
  const histogram = /* @__PURE__ */ new Map();
  let hasTransparent = false;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset + 3] === 0) {
      hasTransparent = true;
      continue;
    }
    const key = rgbaKey(image.data, offset), existing = histogram.get(key);
    if (existing) existing.count++;
    else histogram.set(key, { key, rgba: Array.from(image.data.subarray(offset, offset + 4)), count: 1 });
  }
  const foregroundLimit = Math.max(1, maximum - (hasTransparent ? 1 : 0));
  function makeBox(entries) {
    const means = [0, 0, 0, 0], variances = [0, 0, 0, 0], weights = [1, 1.7, 0.7, 1];
    const mass = entries.reduce((sum, entry) => sum + entry.count, 0);
    for (const entry of entries) for (let axis2 = 0; axis2 < 4; axis2++) means[axis2] += entry.rgba[axis2] * entry.count / mass;
    for (const entry of entries) for (let axis2 = 0; axis2 < 4; axis2++) variances[axis2] += (entry.rgba[axis2] - means[axis2]) ** 2 * entry.count * weights[axis2];
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
    for (let cursor = 0; cursor < sorted.length - 1; cursor++) {
      cumulative += sorted[cursor].count;
      split = cursor + 1;
      if (cumulative >= half) break;
    }
    boxes.splice(index, 1, makeBox(sorted.slice(0, split)), makeBox(sorted.slice(split)));
  }
  const mapping = /* @__PURE__ */ new Map();
  for (const box of boxes) {
    const mass = box.entries.reduce((sum, entry) => sum + entry.count, 0), representative = [0, 0, 0, 0];
    for (const entry of box.entries) for (let axis = 0; axis < 4; axis++) representative[axis] += entry.rgba[axis] * entry.count / mass;
    const rounded = representative.map((value) => Math.round(value));
    for (const entry of box.entries) mapping.set(entry.key, rounded);
  }
  const data = new Uint8ClampedArray(image.data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    if (image.data[offset + 3] === 0) continue;
    data.set(mapping.get(rgbaKey(image.data, offset)), offset);
  }
  return { data, width: image.width, height: image.height };
}
async function encode(image, paletteSize = 0, scale = 1, canonicalTransparent = false) {
  if (image.width * image.height * scale * scale > MAX_EXPORT_PIXELS) throw new StudioError("\u6574\u6570\u500D\u5BFC\u51FA\u540E\u8D85\u8FC7 3200 \u4E07\u50CF\u7D20\uFF0C\u8BF7\u964D\u4F4E\u653E\u5927\u500D\u6570");
  let pipeline = sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 4 } });
  let native = await pipeline.png(paletteSize ? { palette: true, colours: paletteSize, dither: 0, effort: 8 } : {}).toBuffer();
  let nativeImage = await decode(native), nativeStats = imageStatistics(nativeImage);
  if (paletteSize && Number(nativeStats.colorCount) > paletteSize) {
    nativeImage = constrainPalette(nativeImage, paletteSize);
    native = await sharp(Buffer.from(nativeImage.data), { raw: { width: nativeImage.width, height: nativeImage.height, channels: 4 } }).png().toBuffer();
    nativeStats = imageStatistics(await decode(native));
  }
  if (paletteSize && nativeStats.colorCountExact && Number(nativeStats.colorCount) > paletteSize) throw new StudioError("\u8272\u677F\u7EA6\u675F\u6821\u9A8C\u5931\u8D25\uFF0C\u672A\u4FDD\u5B58\u8D85\u51FA\u989C\u8272\u4E0A\u9650\u7684\u7ED3\u679C", 500);
  if (canonicalTransparent) {
    let changed = false;
    for (let offset = 0; offset < nativeImage.data.length; offset += 4) if (nativeImage.data[offset + 3] === 0 && (nativeImage.data[offset] || nativeImage.data[offset + 1] || nativeImage.data[offset + 2])) {
      nativeImage.data[offset] = nativeImage.data[offset + 1] = nativeImage.data[offset + 2] = 0;
      changed = true;
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
function gridCuts(size, count, phase) {
  const cuts2 = [0];
  for (let i = 1; i < count; i++) cuts2.push(Math.max(cuts2[i - 1] + 1, Math.min(size - (count - i), Math.round(size * i / count + phase))));
  cuts2.push(size);
  return cuts2;
}
function sampleGrid(source, cols, rows, phaseX, phaseY, alphaMode, threshold, sampler = "majority") {
  const colCuts = gridCuts(source.width, cols, phaseX), rowCuts = gridCuts(source.height, rows, phaseY);
  const data = new Uint8ClampedArray(cols * rows * 4);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const frequency = /* @__PURE__ */ new Map();
    let alphaSum = 0, visible = 0, total = 0;
    for (let y = rowCuts[row]; y < rowCuts[row + 1]; y++) for (let x = colCuts[col]; x < colCuts[col + 1]; x++) {
      const index = (y * source.width + x) * 4, a = source.data[index + 3];
      total++;
      alphaSum += a;
      if (a < (alphaMode === "binary" ? threshold : 1)) continue;
      visible++;
      const key = source.data[index] << 16 | source.data[index + 1] << 8 | source.data[index + 2];
      frequency.set(key, (frequency.get(key) || 0) + 1);
    }
    const out = (row * cols + col) * 4;
    if (!visible || alphaMode === "binary" && visible * 2 < total) continue;
    let best = 0, bestCount = -1;
    if (sampler === "center") {
      const centerX = Math.floor((colCuts[col] + colCuts[col + 1]) / 2), centerY = Math.floor((rowCuts[row] + rowCuts[row + 1]) / 2);
      let nearestDistance = Infinity;
      for (let y = rowCuts[row]; y < rowCuts[row + 1]; y++) for (let x = colCuts[col]; x < colCuts[col + 1]; x++) {
        const index = (y * source.width + x) * 4;
        if (source.data[index + 3] < (alphaMode === "binary" ? threshold : 1)) continue;
        const distance = (x - centerX) ** 2 + (y - centerY) ** 2;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          best = source.data[index] << 16 | source.data[index + 1] << 8 | source.data[index + 2];
        }
      }
    } else for (const [key, count] of frequency) if (count > bestCount) {
      bestCount = count;
      best = key;
    }
    data[out] = best >>> 16 & 255;
    data[out + 1] = best >>> 8 & 255;
    data[out + 2] = best & 255;
    data[out + 3] = alphaMode === "binary" ? 255 : Math.round(alphaSum / total);
  }
  return { image: { data, width: cols, height: rows }, colCuts, rowCuts };
}
async function strictGrid(source, width, height, options = {}) {
  const sampler = options.sampler ?? "center";
  if (sampler !== "center" && sampler !== "majority") throw new StudioError("\u4E25\u683C\u7F51\u683C\u91C7\u6837\u987B\u4E3Acenter\u6216majority");
  const layout = planPixelLayout(source.width, source.height, { fit: "contain", anchor: "center", cols: width, rows: height, scale: 1 });
  const prepared = { ...source, data: new Uint8ClampedArray(source.data) };
  binaryAlpha(prepared, 128);
  const sourcePalette = sampler === "majority" ? await encode(prepared, 256, 1, true) : void 0;
  const paletteImage = sourcePalette ? await decode(sourcePalette.buffer) : prepared;
  const sampled = sampleGrid(paletteImage, layout.content.width, layout.content.height, 0, 0, "binary", 128, sampler);
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < sampled.image.height; y++) frame.set(sampled.image.data.subarray(y * sampled.image.width * 4, (y + 1) * sampled.image.width * 4), ((layout.content.y + y) * width + layout.content.x) * 4);
  const frameImage = { data: frame, width, height }, sampledColors = /* @__PURE__ */ new Set();
  for (let i = 0; i < frame.length; i += 4) if (frame[i + 3]) sampledColors.add(frame[i] << 16 | frame[i + 1] << 8 | frame[i + 2]);
  const postPalette = sampler === "majority" || sampledColors.size > 8192 ? 256 : 0;
  const encoded = await encode(frameImage, postPalette, 1, true);
  const image = await decode(encoded.buffer);
  const palette = /* @__PURE__ */ new Map();
  const evidencePalette = sampler === "majority" ? paletteImage : image;
  for (let i = 0; i < evidencePalette.data.length; i += 4) if (evidencePalette.data[i + 3]) {
    const rgb = [evidencePalette.data[i], evidencePalette.data[i + 1], evidencePalette.data[i + 2]];
    palette.set(rgb[0] << 16 | rgb[1] << 8 | rgb[2], rgb);
  }
  return { image, diagnostics: { algorithm: sampler === "center" ? "fixed-grid-source-center-v2" : "fixed-grid-palette-first-majority-v1", sourceWidth: source.width, sourceHeight: source.height, width, height, fit: "contain", anchor: "center", contentX: layout.content.x, contentY: layout.content.y, contentWidth: layout.content.width, contentHeight: layout.content.height, colCuts: sampled.colCuts, rowCuts: sampled.rowCuts, alphaThreshold: 128, phaseX: 0, phaseY: 0, sampler, alphaSampler: "majority-coverage", paletteSize: postPalette, dither: 0, interpolation: "nearest", verifiedUniformBlocks: true, sampledVisibleColors: sampledColors.size, colorQuantization: sampler === "majority" ? "256-entry perceptual pre-palette may create RGB colors; later refinement uses grid colors" : postPalette ? "Sample original source centers first; >8192 visible sampled colors require a 256-entry post-palette; may create RGB colors" : "Actual source RGB samples; no grid-stage color quantization" }, evidence: { sourceRGBA: prepared, colCuts: sampled.colCuts, rowCuts: sampled.rowCuts, contentX: layout.content.x, contentY: layout.content.y, alphaThreshold: 128, paletteMappingPreserved: true, samplingPalette: [...palette.values()] } };
}
export {
  DETAIL_PROFILE_LABELS,
  PIXEL_ANCHORS,
  PIXEL_FITS,
  isLocalDigitalStraightProfile,
  normalizeAdaptiveColorRefinementOptions,
  normalizeDetailRefinementOptions,
  normalizeMaterialColorOptions,
  normalizeOuterContourOptions,
  planPixelLayout,
  refineAdaptiveColors,
  refineBackgroundColors,
  refineContourDetails,
  refineImageDetails,
  refineMaterialColors,
  refineOuterContour,
  refinePixelContour,
  removeBorderKeyShades,
  resolvePixelAnchor,
  resolvePixelFit,
  strictGrid
};
