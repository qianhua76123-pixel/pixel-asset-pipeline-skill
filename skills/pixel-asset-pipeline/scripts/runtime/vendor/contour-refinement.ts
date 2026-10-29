/** Experimental one-pixel silhouette corrections; no blur, resampling or erosion. */
export interface ContourImage { data: Uint8ClampedArray; width: number; height: number }
export interface ContourRefinementOptions { variant?: "A" | "B" }
export interface ContourChange { x: number; y: number; before: number[]; after: number[]; action: "remove-tooth" | "fill-notch"; direction: string; donor?: { x: number; y: number } }
export interface ContourDiagnostics {
  algorithm: "anchored-local-dss-reversal-v1"; variant: "A" | "B"; displacementBudget: 1;
  removedPixels: number; addedPixels: number; changedPixels: number; candidates: number;
  changes: ContourChange[]; changesTruncated: number; refused: Record<string, number>;
  topology: { foreground8Before: number; foreground8After: number; holes4Before: number; holes4After: number };
  protectedInteriorPixels: number; changedInteriorPixels: number;
  warnings: string[];
}
const AROUND = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;
const CARDINAL = [[0, -1], [-1, 0], [1, 0], [0, 1]] as const;
const MAX_PIXELS = 4_194_304, MAX_COORDINATES = 10_000;
function around(p: number, w: number, h: number, four = false): number[] {
  const x = p % w, y = Math.floor(p / w), result: number[] = [];
  for (const [dx, dy] of four ? CARDINAL : AROUND) if (x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h) result.push((y + dy) * w + x + dx);
  return result;
}
function components(mask: Uint8Array, w: number, h: number, four = false): number[][] {
  const visited = new Uint8Array(mask.length), all: number[][] = [];
  for (let p = 0; p < mask.length; p++) if (mask[p] && !visited[p]) {
    const queue = [p]; visited[p] = 1;
    for (let head = 0; head < queue.length; head++) for (const q of around(queue[head], w, h, four)) if (mask[q] && !visited[q]) { visited[q] = 1; queue.push(q); }
    all.push(queue);
  }
  return all;
}
function exterior(mask: Uint8Array, w: number, h: number): Uint8Array {
  const result = new Uint8Array(mask.length), queue: number[] = [];
  const add = (p: number) => { if (!mask[p] && !result[p]) { result[p] = 1; queue.push(p); } };
  for (let x = 0; x < w; x++) { add(x); add((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { add(y * w); add(y * w + w - 1); }
  for (let head = 0; head < queue.length; head++) for (const q of around(queue[head], w, h, true)) add(q);
  return result;
}
function topology(mask: Uint8Array, w: number, h: number): { fg: number; holes: number } {
  const ext = exterior(mask, w, h), holes = Uint8Array.from(mask, (v, p) => !v && !ext[p] ? 1 : 0);
  return { fg: components(mask, w, h).length, holes: components(holes, w, h, true).length };
}
/** Same (8,4) simple-point condition for a single addition or deletion. */
function simple(mask: Uint8Array, p: number, w: number, h: number): boolean {
  const x = p % w, y = Math.floor(p / w), foreground = new Uint8Array(9), background = new Uint8Array(9);
  if (!x || !y || x + 1 === w || y + 1 === h) return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) {
    const q = (dy + 1) * 3 + dx + 1; if (mask[(y + dy) * w + x + dx]) foreground[q] = 1; else background[q] = 1;
  }
  return components(foreground, 3, 3).length === 1 && components(background, 3, 3, true).filter(group => group.some(q => q === 1 || q === 3 || q === 5 || q === 7)).length === 1;
}

/**
 * Bounded naive-DSS recognizer for a short x-major profile. A valid sequence
 * obeys mu <= a*x-b*y < mu+b, |a|<=b. This explicitly accepts the legal 2,3
 * alternating runs of D(2,5,0,5), rather than sorting runs into equal lengths.
 * https://www.dgtal.org/doc/stable/moduleArithDSSReco.html
 */
export function isLocalDigitalStraightProfile(values: readonly number[]): boolean {
  if (!values.length || values.some(value => !Number.isSafeInteger(value))) return false;
  for (let b = 1; b <= 32; b++) for (let a = -b; a <= b; a++) {
    let low = Infinity, high = -Infinity;
    for (let x = 0; x < values.length; x++) { const value = a * x - b * (values[x] - values[0]); low = Math.min(low, value); high = Math.max(high, value); }
    if (high - low < b) return true;
  }
  return false;
}

interface Direction { name: string; nx: number; ny: number; tx: number; ty: number; size: number; limit: number; point(t: number, value: number): [number, number] }
interface Candidate { points: number[]; action: ContourChange["action"]; direction: Direction }
function directions(w: number, h: number): Direction[] {
  return [
    { name: "bottom", nx: 0, ny: 1, tx: 1, ty: 0, size: w, limit: h, point: (t, v) => [t, v] },
    { name: "top", nx: 0, ny: -1, tx: 1, ty: 0, size: w, limit: h, point: (t, v) => [t, h - 1 - v] },
    { name: "right", nx: 1, ny: 0, tx: 0, ty: 1, size: h, limit: w, point: (t, v) => [v, t] },
    { name: "left", nx: -1, ny: 0, tx: 0, ty: 1, size: h, limit: w, point: (t, v) => [w - 1 - v, t] },
  ];
}
function componentProfile(group: number[], w: number, h: number, d: Direction): number[] {
  const result = Array<number>(d.size).fill(-1);
  for (const p of group) {
    const x = p % w, y = Math.floor(p / w), t = d.tx ? x : y;
    const value = d.nx === 1 ? x : d.nx === -1 ? w - 1 - x : d.ny === 1 ? y : h - 1 - y;
    result[t] = Math.max(result[t], value);
  }
  return result;
}
function filledDonor(p: number, image: ContourImage, mask: Uint8Array, d: Direction): number | undefined {
  const { width: w, height: h, data } = image, x = p % w, y = Math.floor(p / w), candidates: number[] = [];
  for (let depth = 1; depth <= 2; depth++) for (let lateral = -1; lateral <= 1; lateral++) {
    const nx = x - depth * d.nx + lateral * d.tx, ny = y - depth * d.ny + lateral * d.ty;
    if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx]) candidates.push(ny * w + nx);
  }
  let best: { p: number; score: number } | undefined;
  for (const q of candidates) {
    const near = candidates.filter(other => [0, 1, 2].every(c => Math.abs(data[q * 4 + c] - data[other * 4 + c]) <= 32));
    if (near.length < 2) continue;
    const distance = Math.abs(q % w - x) + Math.abs(Math.floor(q / w) - y);
    const score = distance * 3 - near.length;
    if (!best || score < best.score || score === best.score && q < best.p) best = { p: q, score };
  }
  return best?.p;
}

