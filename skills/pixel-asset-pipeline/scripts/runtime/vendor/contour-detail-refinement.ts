/** RGB-only cleanup of short inward outline teeth on warm bamboo/wood sprites. */
export interface ContourDetailImage { data: Uint8ClampedArray; width: number; height: number }
export interface ContourDetailChange {
  x: number; y: number; beforeRGBA: number[]; afterRGBA: number[];
  reason: "supported-inner-outline-tooth"; donor: { x: number; y: number };
  warmCardinalSupport: number; darkNeighborSupport: number; transparencyDistance: number;
}
export interface ContourDetailDiagnostics {
  algorithm: "frozen-warm-material-inner-outline-v1";
  material: "bamboo-wood"; alphaPreserved: true; dimensionsPreserved: true;
  originalPaletteOnly: true; inferredMaterialColor: true; frozenInput: true;
  changedPixels: number; recoloredPixels: number; addedPixels: 0; removedPixels: 0;
  candidatePixels: number; protectedPixels: number; refusedReasons: Record<string, number>;
  changes: ContourDetailChange[]; changesTruncated: number;
  comparisonUnits: number; comparisonBudget: number; budgetExhausted: boolean;
  warnings: string[];
}
const MAX_PIXELS = 4_194_304, MAX_CHANGES = 10_000, MAX_COMPARISONS = 8_000_000;
const EIGHT = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;
const FOUR = [[0, -1], [-1, 0], [1, 0], [0, 1]] as const;
const colorDistance = (a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number) => Math.max(Math.abs(a[ai] - b[bi]), Math.abs(a[ai + 1] - b[bi + 1]), Math.abs(a[ai + 2] - b[bi + 2]));
function componentCount(mask: Uint8Array, four: boolean): number {
  const visited = new Uint8Array(9); let count = 0;
  for (let p = 0; p < 9; p++) if (mask[p] && !visited[p]) {
    count++; const queue = [p]; visited[p] = 1;
    for (let head = 0; head < queue.length; head++) {
      const x = queue[head] % 3, y = Math.floor(queue[head] / 3);
      for (const [dx, dy] of four ? FOUR : EIGHT) if (x + dx >= 0 && x + dx < 3 && y + dy >= 0 && y + dy < 3) {
        const q = (y + dy) * 3 + x + dx; if (mask[q] && !visited[q]) { visited[q] = 1; queue.push(q); }
      }
    }
  }
  return count;
}
/** A dark-color removal must not cut a drawn line or close a dark-color loop. */
function simpleDarkRemoval(dark: Uint8Array, p: number, width: number): boolean {
  const fg = new Uint8Array(9), bg = new Uint8Array(9), x = p % width, y = Math.floor(p / width);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) {
    const q = (dy + 1) * 3 + dx + 1; if (dark[(y + dy) * width + x + dx]) fg[q] = 1; else bg[q] = 1;
  }
  return componentCount(fg, false) === 1 && componentCount(bg, true) === 1;
}

/**
 * Prunes only a one-pixel, warm-material-surrounded tooth on the INNER dark
 * outline. The true alpha boundary, fine drawn endpoints, corners, and holes
 * never move. Supply is a supported original warm RGB, not interpolated color.
 * This infers a local bamboo/wood material; it cannot certify authorial intent
 * or correct an already jagged alpha silhouette. All decisions read frozen input.
 */
