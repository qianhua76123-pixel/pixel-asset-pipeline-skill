/** Coverage-aware pixel preparation: chroma fringe, dominant-cell sampling, palette lock.
 * Grid cells stay discrete. No smooth resize and no repeated refinement passes.
 */

const MAX_PIXELS = 16_777_216;

export function hsv(r, g, b) {
  const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b), chroma = maximum - minimum;
  let hue = 0;
  if (chroma) {
    if (maximum === r) hue = 60 * (((g - b) / chroma) % 6);
    else if (maximum === g) hue = 60 * ((b - r) / chroma + 2);
    else hue = 60 * ((r - g) / chroma + 4);
  }
  if (hue < 0) hue += 360;
  return { hue, chroma, value: maximum, saturation: maximum ? chroma / maximum : 0 };
}
const hueDistance = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

function assertImage(image) {
  if (!image || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > MAX_PIXELS || image.data?.length !== image.width * image.height * 4) throw Error('Expected an RGBA image within 16,777,216 pixels.');
}

function srgbToLab(r, g, b) {
  const linear = [r, g, b].map(value => { const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; });
  let x = linear[0] * 0.4124564 + linear[1] * 0.3575761 + linear[2] * 0.1804375;
  let y = linear[0] * 0.2126729 + linear[1] * 0.7151522 + linear[2] * 0.0721750;
  let z = linear[0] * 0.0193339 + linear[1] * 0.1191920 + linear[2] * 0.9503041;
  x /= 0.95047; z /= 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787037 * t + 16 / 116;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export function labDistanceSquared(a, b) {
  return 1.25 * (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function keyChannels(color) {
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw Error('Expected a #RRGGBB chroma key.');
  return [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
}

/** Spill is key-hue contamination, not every dark pixel. Neutral keys have no hue family. */
export function isKeySpill(r, g, b, key) {
  const reference = hsv(...key);
  if (reference.saturation < 0.45 || reference.chroma < 48) return false;
  const candidate = hsv(r, g, b);
  return candidate.saturation >= 0.28 && candidate.value >= 28 && candidate.chroma >= 26 && hueDistance(candidate.hue, reference.hue) <= 46;
}

/**
 * Remove a chromatic backing and the fringe connected to it.
 * Surviving pixels keep their original RGB. Solid interior key-hue material
 * (a blob with a 3-neighbor core) is kept; border-connected and thin fringe is not.
 */
export function removeKeyFringe(image, keyColor) {
  assertImage(image);
  const key = keyChannels(keyColor), width = image.width, height = image.height, count = width * height;
  const data = new Uint8ClampedArray(image.data);
  const hard = (r, g, b) => Math.max(Math.abs(r - key[0]), Math.abs(g - key[1]), Math.abs(b - key[2])) <= 48;
  let hardRemoved = 0;
  for (let p = 0; p < count; p++) {
    const i = p * 4;
    if (data[i + 3] < 16 || (data[i + 3] >= 16 && hard(data[i], data[i + 1], data[i + 2]))) {
      if (data[i + 3]) hardRemoved++;
      data.fill(0, i, i + 4);
    }
  }
  const opaque = p => data[p * 4 + 3] >= 128;
  const spill = p => opaque(p) && isKeySpill(data[p * 4], data[p * 4 + 1], data[p * 4 + 2], key);
  const similar = (a, b) => Math.max(Math.abs(data[a * 4] - data[b * 4]), Math.abs(data[a * 4 + 1] - data[b * 4 + 1]), Math.abs(data[a * 4 + 2] - data[b * 4 + 2])) <= 40;
  const seen = new Uint8Array(count), queue = [];
  const enqueue = p => {
    if (seen[p]) return;
    seen[p] = 1;
    if (data[p * 4 + 3] < 128 || spill(p)) queue.push(p);
  };
  for (let x = 0; x < width; x++) { enqueue(x); if (height > 1) enqueue((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y++) { enqueue(y * width); if (width > 1) enqueue(y * width + width - 1); }
  let borderRemoved = 0;
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head], x = p % width, y = Math.floor(p / width);
    if (opaque(p)) { data.fill(0, p * 4, p * 4 + 4); borderRemoved++; }
    if (x) enqueue(p - 1);
    if (x + 1 < width) enqueue(p + 1);
    if (y) enqueue(p - width);
    if (y + 1 < height) enqueue(p + width);
  }
  const protectedPixel = new Uint8Array(count), mark = new Uint8Array(count);
  let protectedComponents = 0, protectedPixels = 0;
  for (let p = 0; p < count; p++) if (spill(p) && !mark[p]) {
    const component = [p]; mark[p] = 1; const member = new Set([p]);
    for (let head = 0; head < component.length; head++) {
      const q = component[head], x = q % width, y = Math.floor(q / width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (mark[n] || !spill(n) || !similar(q, n)) continue;
        mark[n] = 1; component.push(n); member.add(n);
      }
    }
    let core = false;
    if (component.length >= 4) for (const q of component) {
      const x = q % width, y = Math.floor(q / width);
      let neighbors = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && member.has(ny * width + nx)) neighbors++;
      }
      if (neighbors >= 3) { core = true; break; }
    }
    if (core) { protectedComponents++; for (const q of component) { protectedPixel[q] = 1; protectedPixels++; } }
  }
  let peeled = 0;
  for (let pass = 0; pass < 6; pass++) {
    const kill = [];
    for (let p = 0; p < count; p++) {
      if (!spill(p) || protectedPixel[p]) continue;
      const x = p % width, y = Math.floor(p / width);
      let edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (!edge) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (data[((y + dy) * width + x + dx) * 4 + 3] < 128) edge = true;
      if (edge) kill.push(p);
    }
    if (!kill.length) break;
    for (const p of kill) data.fill(0, p * 4, p * 4 + 4);
    peeled += kill.length;
  }
  let specks = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x;
    if (!spill(p) || protectedPixel[p]) continue;
    let similarNeighbors = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      if (spill(n) && similar(p, n)) similarNeighbors++;
    }
    if (similarNeighbors < 2) { data.fill(0, p * 4, p * 4 + 4); specks++; }
  }
  return {
    image: { width, height, data },
    diagnostics: {
      algorithm: 'chroma-fringe-v1', keyColor: keyColor.toLowerCase(), tolerance: 48,
      hardRemoved, borderRemoved, peeled, specks, protectedComponents, protectedPixels,
      retainedRgbUnchanged: true,
      warning: 'Border-connected key-hue fringe is removed. A solid interior blob of the same hue is kept. Foreground that is only the key color, with no separating edge, is removed.',
    },
  };
}