export function refinePixelContour(input: ContourImage, options: ContourRefinementOptions = {}): { image: ContourImage; diagnostics: ContourDiagnostics } {
  const { width: w, height: h, data } = input;
  if (!(data instanceof Uint8ClampedArray) || !Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1 || w * h > MAX_PIXELS || data.length !== w * h * 4) throw new Error("轮廓整理需要有效的逻辑RGBA图");
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] !== 0 && data[i + 3] !== 255 || !data[i + 3] && (data[i] || data[i + 1] || data[i + 2])) throw new Error("轮廓整理需要硬透明及透明RGB归零");
  const variant = options.variant === undefined ? "A" : options.variant; if (variant !== "A" && variant !== "B") throw new Error("轮廓整理候选须为A或B");
  const mask = Uint8Array.from({ length: w * h }, (_, p) => data[p * 4 + 3] ? 1 : 0), original = mask.slice(), ext = exterior(mask, w, h), before = topology(mask, w, h);
  const edge = Uint8Array.from(mask, (v, p) => v && around(p, w, h).some(q => ext[q]) ? 1 : 0), holeEdge = Uint8Array.from(mask, (v, p) => v && around(p, w, h).some(q => !original[q] && !ext[q]) ? 1 : 0);
  const output = new Uint8ClampedArray(data), changedNear = new Uint8Array(mask.length), candidates: Candidate[] = [];
  const diagnostics: ContourDiagnostics = { algorithm: "anchored-local-dss-reversal-v1", variant, displacementBudget: 1, removedPixels: 0, addedPixels: 0, changedPixels: 0, candidates: 0, changes: [], changesTruncated: 0, refused: {}, topology: { foreground8Before: before.fg, foreground8After: before.fg, holes4Before: before.holes, holes4After: before.holes }, protectedInteriorPixels: original.reduce((sum, v, p) => sum + (v && !edge[p] ? 1 : 0), 0), changedInteriorPixels: 0, warnings: ["实验性局部轮廓整理：只修使锚定短弧恢复数字直线的1像素反向，不推断原画语义；保留合法2/3交替台阶。"] };
  const refuse = (reason: string) => { diagnostics.refused[reason] = (diagnostics.refused[reason] ?? 0) + 1; };
  // Each object supplies its own boundary profile: one atlas object must not
  // hide another object's bottom/top silhouette merely by sharing columns.
  for (const group of components(original, w, h).filter(group => group.length >= 16)) for (const d of directions(w, h)) {
    const values = componentProfile(group, w, h, d);
    for (let start = 3; start < values.length - 3; start++) {
      let end = start; while (end + 1 < values.length && values[end + 1] === values[start]) end++;
      if (end - start + 1 > (variant === "A" ? 1 : 2) || end + 3 >= values.length || values[start] < 0) { start = end; continue; }
      const left = values[start - 1], right = values[end + 1], v = values[start];
      const remove = v === Math.max(left, right) + 1, fill = variant === "B" && v === Math.min(left, right) - 1;
      if ((!remove && !fill) || Math.abs(left - right) > 1) { start = end; continue; }
      const arc = values.slice(start - 3, end + 4), proposed = [...arc];
      if (arc.some(v => v < 0) || isLocalDigitalStraightProfile(arc)) { start = end; continue; }
      for (let i = 3; i < 3 + end - start + 1; i++) proposed[i] += remove ? -1 : 1;
      if (!isLocalDigitalStraightProfile(proposed)) { refuse("uncertain-arc-or-real-turn"); start = end; continue; }
      const points: number[] = [];
      for (let t = start; t <= end; t++) { const [x, y] = d.point(t, v + (remove ? 0 : 1)); points.push(y * w + x); }
      candidates.push({ points, action: remove ? "remove-tooth" : "fill-notch", direction: d }); start = end;
    }
  }
  diagnostics.candidates = candidates.length;
  for (const candidate of candidates) {
    const { points, action, direction: d } = candidate, remove = action === "remove-tooth";
    if (points.some(p => changedNear[p])) { refuse("near-earlier-edit"); continue; }
    const edits: { p: number; donor?: number }[] = []; let reason: string | undefined;
    for (const p of points) {
      const x = p % w, y = Math.floor(p / w);
      if (holeEdge[p] || remove && !edge[p] || !remove && !ext[p]) { reason = "interior-or-hole"; break; }
      if ((remove ? 1 : 0) !== mask[p]) { reason = "changed-source"; break; }
      const solidRow = [-1, 0, 1].every(lateral => {
        const nx = x - 2 * d.nx + lateral * d.tx, ny = y - 2 * d.ny + lateral * d.ty;
        return nx >= 0 && ny >= 0 && nx < w && ny < h && original[ny * w + nx];
      });
      if (!solidRow || !around(p, w, h).some(q => original[q] && around(q, w, h).filter(n => original[n]).length >= 5)) { reason = "tip-whisker-or-thin-line"; break; }
      if (!simple(mask, p, w, h)) { reason = "non-simple-topology"; break; }
      const donor = remove ? undefined : filledDonor(p, input, original, d);
      if (!remove && donor === undefined) { reason = "no-supported-original-color"; break; }
      mask[p] = remove ? 0 : 1; edits.push({ p, donor });
    }
    if (reason) { for (const { p } of edits) mask[p] = original[p]; refuse(reason); continue; }
    for (const { p, donor } of edits) {
      if (remove) { output.fill(0, p * 4, p * 4 + 4); diagnostics.removedPixels++; }
      else { output.set(data.subarray(donor! * 4, donor! * 4 + 4), p * 4); diagnostics.addedPixels++; }
      diagnostics.changedPixels++; changedNear[p] = 1; for (const q of around(p, w, h)) changedNear[q] = 1;
      if (diagnostics.changes.length < MAX_COORDINATES) diagnostics.changes.push({ x: p % w, y: Math.floor(p / w), before: Array.from(data.subarray(p * 4, p * 4 + 4)), after: Array.from(output.subarray(p * 4, p * 4 + 4)), action, direction: d.name, ...(donor === undefined ? {} : { donor: { x: donor % w, y: Math.floor(donor / w) } }) }); else diagnostics.changesTruncated++;
    }
  }
  const after = topology(mask, w, h); diagnostics.topology.foreground8After = after.fg; diagnostics.topology.holes4After = after.holes;
  for (let p = 0; p < mask.length; p++) if (original[p] && !edge[p] && [0, 1, 2, 3].some(c => data[p * 4 + c] !== output[p * 4 + c])) diagnostics.changedInteriorPixels++;
  if (after.fg !== before.fg || after.holes !== before.holes || diagnostics.changedInteriorPixels) throw new Error("轮廓整理拓扑或内部保全校验失败");
  return { image: { data: output, width: w, height: h }, diagnostics };
}
