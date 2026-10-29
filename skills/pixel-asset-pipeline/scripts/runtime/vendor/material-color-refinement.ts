export interface MaterialColorImage { data: Uint8ClampedArray; width: number; height: number }
export type MaterialColorProfile = "foliage" | "glass";
export interface MaterialColorChange {
  x: number; y: number; beforeRGBA: number[]; afterRGBA: number[];
  reason: "inferred-local-leaf-material" | "inferred-neutral-glass-outline";
  donor: { x: number; y: number; rgba: number[] };
  supportPixels: number; materialPixels: number; contextPixels: number;
  confidence: "local-material-consensus"; inferred: true;
}
export interface MaterialColorDiagnostics {
  algorithm: "explicit-material-local-color-v1"; profile: MaterialColorProfile;
  alphaPreserved: true; localPaletteOnly: true; inferred: true; sourceRecoveryClaimed: false; singleFrozenPass: true; idempotent: false;
  changedPixels: number; candidatePixels: number; evaluatedPixels: number; protectedPixels: number;
  uncertainPixels: number; unprocessedPixels: number; budgetExhausted: boolean; comparisonUnits: number; comparisonBudget: number; candidateBudget: number;
  changes: MaterialColorChange[]; changesTruncated: number; refusedReasons: Record<string, number>; warnings: string[];
}
type Color = readonly [number, number, number];
const MAX_PIXELS = 4_194_304, MAX_COLORS = 8192, MAX_EVALUATIONS = 10_000, MAX_COMPARISONS = 8_000_000, MAX_CHANGES = 4000;
const AROUND = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;
const colorAt = (data: Uint8ClampedArray, p: number): Color => [data[p * 4], data[p * 4 + 1], data[p * 4 + 2]];
const luma = (c: Color) => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
const difference = (a: Color, b: Color) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
function neighbors(p: number, width: number, height: number): number[] {
  const x = p % width, y = Math.floor(p / width), result: number[] = [];
  for (const [dx, dy] of AROUND) if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height) result.push((y + dy) * width + x + dx);
  return result;
}
export function normalizeMaterialColorOptions(parameters: Readonly<Record<string, unknown>> = {}): { profile: MaterialColorProfile } {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters) || parameters.profile !== "foliage" && parameters.profile !== "glass") throw new Error("请选择叶片或玻璃材质后再清理残色");
  return { profile: parameters.profile };
}
/**
 * Explicitly chosen material inference, not reconstruction of lost source RGB.
 * Replaces only small bright-cyan leaf accents or saturated magenta glass-edge
 * pixels with already present local material colors. All decisions use frozen
 * input; transparent pixels, alpha, broad colored structures and palette stay
 * intact. A deliberately painted small cyan/purple accent remains ambiguous:
 * callers must offer before/after review, never promise semantic correctness.
 */