/** Recolor key-hue pixels that touch transparency, using the nearest non-spill color. Alpha stays put. */
export function despillEdges(image, keyColor, radius = 2) {
  assertImage(image);
  const key = keyChannels(keyColor), width = image.width, height = image.height, count = width * height;
  const data = new Uint8ClampedArray(image.data);
  const reference = hsv(...key);
  const family = reference.saturation >= 0.45 && reference.chroma >= 48;
  if (!family || radius < 1) return { image: { width, height, data }, diagnostics: { algorithm: 'edge-despill-v1', recolored: 0, skipped: !family, radius } };
  const spillAt = (r, g, b) => isKeySpill(r, g, b, key);
  const ix = new Int32Array(count), iy = new Int32Array(count), seen = new Uint8Array(count), queue = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x, i = p * 4;
    if (data[i + 3] >= 128 && !spillAt(data[i], data[i + 1], data[i + 2])) { seen[p] = 1; ix[p] = x; iy[p] = y; queue.push(p); }
  }
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head], x = p % width, y = Math.floor(p / width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      if (seen[n]) continue;
      seen[n] = 1; ix[n] = ix[p]; iy[n] = iy[p]; queue.push(n);
    }
  }
  let recolored = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x, i = p * 4;
    if (data[i + 3] < 128 || !spillAt(data[i], data[i + 1], data[i + 2])) continue;
    let near = false;
    for (let dy = -radius; dy <= radius && !near; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || data[(ny * width + nx) * 4 + 3] < 128) near = true;
    }
    if (!near) continue;
    const sx = ix[p], sy = iy[p];
    if (!seen[p] && data[(sy * width + sx) * 4 + 3] < 128) continue;
    if (Math.abs(sx - x) + Math.abs(sy - y) > 16) continue;
    const j = (sy * width + sx) * 4;
    if (data[j + 3] < 128) continue;
    if (data[i] === data[j] && data[i + 1] === data[j + 1] && data[i + 2] === data[j + 2]) continue;
    data[i] = data[j]; data[i + 1] = data[j + 1]; data[i + 2] = data[j + 2]; recolored++;
  }
  return { image: { width, height, data }, diagnostics: { algorithm: 'edge-despill-v1', recolored, radius, alphaPreserved: true } };
}

