import { StudioError } from "./image-types";

export const PIXEL_FITS = ["proportional", "contain", "cover", "stretch"] as const;
export const PIXEL_ANCHORS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] as const;
export type PixelFit = typeof PIXEL_FITS[number];
export type PixelAnchor = typeof PIXEL_ANCHORS[number];
export interface PixelLayout {
  fit: PixelFit;
  anchor: PixelAnchor;
  canvas: { width: number; height: number };
  content: { x: number; y: number; width: number; height: number };
  source: { x: number; y: number; width: number; height: number };
  /** Area removed from the original source, measured in original file pixels. */
  croppedPixels: number;
}

export function resolvePixelFit(parameters: Readonly<Record<string, unknown>>): PixelFit {
  if (parameters.fit === undefined) return parameters.keepAspect === false ? "stretch" : "proportional";
  if (typeof parameters.fit !== "string" || !PIXEL_FITS.includes(parameters.fit as PixelFit)) throw new StudioError("画布适配须为proportional、contain、cover或stretch");
  return parameters.fit as PixelFit;
}

export function resolvePixelAnchor(parameters: Readonly<Record<string, unknown>>): PixelAnchor {
  if (parameters.anchor === undefined) return "center";
  if (typeof parameters.anchor !== "string" || !PIXEL_ANCHORS.includes(parameters.anchor as PixelAnchor)) throw new StudioError("画布锚点无效，请选择九个标准位置之一");
  return parameters.anchor as PixelAnchor;
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number, label: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new StudioError(`${label}须为 ${minimum}–${maximum} 之间的整数`);
  return parsed;
}

function alignment(anchor: PixelAnchor): [number, number] {
  return [anchor.includes("left") ? 0 : anchor.includes("right") ? 1 : 0.5, anchor.startsWith("top") ? 0 : anchor.startsWith("bottom") ? 1 : 0.5];
}

/** Integer geometry only; never decodes, resizes, allocates images or reads files. */
export function planPixelLayout(sourceWidth: number, sourceHeight: number, parameters: Readonly<Record<string, unknown>>): PixelLayout {
  if (!Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight) || sourceWidth < 1 || sourceHeight < 1 || !Number.isSafeInteger(sourceWidth * sourceHeight)) throw new StudioError("原图尺寸须为有效的正整数");
  const fit = resolvePixelFit(parameters), requestedAnchor = resolvePixelAnchor(parameters);
  const anchor = fit === "contain" || fit === "cover" ? requestedAnchor : "center";
  const width = integer(parameters.cols, Math.min(256, sourceWidth), 1, 4096, "逻辑宽度");
  if ((fit === "proportional" || fit === "stretch") && width > sourceWidth) throw new StudioError("逻辑宽度不能超过原图；如需留边请使用contain");
  const proportionalHeight = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
  // Old keepAspect:false requests also defaulted rows proportionally. Preserve
  // that behavior only when fit itself is omitted; explicit stretch is a frame.
  const legacyStretch = parameters.fit === undefined && parameters.keepAspect === false;
  const rowDefault = fit === "proportional" || legacyStretch ? proportionalHeight : width;
  const rowMaximum = fit === "proportional" || fit === "stretch" ? Math.min(4096, sourceHeight) : 4096;
  const height = integer(parameters.rows, rowDefault, 1, rowMaximum, "逻辑高度");
  if (fit === "proportional" && height !== proportionalHeight) throw new StudioError(`保持比例时逻辑高度应为 ${proportionalHeight}，请调整宽度或关闭保持比例`);
  if (height > rowMaximum) throw new StudioError("逻辑高度超出原图或4096像素上限，请减小逻辑宽度或使用contain留边");
  if (width * height > 4_194_304) throw new StudioError("目标逻辑画布超过419万像素，请减少宽高");
  const scale = integer(parameters.scale, 1, 1, 8, "整数放大倍数");
  if (![1, 2, 4, 8].includes(scale)) throw new StudioError("严格像素模式仅支持1、2、4、8倍最近邻放大");
  if (width * height * scale * scale > 32_000_000) throw new StudioError("整数倍导出后超过3200万像素，请降低放大倍数");
  const canvas = { width, height }, source = { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  const content = { x: 0, y: 0, width, height }, [horizontal, vertical] = alignment(anchor);
  if (fit === "contain") {
    const ratio = Math.min(width / sourceWidth, height / sourceHeight, 1);
    content.width = Math.max(1, Math.min(width, sourceWidth, Math.round(sourceWidth * ratio)));
    content.height = Math.max(1, Math.min(height, sourceHeight, Math.round(sourceHeight * ratio)));
    content.x = Math.floor((width - content.width) * horizontal);
    content.y = Math.floor((height - content.height) * vertical);
  } else if (fit === "cover") {
    // Use the largest full-height/full-width crop. Rounding the other dimension
    // approximates the requested ratio within half a source pixel, rather than
    // discarding large areas to force an exact GCD-based integer ratio.
    if (sourceWidth * height > sourceHeight * width) source.width = Math.max(1, Math.min(sourceWidth, Math.round(sourceHeight * width / height)));
    else source.height = Math.max(1, Math.min(sourceHeight, Math.round(sourceWidth * height / width)));
    if (source.width < width || source.height < height) throw new StudioError("覆盖填充需要放大原图；请减小画布或使用contain留边");
    source.x = Math.floor((sourceWidth - source.width) * horizontal);
    source.y = Math.floor((sourceHeight - source.height) * vertical);
  }
  return { fit, anchor, canvas, content, source, croppedPixels: sourceWidth * sourceHeight - source.width * source.height };
}
