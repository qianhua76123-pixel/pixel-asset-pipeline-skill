import { isLocalDigitalStraightProfile } from "./contour-refinement";

export interface OuterContourImage { data: Uint8ClampedArray; width: number; height: number }
export interface OuterContourChange {
  x: number; y: number; beforeRGBA: number[]; afterRGBA: number[];
  action: "remove-outer-step" | "fill-outer-step" | "shift-original-outline-band" | "regularize-original-outline-width";
  group: number; donor?: { x: number; y: number; rgba: number[] };
}
export interface OuterContourDiagnostics {
  algorithm: "bounded-bamboo-joint-rhythm-v2"; profile: "bamboo";
  shapeInferred: true; sourceRecoveryClaimed: false; displacementBudget: 1;
  originalPaletteOnly: true; framePreserved: true; bboxPreserved: true; holePixelsPreserved: true;
  changedPixels: number; addedPixels: number; removedPixels: number; recoloredPixels: number;
  candidateGroups: number; acceptedGroups: number; rejectedChecks: number;
  topology: { foreground8Before: number; foreground8After: number; holes4Before: number; holes4After: number };
  changes: OuterContourChange[]; refusedReasons: Record<string, number>;
  estimatedProfileComparisons: number; comparisonBudget: number; budgetExhausted: boolean;
  alphaChangeBudget: number; warnings: string[];
}
const MAX_PIXELS = 1_048_576, MAX_PROFILE_COMPARISONS = 8_000_000;
const FOUR = [[0, -1], [-1, 0], [1, 0], [0, 1]] as const;
const EIGHT = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;
const DIRECTIONS = [[1, 0, 0, 1], [-1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0]] as const;
function neighbors(p: number, w: number, h: number, four = false): number[] {
  const x = p % w, y = Math.floor(p / w), result: number[] = [];
  for (const [dx, dy] of four ? FOUR : EIGHT) if (x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h) result.push((y + dy) * w + x + dx);
  return result;
}
function components(mask: Uint8Array, w: number, h: number, four = false): number {
  const seen = new Uint8Array(mask.length); let count = 0;
  for (let p = 0; p < mask.length; p++) if (mask[p] && !seen[p]) {
    count++; const queue = [p]; seen[p] = 1;
    for (let head = 0; head < queue.length; head++) for (const q of neighbors(queue[head], w, h, four)) if (mask[q] && !seen[q]) { seen[q] = 1; queue.push(q); }
  }
  return count;
}
function exterior(mask: Uint8Array, w: number, h: number): Uint8Array {
  const result = new Uint8Array(mask.length), queue: number[] = [];
  const add = (p: number) => { if (!mask[p] && !result[p]) { result[p] = 1; queue.push(p); } };
  for (let x = 0; x < w; x++) { add(x); add((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { add(y * w); add(y * w + w - 1); }
  for (let head = 0; head < queue.length; head++) for (const q of neighbors(queue[head], w, h, true)) add(q);
  return result;
}
function topology(mask: Uint8Array, w: number, h: number): { fg: number; holes: number } {
  const ext = exterior(mask, w, h);
  return { fg: components(mask, w, h), holes: components(Uint8Array.from(mask, (v, p) => !v && !ext[p] ? 1 : 0), w, h, true) };
}
function bounds(mask: Uint8Array, w: number): number[] {
  let left = w, top = mask.length / w, right = -1, bottom = -1;
  for (let p = 0; p < mask.length; p++) if (mask[p]) { left = Math.min(left, p % w); top = Math.min(top, Math.floor(p / w)); right = Math.max(right, p % w); bottom = Math.max(bottom, Math.floor(p / w)); }
  return [left, top, right, bottom];
}
/** Strict local (8,4) simple point, protecting foreground and background connectivity. */
function simple(mask: Uint8Array, p: number, w: number, h: number): boolean {
  const x = p % w, y = Math.floor(p / w), fg = new Uint8Array(9), bg = new Uint8Array(9);
  if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) {
    const q = (dy + 1) * 3 + dx + 1; if (mask[(y + dy) * w + x + dx]) fg[q] = 1; else bg[q] = 1;
  }
  return components(fg, 3, 3) === 1 && components(bg, 3, 3, true) === 1;
}
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
export function normalizeOuterContourOptions(parameters: Readonly<Record<string, unknown>> = {}): { profile: "bamboo" } {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters) || parameters.profile !== undefined && parameters.profile !== "bamboo") throw new Error("外轮廓整理目前只支持竹木细杆物品");
  return { profile: "bamboo" };
}
interface TracePoint { p: number; s: number; depth: number; inkDepth: number; wood: boolean; narrow: boolean; direction: number }
interface EdgeProposal extends TracePoint { delta: number; score: number; votes: number; deltaSum: number }
interface BandProposal { p: number; donor: number; score: number }
interface BandVote { point: TracePoint; delta: number; votes: number; sum: number }
const TRACE_WINDOW = 32, MIN_TRACE = 20;
function fitProfile(values: number[]): { slope: number; intercept: number; errors: number[] } {
  const slopes: number[] = [];
  for (let a = 0; a < values.length; a++) for (let b = a + Math.min(8, Math.floor(values.length / 3)); b < values.length; b++) slopes.push((values[b] - values[a]) / (b - a));
  const slope = median(slopes), intercept = median(values.map((value, i) => value - slope * i));
  return { slope, intercept, errors: values.map((value, i) => value - intercept - slope * i) };
}
/** A bounded monotone digital path. Unlike independently moving one outlier per
 * window, all rows of a strip must agree on a single 0/1-step progression. */