export function gridCuts(size, count, phase = 0) {
  if (!Number.isSafeInteger(size) || !Number.isSafeInteger(count) || count < 1 || count > size) throw Error('Grid cell count must fit inside the source.');
  const cuts = [0];
  for (let i = 1; i < count; i++) cuts.push(Math.max(cuts[i - 1] + 1, Math.min(size - (count - i), Math.round(size * i / count + phase))));
  cuts.push(size);
  return cuts;
}

/** Snap interior boundaries onto a detected pixel lattice, then keep them strictly increasing. */
export function snappedCuts(size, count, period, phase) {
  const base = gridCuts(size, count, 0);
  if (!period || period < 2) return base;
  const cuts = [0];
  for (let i = 1; i < count; i++) {
    const n = Math.round((base[i] - phase) / period);
    let boundary = phase + n * period;
    boundary = Math.max(cuts[i - 1] + 1, Math.min(size - (count - i), boundary));
    cuts.push(boundary);
  }
  cuts.push(size);
  return cuts;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
}

/**
 * One cell, one real foreground color: the median of the heaviest 5-bit bucket.
 * Coverage uses alpha. Cells under half coverage stay transparent. Dark pixels
 * get a small weight so outlines are not lost to a flat neighbor.
 */
export function sampleCoverage(source, canvasWidth, canvasHeight, layout) {
  assertImage(source);
  const { cols, rows, colCuts, rowCuts, contentX, contentY } = layout;
  if (!Number.isSafeInteger(canvasWidth) || !Number.isSafeInteger(canvasHeight) || cols < 1 || rows < 1 || contentX < 0 || contentY < 0 || contentX + cols > canvasWidth || contentY + rows > canvasHeight) throw Error('Coverage sampling layout does not fit the canvas.');
  if (colCuts.length !== cols + 1 || rowCuts.length !== rows + 1) throw Error('Coverage sampling cuts do not match the cell count.');
  const data = new Uint8ClampedArray(canvasWidth * canvasHeight * 4);
  let opaqueCells = 0;
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const buckets = new Map();
    let coverage = 0, total = 0;
    const x0 = colCuts[col], x1 = colCuts[col + 1], y0 = rowCuts[row], y1 = rowCuts[row + 1];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * source.width + x) * 4, a = source.data[i + 3];
      total++;
      const weight = a / 255;
      coverage += weight;
      if (a < 128) continue;
      const r = source.data[i], g = source.data[i + 1], b = source.data[i + 2];
      const key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, bucket = { weight: 0, r: [], g: [], b: [] });
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const sampleWeight = weight * (luma < 36 ? 1.6 : 1);
      bucket.weight += sampleWeight; bucket.r.push(r); bucket.g.push(g); bucket.b.push(b);
    }
    const out = ((contentY + row) * canvasWidth + contentX + col) * 4;
    if (!total || coverage * 2 < total || !buckets.size) continue;
    let best = null;
    for (const bucket of buckets.values()) if (!best || bucket.weight > best.weight) best = bucket;
    data[out] = median(best.r); data[out + 1] = median(best.g); data[out + 2] = median(best.b); data[out + 3] = 255;
    opaqueCells++;
  }
  return { image: { width: canvasWidth, height: canvasHeight, data }, diagnostics: { opaqueCells, coverageThreshold: 0.5, colorRule: 'heaviest-5-bit-bucket-median', darkWeight: 1.6 } };
}