export function refineMaterialColors(image: MaterialColorImage, parameters: Readonly<Record<string, unknown>>): { image: MaterialColorImage; diagnostics: MaterialColorDiagnostics } {
  const { profile } = normalizeMaterialColorOptions(parameters);
  if (!image || !(image.data instanceof Uint8ClampedArray) || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > MAX_PIXELS || image.data.length !== image.width * image.height * 4) throw new Error("材质残色清理需要419万像素以内的有效逻辑RGBA图");
  const { data, width, height } = image, count = width * height, palette = new Set<number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 0 && data[i + 3] !== 255 || !data[i + 3] && (data[i] || data[i + 1] || data[i + 2])) throw new Error("材质残色清理需要硬透明且透明RGB清零的逻辑像素");
    if (data[i + 3]) palette.add(data[i] << 16 | data[i + 1] << 8 | data[i + 2]);
    if (palette.size > MAX_COLORS) throw new Error("材质残色清理输入超过8192种可见颜色，请先确认逻辑网格");
  }
  const output = new Uint8ClampedArray(data), candidate = new Uint8Array(count), protectedMap = new Uint8Array(count), boundaryDistance = new Uint8Array(count).fill(255);
  const diagnostics: MaterialColorDiagnostics = {
    algorithm: "explicit-material-local-color-v1", profile, alphaPreserved: true, localPaletteOnly: true, inferred: true, sourceRecoveryClaimed: false, singleFrozenPass: true, idempotent: false,
    changedPixels: 0, candidatePixels: 0, evaluatedPixels: 0, protectedPixels: 0, uncertainPixels: 0, unprocessedPixels: 0, budgetExhausted: false, comparisonUnits: 0, comparisonBudget: MAX_COMPARISONS, candidateBudget: MAX_EVALUATIONS,
    changes: [], changesTruncated: 0, refusedReasons: {}, warnings: ["这是按已选材质作局部推断，使用邻近原色，不能证明找回了丢失的真实颜色。", "保留透明轮廓与原生尺寸；细小的真实青色或紫色装饰仍可能误判，请对照原图检查。"],
  };
  // Distance only through the opaque foreground; sealed holes count as edges.
  for (let p = 0; p < count; p++) if (data[p * 4 + 3]) {
    const ns = neighbors(p, width, height);
    if (ns.length !== 8 || ns.some(q => !data[q * 4 + 3])) boundaryDistance[p] = 1;
  }
  if (profile === "glass") for (let p = 0; p < count; p++) if (data[p * 4 + 3] && boundaryDistance[p] !== 1 && neighbors(p, width, height).some(q => boundaryDistance[q] === 1)) boundaryDistance[p] = 2;
  const isCandidate = (c: Color) => profile === "foliage"
    ? c[1] >= 160 && c[2] >= 140 && c[1] - c[0] >= 75 && c[2] - c[0] >= 70 && Math.abs(c[1] - c[2]) <= 50
    : Math.min(c[0], c[2]) >= 30 && Math.min(c[0], c[2]) - c[1] >= 18 && c[1] < Math.min(c[0], c[2]) * .52;
  for (let p = 0; p < count; p++) if (data[p * 4 + 3] && isCandidate(colorAt(data, p))) candidate[p] = 1;
  const visited = new Uint8Array(count);
  for (let p = 0; p < count; p++) if (candidate[p] && !visited[p]) {
    const group = [p]; visited[p] = 1; let core = false, line = false;
    for (let head = 0; head < group.length; head++) {
      const q = group[head], ns = neighbors(q, width, height);
      if (ns.length === 8 && ns.every(n => candidate[n])) core = true;
      for (const n of ns) if (candidate[n] && !visited[n]) { visited[n] = 1; group.push(n); }
      if (profile === "foliage" && !line && group.length <= 12) for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const x = q % width, y = Math.floor(q / width);
        if (Array.from({ length: 4 }, (_, k) => [x + k * dx, y + k * dy]).every(([xx, yy]) => xx >= 0 && yy >= 0 && xx < width && yy < height && candidate[yy * width + xx])) line = true;
      }
    }
    if (core || profile === "foliage" && (line || group.length > 12)) for (const q of group) protectedMap[q] = 1;
  }
  const refuse = (reason: string, protect = false) => { diagnostics.refusedReasons[reason] = (diagnostics.refusedReasons[reason] || 0) + 1; if (protect) diagnostics.protectedPixels++; else diagnostics.uncertainPixels++; };
  const compare = () => { if (diagnostics.comparisonUnits >= MAX_COMPARISONS) { diagnostics.budgetExhausted = true; return false; } diagnostics.comparisonUnits++; return true; };
  for (let p = 0; p < count; p++) if (candidate[p]) diagnostics.candidatePixels++;
  pixels: for (let p = 0; p < count; p++) if (candidate[p]) {
    if (diagnostics.evaluatedPixels >= MAX_EVALUATIONS) { diagnostics.budgetExhausted = true; break; }
    diagnostics.evaluatedPixels++;
    if (protectedMap[p]) { refuse("coherent-colored-structure", true); continue; }
    if (profile === "glass" && boundaryDistance[p] > 2) { refuse("not-glass-alpha-boundary", true); continue; }
    const original = colorAt(data, p), queue = [{ p, distance: 0 }], seen = new Set([p]), context: { p: number; distance: number; color: Color }[] = [];
    for (let head = 0; head < queue.length; head++) {
      const point = queue[head]; if (point.distance === 4) continue;
      for (const q of neighbors(point.p, width, height)) {
        if (!compare()) break pixels;
        if (!data[q * 4 + 3] || seen.has(q)) continue;
        seen.add(q); const distance = point.distance + 1; queue.push({ p: q, distance });
        if (!candidate[q]) context.push({ p: q, distance, color: colorAt(data, q) });
      }
    }
    const material = context.filter(n => profile === "foliage"
      ? n.color[1] - n.color[0] >= 12 && n.color[1] - n.color[2] >= 14 && n.color[1] >= 35
      : Math.max(...n.color) - Math.min(...n.color) <= 32 && luma(n.color) <= Math.max(72, luma(original) * 1.25));
    const coloredContext = context.filter(n => Math.max(...n.color) - Math.min(...n.color) >= 12 && Math.max(...n.color) >= 35);
    if (material.length < (profile === "foliage" ? 5 : 3) || profile === "foliage" && material.length < coloredContext.length * .6) { refuse("insufficient-local-material-consensus"); continue; }
    const proposals = material.filter(n => n.distance <= 3);
    let best: { p: number; color: Color; support: number; score: number } | undefined;
    for (const donor of proposals) {
      let support = 0;
      for (const n of material) { if (!compare()) break pixels; if (difference(n.color, donor.color) <= (profile === "foliage" ? 32 : 18)) support++; }
      if (support < 3) continue;
      const closeLuma = profile === "foliage" ? Math.abs(luma(donor.color) - Math.min(luma(original), material.reduce((sum, n) => sum + luma(n.color), 0) / material.length + 18)) : Math.abs(luma(donor.color) - luma(original));
      const score = donor.distance * 8 + closeLuma * .35 - Math.min(12, support) * 2;
      if (!best || score < best.score || score === best.score && donor.p < best.p) best = { p: donor.p, color: donor.color, support, score };
    }
    if (!best) { refuse("no-coherent-local-original-color"); continue; }
    output.set(best.color, p * 4); diagnostics.changedPixels++;
    if (diagnostics.changes.length < MAX_CHANGES) diagnostics.changes.push({ x: p % width, y: Math.floor(p / width), beforeRGBA: [...original, 255], afterRGBA: [...best.color, 255], reason: profile === "foliage" ? "inferred-local-leaf-material" : "inferred-neutral-glass-outline", donor: { x: best.p % width, y: Math.floor(best.p / width), rgba: [...best.color, 255] }, supportPixels: best.support, materialPixels: material.length, contextPixels: context.length, confidence: "local-material-consensus", inferred: true });
    else diagnostics.changesTruncated++;
  }
  diagnostics.unprocessedPixels = diagnostics.candidatePixels - diagnostics.evaluatedPixels;
  if (diagnostics.budgetExhausted) diagnostics.warnings.push("达到本次计算上限，剩余颜色保留原样。");
  return { image: { data: output, width, height }, diagnostics };
}
