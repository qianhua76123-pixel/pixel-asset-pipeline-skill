import { StudioError } from "./image-types";

export interface BorderKeyShadeImage { width: number; height: number; data: Uint8ClampedArray }
export interface BorderKeyShadeDiagnostics {
  algorithm: "border-connected-key-shades-v1";
  keyColor: string;
  connectivity: 4;
  cosineThreshold: number;
  minimumChannelRange: number;
  minimumMaximumChannel: number;
  removedCount: number;
  /** Reachable cells, including canonical RGBA0 transparency used as a path. */
  visited: number;
  /** Unique tested cells, including nonmatching barriers next to a path. */
  examinedCount: number;
  warnings: string[];
}

const MAX_PIXELS = 16_777_216, COSINE = .985, MIN_RANGE = 48, MIN_MAXIMUM = 64;

/**
 * Opt-in color rule, not semantic segmentation. Only four-neighbor paths from
 * the canvas border may erase a sufficiently saturated, key-directed color.
 * Nonmatching RGBA is copied byte-for-byte, including partial alpha.
 */
export function removeBorderKeyShades(image: BorderKeyShadeImage, keyColor: string): { image: BorderKeyShadeImage; diagnostics: BorderKeyShadeDiagnostics } {
  if (!image || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > MAX_PIXELS || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) throw new StudioError("边界色键变化清理需要1677万像素以内的有效RGBA图像");
  if (typeof keyColor !== "string" || !/^#[a-f\d]{6}$/i.test(keyColor)) throw new StudioError("边界色键变化清理需要六位十六进制背景色");
  const key = [1, 3, 5].map(offset => parseInt(keyColor.slice(offset, offset + 2), 16));
  if (Math.max(...key) - Math.min(...key) < MIN_RANGE) throw new StudioError("边界色键变化清理只支持通道差至少48的强彩色背景；白色、灰色或低彩度背景请使用其他方式");
  const mean = (key[0] + key[1] + key[2]) / 3, centered = key.map(c => c - mean);
  const keyNorm = Math.hypot(...centered);
  const { width: w, height: h, data } = image, size = w * h;
  // One queue entry per accepted pixel and one classification per tested pixel.
  // State: 0 unseen; 1 barrier; 2 canonical transparent path; 3 key-colored path.
  const state = new Uint8Array(size), queue = new Int32Array(size), output = data.slice();
  let tail = 0, examinedCount = 0, removedCount = 0;
  function enqueue(p: number): void {
    if (state[p]) return;
    examinedCount++;
    const i = p * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    state[p] = 1;
    if (!data[i + 3]) {
      if (!r && !g && !b) { state[p] = 2; queue[tail++] = p; }
      return;
    }
    const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b);
    if (maximum < MIN_MAXIMUM || maximum - minimum < MIN_RANGE) return;
    const average = (r + g + b) / 3, red = r - average, green = g - average, blue = b - average;
    const cosine = (red * centered[0] + green * centered[1] + blue * centered[2]) / (Math.hypot(red, green, blue) * keyNorm);
    if (cosine >= COSINE) { state[p] = 3; queue[tail++] = p; }
  }
  for (let x = 0; x < w; x++) { enqueue(x); if (h > 1) enqueue((h - 1) * w + x); }
  for (let y = 1; y + 1 < h; y++) { enqueue(y * w); if (w > 1) enqueue(y * w + w - 1); }
  for (let head = 0; head < tail; head++) {
    const p = queue[head], x = p % w, y = Math.floor(p / w);
    if (state[p] === 3) { output.fill(0, p * 4, p * 4 + 4); removedCount++; }
    if (x) enqueue(p - 1);
    if (x + 1 < w) enqueue(p + 1);
    if (y) enqueue(p - w);
    if (y + 1 < h) enqueue(p + w);
  }
  return {
    image: { width: w, height: h, data: output },
    diagnostics: {
      algorithm: "border-connected-key-shades-v1", keyColor: keyColor.toUpperCase(), connectivity: 4,
      cosineThreshold: COSINE, minimumChannelRange: MIN_RANGE, minimumMaximumChannel: MIN_MAXIMUM,
      removedCount, visited: tail, examinedCount,
      warnings: [
        "仅删除与画布四边经四邻域连通、色度方向接近指定强彩色色键的像素；不做模糊或全图换色。",
        "真实粉色等同色前景若与背景直接连通也可能被删除；封闭的背景残色、低彩度浅边和近黑残色可能保留，请放大检查。",
      ],
    },
  };
}