function axisEnergy(image, horizontal) {
  const energy = new Float64Array(horizontal ? image.width : image.height);
  const { width, height, data } = image;
  if (horizontal) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width - 1; x++) {
      const i = (y * width + x) * 4, j = i + 4;
      energy[x + 1] += Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
    }
  } else {
    for (let y = 0; y < height - 1; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, j = i + width * 4;
      energy[y + 1] += Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
    }
  }
  return energy;
}
function periodOf(energy) {
  const n = energy.length, maxLag = Math.min(48, Math.floor(n / 4));
  if (maxLag < 2) return { period: 0, phase: 0, score: 0 };
  let mean = 0; for (const value of energy) mean += value; mean /= n;
  let period = 0, score = 0;
  for (let lag = 2; lag <= maxLag; lag++) {
    let num = 0, den = 0;
    for (let i = 0; i + lag < n; i++) { const a = energy[i] - mean, b = energy[i + lag] - mean; num += a * b; den += a * a; }
    const next = den > 0 ? num / den : 0;
    if (next > score) { score = next; period = lag; }
  }
  let phase = 0, phaseScore = -1;
  if (period >= 2) for (let p = 0; p < period; p++) {
    let sum = 0, samples = 0;
    for (let i = p; i < n; i += period) { sum += energy[i]; samples++; }
    const average = samples ? sum / samples : 0;
    if (average > phaseScore) { phaseScore = average; phase = p; }
  }
  return { period, phase, score };
}

/** Estimate an upscaled pixel lattice. Low confidence means the caller should keep phase 0. */
export function detectPixelGrid(image) {
  assertImage(image);
  const x = periodOf(axisEnergy(image, true)), y = periodOf(axisEnergy(image, false));
  const confident = x.score >= 0.45 && y.score >= 0.45 && x.period >= 2 && y.period >= 2 && Math.abs(x.period - y.period) <= 1;
  return { confident, periodX: x.period, periodY: y.period, phaseX: x.phase, phaseY: y.phase, scoreX: +x.score.toFixed(3), scoreY: +y.score.toFixed(3) };
}

export function subjectBounds(image, padding = 0) {
  assertImage(image);
  let left = image.width, top = image.height, right = -1, bottom = -1;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (image.data[(y * image.width + x) * 4 + 3] < 128) continue;
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < 0) return null;
  left = Math.max(0, left - padding); top = Math.max(0, top - padding);
  right = Math.min(image.width - 1, right + padding); bottom = Math.min(image.height - 1, bottom + padding);
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function cropImage(image, bounds) {
  assertImage(image);
  if (!bounds || bounds.width < 1 || bounds.height < 1 || bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > image.width || bounds.y + bounds.height > image.height) throw Error('Crop bounds are outside the image.');
  const data = new Uint8ClampedArray(bounds.width * bounds.height * 4);
  for (let y = 0; y < bounds.height; y++) {
    const src = ((bounds.y + y) * image.width + bounds.x) * 4;
    data.set(image.data.subarray(src, src + bounds.width * 4), y * bounds.width * 4);
  }
  return { width: bounds.width, height: bounds.height, data };
}

function histogram(image) {
  const entries = new Map();
  for (let p = 0, i = 0; p < image.width * image.height; p++, i += 4) {
    if (image.data[i + 3] < 128) continue;
    const key = image.data[i] << 16 | image.data[i + 1] << 8 | image.data[i + 2];
    const found = entries.get(key);
    if (found) found.count++;
    else entries.set(key, { key, count: 1, lab: srgbToLab(image.data[i], image.data[i + 1], image.data[i + 2]) });
  }
  return [...entries.values()];
}

