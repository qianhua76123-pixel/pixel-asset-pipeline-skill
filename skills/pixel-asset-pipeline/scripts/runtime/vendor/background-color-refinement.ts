import type { SourceGuidedImage } from "./image-types";

export interface BackgroundColorEvidence {
  /** Exact raster sampled by the saved strict grid, before palette mapping. */
  sourceRGBA: SourceGuidedImage;
  /** Same-coordinate pre-cutout pixels; retained RGB and alpha cap are checked. */
  unmattedSourceRGBA?: SourceGuidedImage;
  colCuts: readonly number[];
  rowCuts: readonly number[];
  contentX?: number;
  contentY?: number;
  alphaThreshold?: number;
  keyColor: string;
  /** False/absent after an explicit remap must not silently authorize recovery. */
  paletteMappingPreserved?: boolean;
  samplingPalette?: readonly (readonly [number, number, number])[];
}
type Color = readonly [number, number, number];
export interface BackgroundColorChange {
  x: number; y: number; beforeRGBA: number[]; afterRGBA: number[];
  reason: "source-cell-clean-material" | "source-neighbor-mixture-material";
  donor: { kind: "native" | "source"; x: number; y: number };
  nativeSupport: number; cleanSourceMatches: number; sourceVisible: number; sourceTotal: number;
  removedKeySamples: number; mixtureResidual: number;
}
export interface BackgroundColorDiagnostics {
  algorithm: "source-cell-local-background-color-v1";
  skipped: boolean; skipReason?: string;
  keyColor: string; keyKind: "chromatic" | "neutral";
  changedPixels: number; recoloredPixels: number; candidatePixels: number; evaluatedPixels: number;
  protectedMaterialPixels: number; uncertainPixels: number; unprocessedPixels: number;
  alphaPreserved: true; sourceColorsOnly: true; inputOrSourceColorsOnly: true; colorOrigin: "frozen-input-or-verified-source"; noInterpolatedColors: true; originalPaletteOnly: boolean;
  colorsBefore: number; colorsAfter: number; newSourceColors: number;
  keyEvidencePixels: number; removedRawPixels: number; keyEvidenceRatio: number;
  comparisonBudget: number; comparisonUnits: number; budgetExhausted: boolean; candidateLimitReached: boolean;
  refusedReasons: Record<string, number>; changes: BackgroundColorChange[]; changesTruncated: number;
  uncertain: { x: number; y: number; reason: string }[]; uncertainTruncated: number;
  warnings: string[];
}
const MAX_NATIVE = 4_194_304, MAX_SOURCE = 16_777_216, MAX_CELL = 4096, MAX_COLORS = 8192;
const MAX_CANDIDATES = 10_000, MAX_COMPARISONS = 8_000_000, MAX_RECORDS = 2000;
const AROUND = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;
function validImage(im: SourceGuidedImage, max: number): boolean { return !!im && im.data instanceof Uint8ClampedArray && Number.isSafeInteger(im.width) && Number.isSafeInteger(im.height) && im.width > 0 && im.height > 0 && im.width * im.height <= max && im.data.length === im.width * im.height * 4; }
function cuts(v: readonly number[], max: number): boolean { return Array.isArray(v) && v.length >= 2 && v.every((n, i) => Number.isSafeInteger(n) && n >= 0 && n <= max && (!i || n > v[i - 1])); }
const at = (data: Uint8ClampedArray, p: number): Color => [data[p * 4], data[p * 4 + 1], data[p * 4 + 2]];
const packed = (c: Color): number => c[0] * 65536 + c[1] * 256 + c[2];
const difference = (a: Color, b: Color): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const luma = (c: Color): number => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
function direction(c: Color, key: Color): number {
  const cm = (c[0] + c[1] + c[2]) / 3, km = (key[0] + key[1] + key[2]) / 3;
  const u = [c[0] - cm, c[1] - cm, c[2] - cm], v = [key[0] - km, key[1] - km, key[2] - km];
  const a = Math.hypot(...u), b = Math.hypot(...v);
  return a < 10 || b < 10 ? -1 : (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (a * b);
}
function mixture(c: Color, donor: Color, key: Color): { t: number; residual: number } {
  const d = [key[0] - donor[0], key[1] - donor[1], key[2] - donor[2]], denominator = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
  if (denominator < 4096) return { t: Infinity, residual: Infinity };
  const t = ((c[0] - donor[0]) * d[0] + (c[1] - donor[1]) * d[1] + (c[2] - donor[2]) * d[2]) / denominator;
  return { t, residual: Math.max(...c.map((n, i) => Math.abs(n - (donor[i] + t * d[i])))) };
}
function neighbors(p: number, width: number, height: number): number[] {
  const x = p % width, y = Math.floor(p / width), result: number[] = [];
  for (const [dx, dy] of AROUND) if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height) result.push((y + dy) * width + x + dx);
  return result;
}