function regularPath(points: TracePoint[], slope: number, intercept: number): number[] | undefined {
  const sign = slope < 0 ? -1 : 1;
  const states: Map<number, { score: number; previous: number | null }>[] = [new Map([[points[0].s, { score: 0, previous: null }]])];
  for (let i = 1; i < points.length; i++) {
    const row = new Map<number, { score: number; previous: number | null }>(), point = points[i];
    for (let shift = -1; shift <= 1; shift++) {
      if (shift && (!point.wood || point.depth < 1 || point.depth > 5 || i === points.length - 1)) continue;
      const value = point.s + shift, cost = (value - intercept - slope * i) ** 2 + Math.abs(shift) * .05;
      for (const [previous, state] of states[i - 1]) {
        const step = sign * (value - previous);
        if (step < 0 || step > 1) continue;
        const score = state.score + cost;
        if (!row.has(value) || score < row.get(value)!.score) row.set(value, { score, previous });
      }
    }
    if (!row.size) return;
    states.push(row);
  }
  let value = [...states.at(-1)!].sort((a, b) => a[1].score - b[1].score)[0][0];
  const result: number[] = [];
  for (let i = states.length - 1; i >= 0; i--) { result[i] = value; value = states[i].get(value)!.previous!; }
  return result;
}
/**
 * Bamboo-only local shape inference. Trace supported exposed strips, regularize
 * their digital stair rhythm as a joint path, and stabilize the original dark
 * band's width. No resampling, blur or interpolated RGB is used. Existing hole
 * masks, thin strips, endpoints, turns, bounds and the original palette survive.
 */