function learnMedoids(entries, budget) {
  entries.sort((a, b) => b.count - a.count || a.key - b.key);
  if (entries.length <= budget) return entries.map(entry => entry.key);
  // Stop before spending the whole budget on shades closer than about ΔE 8.
  const minDistanceSquared = 64;
  const selected = [0];
  const distance = new Float64Array(entries.length).fill(Infinity);
  while (selected.length < budget) {
    const added = entries[selected[selected.length - 1]];
    let next = -1, best = -1;
    for (let i = 0; i < entries.length; i++) {
      distance[i] = Math.min(distance[i], labDistanceSquared(entries[i].lab, added.lab));
      const score = distance[i] * Math.sqrt(entries[i].count);
      if (score > best) { best = score; next = i; }
    }
    if (next < 0 || best <= 0 || distance[next] < minDistanceSquared) break;
    selected.push(next);
  }
  let palette = selected.map(index => entries[index]);
  for (let iteration = 0; iteration < 4; iteration++) {
    const groups = palette.map(() => []);
    for (const entry of entries) {
      let best = 0, bestDistance = Infinity;
      for (let i = 0; i < palette.length; i++) {
        const d = labDistanceSquared(entry.lab, palette[i].lab);
        if (d < bestDistance) { bestDistance = d; best = i; }
      }
      groups[best].push(entry);
    }
    palette = groups.map((group, i) => {
      if (!group.length) return palette[i];
      const mass = group.reduce((sum, entry) => sum + entry.count, 0);
      const mean = [0, 1, 2].map(channel => group.reduce((sum, entry) => sum + entry.lab[channel] * entry.count, 0) / mass);
      return group.reduce((a, b) => labDistanceSquared(a.lab, mean) <= labDistanceSquared(b.lab, mean) ? a : b);
    });
  }
  return [...new Map(palette.map(entry => [entry.key, entry.key])).values()];
}

function paintKeys(image, keys) {
  const labs = keys.map(key => ({ key, lab: srgbToLab(key >>> 16 & 255, key >>> 8 & 255, key & 255) }));
  const data = new Uint8ClampedArray(image.data);
  const used = new Set();
  for (let p = 0, i = 0; p < image.width * image.height; p++, i += 4) {
    if (data[i + 3] < 128) { data.fill(0, i, i + 4); continue; }
    data[i + 3] = 255;
    const lab = srgbToLab(data[i], data[i + 1], data[i + 2]);
    let best = labs[0], bestDistance = Infinity;
    for (const candidate of labs) {
      const d = labDistanceSquared(lab, candidate.lab);
      if (d < bestDistance) { bestDistance = d; best = candidate; }
    }
    data[i] = best.key >>> 16 & 255; data[i + 1] = best.key >>> 8 & 255; data[i + 2] = best.key & 255;
    used.add(best.key);
  }
  return { data, used };
}

/** Hard ceiling: every opaque pixel becomes a source medoid. No distance fallback. */
export function quantizeMedoids(image, budget) {
  assertImage(image);
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 256) throw Error('Palette budget must be an integer from 1 to 256.');
  const entries = histogram(image);
  const keys = learnMedoids(entries, budget);
  const painted = paintKeys(image, keys.length ? keys : [0]);
  return {
    image: { width: image.width, height: image.height, data: painted.data },
    diagnostics: { algorithm: 'lab-medoid-hard-palette-v1', paletteBudget: budget, sourceColors: entries.length, actualPaletteColors: painted.used.size, hardCeiling: true, distanceSpace: 'CIE-Lab-L-weight-1.25' },
  };
}

