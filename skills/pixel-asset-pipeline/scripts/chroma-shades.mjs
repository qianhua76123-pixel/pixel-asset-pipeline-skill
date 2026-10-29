/** Remove the selected chromatic backing's shaded color family, including holes. */
const HUE_TOLERANCE = 22;
const MIN_CHROMA = 24;
const MIN_VALUE = 40;
const MIN_SATURATION = 0.45;

function hsv(r, g, b) {
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

export function removeChromaShades(image, keyColor) {
  if (!image || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width <= 0 || image.height <= 0 || image.data?.length !== image.width * image.height * 4) throw Error('Expected an RGBA image with valid dimensions.');
  if (typeof keyColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(keyColor)) throw Error('Expected a #RRGGBB chroma key.');
  const key = [1, 3, 5].map(offset => parseInt(keyColor.slice(offset, offset + 2), 16));
  const reference = hsv(...key), data = new Uint8ClampedArray(image.data);
  const enabled = reference.chroma >= 48 && reference.saturation >= MIN_SATURATION;
  let removedPixels = 0, normalizedAlphaPixels = 0, normalizedTransparentPixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) {
      if (data[i] || data[i + 1] || data[i + 2] || data[i + 3]) normalizedTransparentPixels++;
      data.fill(0, i, i + 4);
      continue;
    }
    if (data[i + 3] !== 255) { data[i + 3] = 255; normalizedAlphaPixels++; }
    if (!enabled) continue;
    const candidate = hsv(data[i], data[i + 1], data[i + 2]);
    if (candidate.chroma >= MIN_CHROMA && candidate.value >= MIN_VALUE && candidate.saturation >= MIN_SATURATION && hueDistance(candidate.hue, reference.hue) <= HUE_TOLERANCE) {
      data.fill(0, i, i + 4);
      removedPixels++;
    }
  }
  return {
    image: { ...image, data },
    diagnostics: {
      algorithm: 'global-key-hue-shades-v1', keyColor: keyColor.toLowerCase(),
      skipped: !enabled,
      ...(enabled ? {} : { skipReason: 'Neutral or low-saturation keys do not define a safe hue family.' }),
      keyHue: reference.hue, hueToleranceDegrees: HUE_TOLERANCE,
      minimumChroma: MIN_CHROMA, minimumValue: MIN_VALUE, minimumSaturation: MIN_SATURATION,
      scope: 'complete-input-raster-including-enclosed-holes', removedPixels,
      normalizedAlphaPixels, normalizedTransparentPixels, retainedRgbUnchanged: true,
      warning: 'This is explicit chroma-key classification, not semantic recognition. Legitimate foreground in the selected key hue family can also be removed. Dark/neutral fringes below the thresholds are deliberately retained; inspect silhouettes and thin structures.',
    },
  };
}