export function refineOuterContour(image: OuterContourImage, parameters: Readonly<Record<string, unknown>> = {}): { image: OuterContourImage; diagnostics: OuterContourDiagnostics } {
  normalizeOuterContourOptions(parameters);
  if (!image || !(image.data instanceof Uint8ClampedArray) || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > MAX_PIXELS || image.data.length !== image.width * image.height * 4) throw new Error("外轮廓整理需要104万逻辑像素以内的有效RGBA图");
  const { data, width: w, height: h } = image, original = new Uint8Array(w * h); let visible = 0;
  for (let p = 0; p < original.length; p++) {
    const i = p * 4;
    if (data[i + 3] !== 0 && data[i + 3] !== 255 || !data[i + 3] && (data[i] || data[i + 1] || data[i + 2])) throw new Error("外轮廓整理需要硬透明及透明RGB清零");
    if (data[i + 3]) { original[p] = 1; visible++; }
  }
  const mask = original.slice(), ext = exterior(original, w, h), holeBand = new Uint8Array(original.length), output = new Uint8ClampedArray(data), before = topology(original, w, h), bbox = bounds(original, w);
  const diagnostics: OuterContourDiagnostics = { algorithm: "bounded-bamboo-joint-rhythm-v2", profile: "bamboo", shapeInferred: true, sourceRecoveryClaimed: false, displacementBudget: 1, originalPaletteOnly: true, framePreserved: true, bboxPreserved: true, holePixelsPreserved: true, changedPixels: 0, addedPixels: 0, removedPixels: 0, recoloredPixels: 0, candidateGroups: 0, acceptedGroups: 0, rejectedChecks: 0, topology: { foreground8Before: before.fg, foreground8After: before.fg, holes4Before: before.holes, holes4After: before.holes }, changes: [], refusedReasons: {}, estimatedProfileComparisons: 0, comparisonBudget: MAX_PROFILE_COMPARISONS, budgetExhausted: false, alphaChangeBudget: Math.min(128, Math.floor(visible * .01)), warnings: ["沿竹木物品受支撑的局部直线段推断台阶，外缘最多移动1个逻辑像素；不代表恢复了原画真实轮廓。", "墨带厚度依局部多数整理，真实竹节、曲线、接头仍需人工对照；重复输入上次结果可能继续小幅变化，建议从固定上游重跑对照。"] };
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const has = (x: number, y: number) => inside(x, y) && !!original[y * w + x];
  const luminance = (p: number) => .2126 * data[p * 4] + .7152 * data[p * 4 + 1] + .0722 * data[p * 4 + 2];
  const dark = (p: number) => luminance(p) < 64;
  const warm = (p: number) => data[p * 4 + 3] === 255 && data[p * 4] >= 60 && data[p * 4] >= data[p * 4 + 1] + 10 && data[p * 4 + 1] >= data[p * 4 + 2] + 10;
  const refuse = (reason: string) => { diagnostics.refusedReasons[reason] = (diagnostics.refusedReasons[reason] || 0) + 1; diagnostics.rejectedChecks++; };
  const compare = () => { if (diagnostics.estimatedProfileComparisons >= MAX_PROFILE_COMPARISONS) { diagnostics.budgetExhausted = true; return false; } diagnostics.estimatedProfileComparisons++; return true; };
  for (let p = 0; p < original.length; p++) if (!original[p] && !ext[p]) {
    const x = p % w, y = Math.floor(p / w);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inside(x + dx, y + dy)) holeBand[(y + dy) * w + x + dx] = 1;
  }
  const edges: EdgeProposal[] = [], bands: BandProposal[] = [], bandVotes: BandVote[] = [], traces: TracePoint[][] = [];
  directionScan: for (let direction = 0; direction < DIRECTIONS.length; direction++) {
    const [nx, ny, tx, ty] = DIRECTIONS[direction], step = ny * w + nx, count = ty ? h : w, span = ny ? h : w;
    const rows: TracePoint[][] = [], rowIndexes: Map<number, TracePoint>[] = [];
    for (let t = 0; t < count; t++) {
      const row: TracePoint[] = [];
      for (let s = 1; s < span - 1; s++) {
        if (!compare()) break directionScan;
        const x = t * tx + s * nx + (nx < 0 ? w - 1 : 0), y = t * ty + s * ny + (ny < 0 ? h - 1 : 0), p = y * w + x;
        if (!has(x, y) || !inside(x + nx, y + ny) || !ext[p + step]) continue;
        let depth = 0, inkDepth = 0;
        while (inkDepth < 7 && has(x - inkDepth * nx, y - inkDepth * ny) && luminance(p - inkDepth * step) < 32) inkDepth++;
        while (depth < 7 && has(x - depth * nx, y - depth * ny) && dark(p - depth * step)) depth++;
        // Seven solid pixels are required along the normal; fine rods remain untouched.
        if (![1, 2, 3, 4, 5, 6].every(k => has(x - k * nx, y - k * ny))) continue;
        let narrow = false;
        for (let normalDepth = 7; normalDepth <= 36; normalDepth++) {
          if (!compare()) break directionScan;
          if (!has(x - normalDepth * nx, y - normalDepth * ny)) { narrow = true; break; }
        }
        row.push({ p, s, depth, inkDepth, wood: depth < 6 && warm(p - depth * step) && warm(p - (depth + 1) * step), narrow, direction });
      }
      rows.push(row); rowIndexes.push(new Map(row.map(point => [point.s, point])));
    }
    const visited = new Set<number>();
    for (let t = 0; t < count; t++) for (const start of rows[t]) {
      if (visited.has(start.p)) continue;
      const trace = [start]; visited.add(start.p);
      for (let nextRow = t + 1; nextRow < count; nextRow++) {
        const previous = trace.at(-1)!, matches: TracePoint[] = [];
        for (let offset = -3; offset <= 3; offset++) {
          if (!compare()) break directionScan;
          const point = rowIndexes[nextRow].get(previous.s + offset); if (point) matches.push(point);
        }
        if (matches.length !== 1 || visited.has(matches[0].p)) break;
        trace.push(matches[0]); visited.add(matches[0].p);
      }
      if (trace.length < MIN_TRACE) continue;
      traces.push(trace);
      for (let from = 0; from <= trace.length - MIN_TRACE; from += TRACE_WINDOW / 2) {
        if (!compare()) break directionScan;
        const points = trace.slice(from, from + TRACE_WINDOW), values = points.map(point => point.s), work = values.length * values.length * 2 + values.length * (9 + 1088);
        if (diagnostics.estimatedProfileComparisons + work > MAX_PROFILE_COMPARISONS) { diagnostics.budgetExhausted = true; break directionScan; }
        diagnostics.estimatedProfileComparisons += work;
        const fitted = fitProfile(values), middle = Math.floor(values.length / 2);
        const firstSlope = fitProfile(values.slice(0, middle + 1)).slope, lastSlope = fitProfile(values.slice(middle)).slope;
        if (Math.abs(fitted.slope) > .65 || Math.abs(firstSlope - lastSlope) > .13 || firstSlope * lastSlope < 0 && Math.max(Math.abs(firstSlope), Math.abs(lastSlope)) > .03 || Math.max(...fitted.errors.map(Math.abs)) > 2 || fitted.errors.reduce((sum, error) => sum + Math.abs(error), 0) / values.length > .85 || points.filter(point => point.wood).length < points.length * .9) { refuse("curved-turn-or-insufficient-wood-support"); continue; }
        const targets = isLocalDigitalStraightProfile(values) ? values : regularPath(points, fitted.slope, fitted.intercept);
        if (!targets) { refuse("no-bounded-monotone-path"); continue; }
        const depths = points.map(point => point.inkDepth), commonDepth = median([...depths]), supportedWidth = depths.filter(depth => depth === commonDepth).length >= depths.length * .5;
        for (let i = 0; i < points.length; i++) {
          const point = points[i], delta = targets[i] - point.s;
          edges.push({ ...point, delta, score: Math.abs(fitted.errors[i]), votes: 1, deltaSum: delta });
          const widthDelta = i > 0 && i < points.length - 1 && supportedWidth && point.wood && point.narrow && point.inkDepth >= 1 && point.inkDepth <= 5 && commonDepth >= 1 && commonDepth <= 4 ? Math.sign(commonDepth - point.inkDepth) : 0;
          bandVotes.push({ point, delta: widthDelta, votes: 1, sum: widthDelta });
        }
      }
    }
  }
  const votes = new Map<string, EdgeProposal>();
  for (const edge of edges) {
    const key = `${edge.p}:${edge.direction}`, prior = votes.get(key);
    if (prior) { prior.votes++; prior.deltaSum += edge.delta; prior.score = Math.max(prior.score, edge.score); }
    else votes.set(key, { ...edge });
  }
  const candidates = [...votes.values()].filter(edge => edge.delta !== 0 && Math.abs(edge.deltaSum) === edge.votes).sort((a, b) => b.votes - a.votes || b.score - a.score);
  const widthVotes = new Map<string, BandVote>();
  for (const vote of bandVotes) {
    const key = `${vote.point.p}:${vote.point.direction}`, prior = widthVotes.get(key);
    if (prior) { prior.votes++; prior.sum += vote.delta; } else widthVotes.set(key, { ...vote });
  }
  for (const vote of widthVotes.values()) if (vote.delta !== 0 && Math.abs(vote.sum) === vote.votes) {
    const { point } = vote, [nx, ny] = DIRECTIONS[point.direction], step = ny * w + nx, thinning = vote.delta < 0;
    bands.push({ p: point.p - (thinning ? point.inkDepth - 1 : point.inkDepth) * step, donor: thinning ? point.p - point.inkDepth * step : point.p, score: vote.votes });
  }
  // A keep/conflict vote can block a step that its neighbour needed. Reject
  // adjacent proposals until their joint path cannot introduce a new reverse
  // tooth or larger jump at a window seam.
  const active = new Map(candidates.map(candidate => [`${candidate.p}:${candidate.direction}`, candidate]));
  seamScan: for (let pass = 0; pass < TRACE_WINDOW; pass++) {
    let removed = false;
    for (const trace of traces) {
      const trend = Math.sign(trace.at(-1)!.s - trace[0].s);
      for (let i = 1; i < trace.length; i++) {
        if (!compare()) { active.clear(); break seamScan; }
        const a = trace[i - 1], b = trace[i], ka = `${a.p}:${a.direction}`, kb = `${b.p}:${b.direction}`, da = active.get(ka)?.delta || 0, db = active.get(kb)?.delta || 0;
        if (!da && !db) continue;
        const oldStep = b.s - a.s, newStep = oldStep + db - da, reverse = (step: number) => trend ? Math.max(0, -trend * step) : Math.abs(step);
        if (reverse(newStep) > reverse(oldStep) || Math.abs(newStep) > Math.max(1, Math.abs(oldStep))) {
          if (active.delete(ka)) removed = true;
          if (active.delete(kb)) removed = true;
        }
      }
    }
    if (!removed) break;
  }
  diagnostics.candidateGroups = active.size + bands.length;
  const changed = new Set<number>(), changeInfo = new Map<number, { action: OuterContourChange["action"]; group: number; donor?: number }>();
  const set = (p: number, donor: number | undefined, action: OuterContourChange["action"], group: number) => {
    output.set(donor === undefined ? [0, 0, 0, 0] : data.subarray(donor * 4, donor * 4 + 4), p * 4);
    changed.add(p); changeInfo.set(p, { action, group, donor });
  };
  for (const candidate of active.values()) {
    if (diagnostics.acceptedGroups >= diagnostics.alphaChangeBudget) { diagnostics.budgetExhausted = true; break; }
    const [nx, ny] = DIRECTIONS[candidate.direction], step = ny * w + nx, remove = candidate.delta < 0, target = remove ? candidate.p : candidate.p + step;
    const recolor = remove ? candidate.p - candidate.depth * step : candidate.p - (candidate.depth - 1) * step, donor = remove ? candidate.p : candidate.p - candidate.depth * step;
    const x = target % w, y = Math.floor(target / w);
    if (x <= bbox[0] || x >= bbox[2] || y <= bbox[1] || y >= bbox[3] || holeBand[recolor] || changed.has(target) || changed.has(recolor) || mask[target] !== +remove || !simple(mask, target, w, h)) { refuse("anchor-topology-or-overlapping-edit"); continue; }
    const group = diagnostics.acceptedGroups++;
    mask[target] = remove ? 0 : 1;
    set(target, remove ? undefined : candidate.p, remove ? "remove-outer-step" : "fill-outer-step", group);
    set(recolor, donor, "shift-original-outline-band", group);
  }
  // Recheck the actual applied mask: a topology rejection or edit budget can
  // skip one member of an otherwise valid planned path. Roll back whole edit
  // groups at an affected seam, including their accompanying RGB band shift.
  const rollback = (groups: Set<number>) => {
    for (const [p, info] of changeInfo) if (groups.has(info.group)) {
      output.set(data.subarray(p * 4, p * 4 + 4), p * 4); mask[p] = original[p];
      changed.delete(p); changeInfo.delete(p);
    }
  };
  actualSeamScan: for (let pass = 0; pass < TRACE_WINDOW; pass++) {
    const groups = new Set<number>();
    for (const trace of traces) {
      const trend = Math.sign(trace.at(-1)!.s - trace[0].s);
      const delta = (point: TracePoint) => { const [nx, ny] = DIRECTIONS[point.direction], step = ny * w + nx; return !mask[point.p] ? -1 : !original[point.p + step] && mask[point.p + step] ? 1 : 0; };
      for (let i = 1; i < trace.length; i++) {
        if (!compare()) { rollback(new Set([...changeInfo.values()].map(info => info.group))); break actualSeamScan; }
        const a = trace[i - 1], b = trace[i], da = delta(a), db = delta(b);
        const oldStep = b.s - a.s, newStep = oldStep + db - da, reverse = (step: number) => trend ? Math.max(0, -trend * step) : Math.abs(step);
        if (reverse(newStep) <= reverse(oldStep) && Math.abs(newStep) <= Math.max(1, Math.abs(oldStep))) continue;
        for (const point of [a, b]) {
          const [nx, ny] = DIRECTIONS[point.direction], step = ny * w + nx;
          for (const p of [point.p, point.p + step]) { const info = changeInfo.get(p); if (info) groups.add(info.group); }
        }
      }
    }
    if (!groups.size) break;
    rollback(groups); refuse("actual-window-seam-rollback");
    if (pass === TRACE_WINDOW - 1) { rollback(new Set([...changeInfo.values()].map(info => info.group))); refuse("actual-seam-convergence-fallback"); }
  }
  const colorBudget = Math.min(512, Math.floor(visible * .02)); let colorChanges = 0;
  for (const band of bands.sort((a, b) => b.score - a.score)) {
    if (holeBand[band.p] || changed.has(band.p) || !mask[band.p]) continue;
    if (colorChanges >= colorBudget) { diagnostics.budgetExhausted = true; break; }
    set(band.p, band.donor, "regularize-original-outline-width", diagnostics.acceptedGroups++); colorChanges++;
  }
  const after = topology(mask, w, h), afterBounds = bounds(mask, w), afterExterior = exterior(mask, w, h);
  if (after.fg !== before.fg || after.holes !== before.holes || bbox.some((value, i) => value !== afterBounds[i]) || original.some((value, p) => (!value && !ext[p]) !== (!mask[p] && !afterExterior[p]))) throw new Error("外轮廓整理的拓扑、孔洞或锚点保全校验失败");
  diagnostics.topology.foreground8After = after.fg; diagnostics.topology.holes4After = after.holes;
  for (let p = 0; p < mask.length; p++) if ([0, 1, 2, 3].some(channel => data[p * 4 + channel] !== output[p * 4 + channel])) {
    diagnostics.changedPixels++;
    if (!original[p]) diagnostics.addedPixels++; else if (!mask[p]) diagnostics.removedPixels++; else diagnostics.recoloredPixels++;
    const info = changeInfo.get(p)!;
    diagnostics.changes.push({ x: p % w, y: Math.floor(p / w), beforeRGBA: Array.from(data.subarray(p * 4, p * 4 + 4)), afterRGBA: Array.from(output.subarray(p * 4, p * 4 + 4)), action: info.action, group: info.group, ...(info.donor === undefined ? {} : { donor: { x: info.donor % w, y: Math.floor(info.donor / w), rgba: Array.from(data.subarray(info.donor * 4, info.donor * 4 + 4)) } }) });
  }
  diagnostics.acceptedGroups = new Set(diagnostics.changes.map(change => change.group)).size;
  if (diagnostics.budgetExhausted) diagnostics.warnings.push("达到本次计算或改动上限，剩余轮廓保留原样。");
  return { image: { data: output, width: w, height: h }, diagnostics };
}