/** Snap every opaque pixel to a fixed palette. Luminance is weighted 1.25. */
export function lockPalette(image, colors) {
  assertImage(image);
  if (!Array.isArray(colors) || colors.length < 1 || colors.length > 256) throw Error('A shared palette needs 1 to 256 RGB colors.');
  const keys = colors.map(color => {
    if (!Array.isArray(color) || color.length < 3 || color.slice(0, 3).some(channel => !Number.isInteger(channel) || channel < 0 || channel > 255)) throw Error('Palette entries must be RGB triples.');
    return color[0] << 16 | color[1] << 8 | color[2];
  });
  const painted = paintKeys(image, [...new Set(keys)]);
  return {
    image: { width: image.width, height: image.height, data: painted.data },
    diagnostics: { algorithm: 'lab-shared-palette-lock-v1', paletteBudget: new Set(keys).size, actualPaletteColors: painted.used.size, hardCeiling: true, distanceSpace: 'CIE-Lab-L-weight-1.25', luminanceWeight: 1.25 },
  };
}

export function parsePalette(text) {
  if (typeof text !== 'string' || text.length > 256 * 1024) throw Error('Palette text is empty or larger than 256 KiB.');
  const lines = text.split(/\r?\n/);
  const gimp = lines.some(line => line.trim() === 'GIMP Palette');
  const colors = [];
  if (gimp) {
    for (const line of lines) {
      const match = line.match(/^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\b/);
      if (!match) continue;
      const rgb = match.slice(1, 4).map(Number);
      if (rgb.every(channel => channel <= 255)) colors.push(rgb);
    }
  } else {
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('//')) continue;
      const hex = trimmed.replace(/^#/, '');
      if (!/^[0-9a-fA-F]{6}$/.test(hex)) continue;
      colors.push([parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]);
    }
  }
  if (!colors.length) throw Error('Palette file has no RGB colors. Use .hex (#RRGGBB per line) or a GIMP .gpl palette.');
  if (colors.length > 256) throw Error('Shared palettes are limited to 256 colors.');
  return colors;
}

/**
 * One pass. A pixel joins a neighbor color when at least three orthogonal
 * neighbors already share it and that color is close. High-contrast singles stay.
 */
export function cleanupIsolated(image, maxDistance = 22) {
  assertImage(image);
  const { width, height, data: source } = image, data = new Uint8ClampedArray(source);
  let absorbed = 0;
  const at = (x, y) => (y * width + x) * 4;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = at(x, y);
    if (source[i + 3] < 128) continue;
    const votes = new Map();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = at(nx, ny);
      if (source[j + 3] < 128) continue;
      const key = source[j] << 16 | source[j + 1] << 8 | source[j + 2];
      votes.set(key, (votes.get(key) || 0) + 1);
    }
    let best = 0, count = 0;
    for (const [key, n] of votes) if (n > count) { count = n; best = key; }
    if (count < 3) continue;
    const r = best >>> 16, g = best >>> 8 & 255, b = best & 255;
    if (r === source[i] && g === source[i + 1] && b === source[i + 2]) continue;
    if (Math.max(Math.abs(r - source[i]), Math.abs(g - source[i + 1]), Math.abs(b - source[i + 2])) > maxDistance) continue;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; absorbed++;
  }
  return { image: { width, height, data }, diagnostics: { algorithm: 'isolated-neighbor-absorb-v1', absorbed, maxDistance, alphaPreserved: true, passes: 1 } };
}

/** Foreground pixels whose RGB still reads as magenta-family fringe. */
export function magentaFringeCount(image) {
  assertImage(image);
  let pink = 0, edge = 0, visible = 0;
  const { width, height, data } = image;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 128) continue;
    visible++;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (!(r - g > 40 && b - g > 30)) continue;
    pink++;
    let boundary = x === 0 || y === 0 || x === width - 1 || y === height - 1;
    if (!boundary) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (data[((y + dy) * width + x + dx) * 4 + 3] < 128) boundary = true;
    if (boundary) edge++;
  }
  return { visible, pink, pinkEdge: edge };
}