export function refineContourDetails(image: ContourDetailImage, parameters: Readonly<Record<string, unknown>> = {}): { image: ContourDetailImage; diagnostics: ContourDetailDiagnostics } {
  const { data, width, height } = image;
  if (!(data instanceof Uint8ClampedArray) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS || data.length !== width * height * 4) throw new Error("黑边细节整理需要419万像素以内的有效逻辑RGBA图");
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters) || parameters.material !== undefined && parameters.material !== "bamboo-wood") throw new Error("黑边细节整理目前仅支持竹木材质");
  const dark = new Uint8Array(width * height), warm = new Uint8Array(width * height);
  for (let p = 0; p < dark.length; p++) {
    const i = p * 4;
    if (data[i + 3] !== 0 && data[i + 3] !== 255 || !data[i + 3] && (data[i] || data[i + 1] || data[i + 2])) throw new Error("黑边细节整理需要硬透明且透明RGB清零");
    if (!data[i + 3]) continue;
    dark[p] = Math.max(data[i], data[i + 1], data[i + 2]) <= 48 ? 1 : 0;
    warm[p] = data[i] >= 60 && data[i] >= data[i + 1] + 10 && data[i + 1] >= data[i + 2] + 10 ? 1 : 0;
  }
  const output = new Uint8ClampedArray(data), nearChanged = new Uint8Array(dark.length);
  const diagnostics: ContourDetailDiagnostics = {
    algorithm: "frozen-warm-material-inner-outline-v1", material: "bamboo-wood", alphaPreserved: true, dimensionsPreserved: true,
    originalPaletteOnly: true, inferredMaterialColor: true, frozenInput: true, changedPixels: 0, recoloredPixels: 0,
    addedPixels: 0, removedPixels: 0, candidatePixels: 0, protectedPixels: 0, refusedReasons: {}, changes: [], changesTruncated: 0,
    comparisonUnits: 0, comparisonBudget: MAX_COMPARISONS, budgetExhausted: false,
    warnings: ["仅整理竹木材质内侧的单像素黑色突刺，不移动透明轮廓、细杆或镂空。", "供色来自冻结输入的局部竹木原色，但材质归属仍是局部推断；真实黑色装饰和已有外轮廓抖动须对照检查。"],
  };
  const refuse = (reason: string) => { diagnostics.refusedReasons[reason] = (diagnostics.refusedReasons[reason] || 0) + 1; diagnostics.protectedPixels++; };
  const compare = () => { if (diagnostics.comparisonUnits >= MAX_COMPARISONS) { diagnostics.budgetExhausted = true; return false; } diagnostics.comparisonUnits++; return true; };
  pixels: for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const p = y * width + x; if (!dark[p]) continue;
    const ring = EIGHT.map(([dx, dy]) => (y + dy) * width + x + dx), card = FOUR.map(([dx, dy]) => (y + dy) * width + x + dx);
    if (ring.some(q => !data[q * 4 + 3])) { refuse("true-alpha-boundary-or-thin-rod"); continue; }
    const warmCard = card.filter(q => warm[q]), darkCard = card.filter(q => dark[q]), darkRing = ring.filter(q => dark[q]);
    if (warmCard.length !== 3 || darkCard.length !== 1 || darkRing.length < 3 || darkRing.length > 5) { refuse("not-an-isolated-inward-tooth"); continue; }
    diagnostics.candidatePixels++;
    if (nearChanged[p]) { refuse("near-earlier-edit"); continue; }
    if (!simpleDarkRemoval(dark, p, width)) { refuse("drawn-line-or-loop-topology"); continue; }
    let distance = 5;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      if (!compare()) break pixels;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || !data[(ny * width + nx) * 4 + 3]) distance = Math.min(distance, Math.max(Math.abs(dx), Math.abs(dy)));
    }
    if (distance > 4) { refuse("interior-drawn-detail"); continue; }
    // Look one/two steps into the material-facing side, not through the black
    // base or across transparent openings. A donor needs another real near-color.
    const donors = new Set(warmCard);
    for (const q of warmCard) {
      const qx = q % width, qy = Math.floor(q / width);
      for (const [dx, dy] of FOUR) { const nx = qx + dx, ny = qy + dy; if (nx > 0 && ny > 0 && nx < width - 1 && ny < height - 1 && warm[ny * width + nx]) donors.add(ny * width + nx); }
    }
    let best: { p: number; support: number; score: number } | undefined;
    for (const q of donors) {
      let support = 0;
      for (const other of donors) { if (!compare()) break pixels; if (other !== q && colorDistance(data, q * 4, data, other * 4) <= 28) support++; }
      if (support < 2) continue;
      const distance = Math.abs(q % width - x) + Math.abs(Math.floor(q / width) - y);
      const contrast = colorDistance(data, p * 4, data, q * 4), score = contrast * .12 + distance * 3 - Math.min(support, 5);
      if (!best || score < best.score || score === best.score && q < best.p) best = { p: q, support, score };
    }
    if (!best) { refuse("no-supported-warm-original-color"); continue; }
    if (diagnostics.changedPixels >= MAX_CHANGES) { diagnostics.budgetExhausted = true; break pixels; }
    output.set(data.subarray(best.p * 4, best.p * 4 + 3), p * 4);
    diagnostics.changedPixels++; diagnostics.recoloredPixels++;
    diagnostics.changes.push({ x, y, beforeRGBA: Array.from(data.subarray(p * 4, p * 4 + 4)), afterRGBA: Array.from(output.subarray(p * 4, p * 4 + 4)), reason: "supported-inner-outline-tooth", donor: { x: best.p % width, y: Math.floor(best.p / width) }, warmCardinalSupport: warmCard.length, darkNeighborSupport: darkRing.length, transparencyDistance: distance });
    nearChanged[p] = 1; for (const q of ring) nearChanged[q] = 1;
  }
  return { image: { data: output, width, height }, diagnostics };
}