/**
 * One frozen-input, RGB-only pass. The supplied background must explain most
 * source pixels actually removed by the registered matte. Uniform source color
 * and broad key-like material are protected; no color alone is a semantic label.
 * Small mixed source cells may borrow a clean source RGB with nearby native
 * support. Neutral fringes can additionally use a supported neighboring material
 * only when a local removed background and a tight mixture fit both exist.
 * This cannot distinguish every intentionally painted subpixel accent from a
 * background blend. Uncertain pixels stay unchanged; alpha is never repaired.
 */
export function refineBackgroundColors(current: SourceGuidedImage, evidence?: BackgroundColorEvidence): { image: SourceGuidedImage; diagnostics: BackgroundColorDiagnostics } {
  if (!validImage(current, MAX_NATIVE)) throw new Error("背景去污染需要419万像素以内的有效逻辑RGBA图");
  const { width, height, data } = current, paletteBefore = new Set<number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 0 && data[i + 3] !== 255 || !data[i + 3] && (data[i] || data[i + 1] || data[i + 2])) throw new Error("背景去污染需要硬透明且透明RGB清零的逻辑像素");
    if (data[i + 3]) paletteBefore.add(data[i] * 65536 + data[i + 1] * 256 + data[i + 2]);
  }
  if (paletteBefore.size > MAX_COLORS) throw new Error("背景去污染输入超过8192种可见颜色，请先确认逻辑网格");
  const output = new Uint8ClampedArray(data), suppliedKey = evidence?.keyColor;
  const key: Color = typeof suppliedKey === "string" && suppliedKey.length === 7 && /^#[0-9a-f]{6}$/i.test(suppliedKey) ? [1, 3, 5].map(i => parseInt(suppliedKey.slice(i, i + 2), 16)) as unknown as Color : [0, 0, 0];
  const neutral = Math.max(...key) - Math.min(...key) < 48;
  const diagnostics: BackgroundColorDiagnostics = {
    algorithm: "source-cell-local-background-color-v1", skipped: false, keyColor: typeof suppliedKey === "string" ? suppliedKey.toLowerCase() : "", keyKind: neutral ? "neutral" : "chromatic",
    changedPixels: 0, recoloredPixels: 0, candidatePixels: 0, evaluatedPixels: 0, protectedMaterialPixels: 0, uncertainPixels: 0, unprocessedPixels: 0,
    alphaPreserved: true, sourceColorsOnly: true, inputOrSourceColorsOnly: true, colorOrigin: "frozen-input-or-verified-source", noInterpolatedColors: true, originalPaletteOnly: true,
    colorsBefore: paletteBefore.size, colorsAfter: paletteBefore.size, newSourceColors: 0,
    keyEvidencePixels: 0, removedRawPixels: 0, keyEvidenceRatio: 0,
    comparisonBudget: MAX_COMPARISONS, comparisonUnits: 0, budgetExhausted: false, candidateLimitReached: false,
    refusedReasons: {}, changes: [], changesTruncated: 0, uncertain: [], uncertainTruncated: 0,
    warnings: ["仅用配准原图和局部材质支持修正背景混色，不改变透明轮廓或补孔；真实高光、粉色玻璃和青绿色细节仍需对照检查。", "变化量不代表正确率；没有可靠证据的颜色保留原样。"],
  };
  const result = () => ({ image: { data: output, width, height }, diagnostics });
  const skip = (reason: string) => { diagnostics.skipped = true; diagnostics.skipReason = reason; return result(); };
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
  const inContent = (x: number, y: number) => x >= contentX && y >= contentY && x - contentX < colCuts.length - 1 && y - contentY < rowCuts.length - 1;
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
  if (diagnostics.keyEvidencePixels < 4 || diagnostics.keyEvidenceRatio < .6) return skip("key-evidence-mismatch");
  const isCandidateColor = (c: Color) => neutral ? Math.max(...c) - Math.min(...c) <= 48 && luma(c) >= Math.max(48, luma(key) * .25) && luma(c) <= luma(key) : direction(c, key) >= .94;
  const isCleanColor = (c: Color) => difference(c, key) > 32 && (neutral ? !isCandidateColor(c) : direction(c, key) < .85);
  const candidate = new Uint8Array(width * height), protectedMaterial = new Uint8Array(width * height);
  for (let p = 0; p < candidate.length; p++) if (data[p * 4 + 3] && isCandidateColor(at(data, p))) { candidate[p] = 1; diagnostics.candidatePixels++; }
  const visited = new Uint8Array(candidate.length);
  // Protect complete connected key-like material with a genuine 3x3 core.
  for (let p = 0; p < candidate.length; p++) if (candidate[p] && !visited[p]) {
    const group = [p]; visited[p] = 1; let core = false;
    for (let head = 0; head < group.length; head++) {
      const q = group[head], ns = neighbors(q, width, height);
      if (ns.length === 8 && ns.every(n => candidate[n])) core = true;
      for (const n of ns) if (candidate[n] && !visited[n]) { visited[n] = 1; group.push(n); }
    }
    if (core) for (const q of group) protectedMaterial[q] = 1;
  }
  const refuse = (p: number, reason: string, protectedColor = false) => {
    diagnostics.refusedReasons[reason] = (diagnostics.refusedReasons[reason] ?? 0) + 1;
    if (protectedColor) diagnostics.protectedMaterialPixels++;
    else {
      diagnostics.uncertainPixels++;
      if (diagnostics.uncertain.length < MAX_RECORDS) diagnostics.uncertain.push({ x: p % width, y: Math.floor(p / width), reason }); else diagnostics.uncertainTruncated++;
    }
  };
  const compare = () => { if (diagnostics.comparisonUnits >= MAX_COMPARISONS) { diagnostics.budgetExhausted = true; return false; } diagnostics.comparisonUnits++; return true; };
  const cellFor = (p: number) => { const x = p % width - contentX, y = Math.floor(p / width) - contentY; return { left: colCuts[x], right: colCuts[x + 1], top: rowCuts[y], bottom: rowCuts[y + 1] }; };
  type Cell = { colors: { color: Color; p: number }[]; total: number; visible: number; removed: number; keyLike: number };
  const readCell = (p: number): Cell | undefined => {
    const b = cellFor(p), cell: Cell = { colors: [], total: (b.right - b.left) * (b.bottom - b.top), visible: 0, removed: 0, keyLike: 0 };
    for (let y = b.top; y < b.bottom; y++) for (let x = b.left; x < b.right; x++) {
      if (!compare()) return;
      const q = y * source.width + x, i = q * 4;
      if (raw.data[i + 3] < threshold) continue;
      if (source.data[i + 3] < threshold) { if (difference(at(raw.data, q), key) <= 24) cell.removed++; continue; }
      const color = at(raw.data, q); cell.colors.push({ color, p: q }); cell.visible++;
      if (isCandidateColor(color)) cell.keyLike++;
    }
    return cell;
  };
  const paletteAfter = new Set(paletteBefore);
  pixels: for (let p = 0; p < candidate.length; p++) if (candidate[p]) {
    if (diagnostics.evaluatedPixels >= MAX_CANDIDATES) { diagnostics.candidateLimitReached = true; break; }
    diagnostics.evaluatedPixels++;
    if (protectedMaterial[p]) { refuse(p, "broad-key-like-material", true); continue; }
    const original = at(data, p);
    if (difference(original, key) <= 24) { refuse(p, "near-key-pixel-needs-alpha-decision"); continue; }
    const cell = readCell(p); if (!cell) break pixels;
    const minMatches = Math.max(2, Math.ceil(cell.total * .2));
    if (cell.visible * 2 < cell.total) { refuse(p, "insufficient-source-foreground-coverage"); continue; }
    let currentSupport = 0;
    for (const item of cell.colors) { if (!compare()) break pixels; if (difference(item.color, original) <= 16) currentSupport++; }
    const queue = [{ p, distance: 0 }], seen = new Set([p]), nearby: { p: number; distance: number; color: Color }[] = [];
    let coherent = 0;
    for (let head = 0; head < queue.length; head++) {
      const point = queue[head]; if (point.distance === 3) continue;
      for (const n of neighbors(point.p, width, height)) if (data[n * 4 + 3] && inContent(n % width, Math.floor(n / width)) && !seen.has(n)) {
        seen.add(n); const distance = point.distance + 1, color = at(data, n); queue.push({ p: n, distance });
        if (distance <= 1 && difference(color, original) <= 16) coherent++;
        if (isCleanColor(color)) nearby.push({ p: n, distance, color });
      }
    }
    if (!neutral && coherent >= 2 && currentSupport * 2 >= cell.visible) { refuse(p, "source-supported-colored-structure", true); continue; }
    if (!nearby.length) { refuse(p, "no-connected-clean-native-material"); continue; }
    const b = cellFor(p); let exposure = cell.removed;
    for (let y = Math.max(0, b.top - 1); y < Math.min(source.height, b.bottom + 1); y++) for (let x = Math.max(0, b.left - 1); x < Math.min(source.width, b.right + 1); x++) {
      if (x >= b.left && x < b.right && y >= b.top && y < b.bottom) continue;
      if (!compare()) break pixels;
      const q = y * source.width + x;
      if (source.data[q * 4 + 3] < threshold && raw.data[q * 4 + 3] >= threshold && difference(at(raw.data, q), key) <= 24) exposure++;
    }
    const sourceColors = new Map<number, { color: Color; p: number; count: number }>();
    for (const item of cell.colors) if (isCleanColor(item.color)) {
      const key = packed(item.color), old = sourceColors.get(key);
      if (old) old.count++; else sourceColors.set(key, { ...item, count: 1 });
    }
    const proposals: { color: Color; kind: "source" | "native"; p: number; distance: number }[] = [...sourceColors.values()].sort((a, b) => b.count - a.count || a.p - b.p).slice(0, 16).map(x => ({ ...x, kind: "source", distance: 0 }));
    const used = new Set<number>();
    for (const n of nearby) if (!used.has(packed(n.color))) { used.add(packed(n.color)); proposals.push({ ...n, kind: "native" }); if (used.size === 16) break; }
    let best: { proposal: typeof proposals[number]; matches: number; support: number; residual: number; score: number; reason: BackgroundColorChange["reason"] } | undefined;
    for (const proposal of proposals) {
      let support = 0;
      for (const n of nearby) { if (!compare()) break pixels; if (difference(n.color, proposal.color) <= 24) support++; }
      if (support < 2 || difference(original, proposal.color) < 12) continue;
      let cleanMatches = 0;
      for (const item of cell.colors) { if (!compare()) break pixels; if (isCleanColor(item.color) && difference(item.color, proposal.color) <= 20) cleanMatches++; }
      const fit = mixture(original, proposal.color, key);
      const strongChromatic = !neutral && direction(original, key) >= .995;
      let reason: BackgroundColorChange["reason"] | undefined;
      if (cleanMatches >= minMatches && cell.keyLike >= 2 && (fit.t >= .04 && fit.t <= .9 && fit.residual <= 16 || strongChromatic && cleanMatches * 4 >= cell.visible)) reason = "source-cell-clean-material";
      if (!reason && proposal.kind === "native" && exposure >= 2 && fit.t >= .08 && fit.t <= .85 && fit.residual <= 10) {
        // A neighboring real native material must itself have raw foreground
        // support. A previous edit cannot become a fabricated source witness.
        const donorCell = readCell(proposal.p); if (!donorCell) break pixels;
        let donorMatches = 0;
        for (const item of donorCell.colors) { if (!compare()) break pixels; if (difference(item.color, proposal.color) <= 24 && isCleanColor(item.color)) donorMatches++; }
        if (donorCell.visible * 2 >= donorCell.total && donorMatches >= Math.max(2, Math.ceil(donorCell.total * .4))) {
          let explained = 0, weighted = 0;
          for (const item of cell.colors) {
            if (!compare()) break pixels;
            const f = mixture(item.color, proposal.color, key);
            if (f.t >= -.05 && f.t <= .85 && f.residual <= 10) { explained++; weighted += 1 - Math.max(0, f.t); }
          }
          if (explained * 4 >= cell.visible * 3 && weighted >= cell.visible * .35) reason = "source-neighbor-mixture-material";
        }
      }
      if (!reason) continue;
      const residual = Number.isFinite(fit.residual) ? fit.residual : 255;
      const score = (reason === "source-cell-clean-material" ? -1000 : 0) - cleanMatches * 10 + residual + proposal.distance - Math.min(6, support);
      if (!best || score < best.score || score === best.score && (proposal.kind === "native" && best.proposal.kind !== "native" || proposal.kind === best.proposal.kind && proposal.p < best.proposal.p)) best = { proposal, matches: cleanMatches, support, residual, score, reason };
    }
    if (!best) { refuse(p, "insufficient-local-source-material-evidence"); continue; }
    const color = packed(best.proposal.color);
    if (!paletteAfter.has(color) && paletteAfter.size >= MAX_COLORS) { refuse(p, "output-color-budget"); continue; }
    paletteAfter.add(color); output.set(best.proposal.color, p * 4); diagnostics.changedPixels++; diagnostics.recoloredPixels++;
    if (diagnostics.changes.length < MAX_RECORDS) diagnostics.changes.push({ x: p % width, y: Math.floor(p / width), beforeRGBA: [...original, 255], afterRGBA: [...best.proposal.color, 255], reason: best.reason, donor: { kind: best.proposal.kind, x: best.proposal.p % (best.proposal.kind === "source" ? source.width : width), y: Math.floor(best.proposal.p / (best.proposal.kind === "source" ? source.width : width)) }, nativeSupport: best.support, cleanSourceMatches: best.matches, sourceVisible: cell.visible, sourceTotal: cell.total, removedKeySamples: exposure, mixtureResidual: best.residual }); else diagnostics.changesTruncated++;
  }
  diagnostics.unprocessedPixels = diagnostics.candidatePixels - diagnostics.evaluatedPixels;
  if (diagnostics.budgetExhausted) { diagnostics.unprocessedPixels++; diagnostics.evaluatedPixels--; }
  const actualColors = new Set<number>(); for (let i = 0; i < output.length; i += 4) if (output[i + 3]) actualColors.add(output[i] * 65536 + output[i + 1] * 256 + output[i + 2]);
  diagnostics.colorsAfter = actualColors.size; diagnostics.newSourceColors = [...actualColors].filter(c => !paletteBefore.has(c)).length; diagnostics.originalPaletteOnly = diagnostics.newSourceColors === 0;
  if (diagnostics.budgetExhausted || diagnostics.candidateLimitReached) diagnostics.warnings.push("达到本次计算上限，未完成评估的像素保留原样。");
  return result();
}
