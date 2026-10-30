#!/usr/bin/env node
/** Portable, bounded local pixel workflow. No network calls or generation. */
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { strictGrid, refineBackgroundColors, refineImageDetails, refineAdaptiveColors, refineOuterContour, removeBorderKeyShades, planPixelLayout } from './runtime/vendor/index.mjs';
import { removeKeyFringe, despillEdges, sampleCoverage, gridCuts, snappedCuts, detectPixelGrid, subjectBounds, cropImage, quantizeMedoids, lockPalette, parsePalette, cleanupIsolated } from './pixel_prepare.mjs';

const VERSION = '0.3.0', WORKFLOW = 'portable-pixel-fixed', RECIPE_VERSION = 3;
const STAGES = ['background', 'grid', 'source-colors', 'material-detail', 'color-clusters', 'outer-contour', 'export'];
const MAX_INPUT_PIXELS = 16_777_216, MAX_NATIVE_PIXELS = 1_048_576;
const sha = value => createHash('sha256').update(value).digest('hex');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validKey = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const rgbKey = image => {
  const keys = new Set();
  for (let i = 0; i < image.data.length; i += 4) if (image.data[i + 3]) keys.add(image.data[i] << 16 | image.data[i + 1] << 8 | image.data[i + 2]);
  return keys;
};
function assertNative(image) {
  if (image.width * image.height > MAX_NATIVE_PIXELS) throw Error('Native output is limited to 1,048,576 pixels. Choose a smaller explicit --size.');
  for (let i = 0; i < image.data.length; i += 4) if (![0, 255].includes(image.data[i + 3]) || !image.data[i + 3] && (image.data[i] || image.data[i + 1] || image.data[i + 2])) throw Error('Native image must have binary alpha and zero RGB in transparent pixels.');
}
function canonical(image) {
  const data = new Uint8ClampedArray(image.data);
  for (let i = 0; i < data.length; i += 4) { data[i + 3] = data[i + 3] >= 128 ? 255 : 0; if (!data[i + 3]) data[i] = data[i + 1] = data[i + 2] = 0; }
  return { ...image, data };
}
async function png(image) { return sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 4 } }).png().toBuffer(); }
export function statistics(image) {
  let visible = 0, partialAlpha = 0, hiddenRgb = 0, left = image.width, top = image.height, right = -1, bottom = -1;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const i = (y * image.width + x) * 4, a = image.data[i + 3];
    if (a > 0 && a < 255) partialAlpha++;
    if (!a && (image.data[i] || image.data[i + 1] || image.data[i + 2])) hiddenRgb++;
    if (a >= 128) { visible++; left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  }
  return { width: image.width, height: image.height, visiblePixels: visible, visibleColors: rgbKey(image).size, partialAlphaPixels: partialAlpha, hiddenRgbPixels: hiddenRgb, bbox: visible ? [left, top, right, bottom] : null };
}
async function decodeFile(filename) {
  const bytes = await fs.readFile(filename);
  if (bytes.length > 40 * 1024 * 1024) throw Error('Input PNG exceeds 40 MiB.');
  const metadata = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, animated: false }).metadata();
  if (metadata.format !== 'png' || (metadata.pages ?? 1) !== 1) throw Error('Standalone input must be a single PNG. Convert other formats explicitly before calling this workflow.');
  const decoded = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, animated: false }).rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { bytes, image: { width: decoded.info.width, height: decoded.info.height, data: new Uint8ClampedArray(decoded.data) } };
}
function borderEvidence(image) {
  const positions = [], sides = [[], [], [], []], counts = new Map();
  for (let x = 0; x < image.width; x++) { sides[0].push(x); sides[1].push((image.height - 1) * image.width + x); }
  for (let y = 0; y < image.height; y++) { sides[2].push(y * image.width); sides[3].push(y * image.width + image.width - 1); }
  for (const side of sides) positions.push(...side);
  let transparent = 0;
  for (const p of positions) { const i = p * 4; if (image.data[i + 3] < 128) transparent++; else { const key = image.data[i] << 16 | image.data[i + 1] << 8 | image.data[i + 2]; counts.set(key, (counts.get(key) || 0) + 1); } }
  let dominant = 0, count = -1;
  for (const [key, n] of counts) if (n > count) { dominant = key; count = n; }
  const color = [dominant >>> 16, dominant >>> 8 & 255, dominant & 255];
  const matches = p => { const i = p * 4; return image.data[i + 3] >= 128 && color.every((c, k) => Math.abs(c - image.data[i + k]) <= 24); };
  return { transparentRatio: transparent / positions.length, keyColor: '#' + dominant.toString(16).padStart(6, '0'), chromatic: Math.max(...color) - Math.min(...color) >= 48, keyRatio: positions.filter(matches).length / positions.length, sideRatios: sides.map(side => side.filter(matches).length / side.length) };
}
function dimensions(image, options) {
  if (options.native) return { width: image.width, height: image.height };
  if (options.size && /^\d+x\d+$/.test(options.size)) {
    const [width, height] = options.size.split('x').map(Number);
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 1024)) throw Error('--size WxH must use dimensions between 1 and 1024.');
    return { width, height };
  }
  const maximum = Number(options.size ?? 256);
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1024) throw Error('--size must be an integer from 1 to 1024, or WIDTHxHEIGHT.');
  const ratio = Math.min(1, maximum / Math.max(image.width, image.height));
  return { width: Math.max(1, Math.round(image.width * ratio)), height: Math.max(1, Math.round(image.height * ratio)) };
}
function chooseBackground(image, options) {
  const mode = options.background ?? 'auto', proof = borderEvidence(image);
  if (!['auto', 'keep', 'chroma'].includes(mode)) throw Error('--background must be auto, keep, or chroma.');
  if (mode === 'chroma') {
    if (!validKey(options.key)) throw Error('--background chroma requires an explicit --key #RRGGBB.');
    return { method: 'chroma', keyColor: options.key.toLowerCase(), proof, explicit: true };
  }
  if (mode === 'keep') return { method: 'keep', proof, explicit: true };
  const hasTransparency = image.data.some((value, i) => i % 4 === 3 && value < 255);
  if (hasTransparency) {
    if (proof.transparentRatio < .9) throw Error('Only part of the border is transparent. Confirm --background keep explicitly, or use the Pixel Studio adapter for semantic background removal.');
    return { method: 'keep', proof, explicit: false };
  }
  if (rgbKey(image).size < 2) throw Error('The image contains no separable subject; its visible color is uniform.');
  if (proof.chromatic && proof.keyRatio >= .9 && proof.sideRatios.every(n => n >= .85)) return { method: 'chroma', keyColor: proof.keyColor, proof, explicit: false };
  throw Error('This opaque background cannot be safely color-keyed. Standalone mode does not contain semantic models. Use the Pixel Studio adapter with a ready BiRefNet model, supply a transparent PNG, or explicitly choose a known chroma key.');
}
function colorKey(image, color) {
  const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)), data = new Uint8ClampedArray(image.data);
  let directlyRemoved = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] && channels.every((channel, k) => Math.abs(data[i + k] - channel) <= 24)) { data.fill(0, i, i + 4); directlyRemoved++; }
  let result = canonical({ ...image, data }), shaded;
  if (Math.max(...channels) - Math.min(...channels) >= 48) { shaded = removeBorderKeyShades(result, color); result = shaded.image; }
  return { image: result, diagnostics: { algorithm: 'global-chroma-key', keyColor: color, tolerance: 24, toleranceMetric: 'per-channel-absolute', includeShades: false, directlyRemovedPixels: directlyRemoved, ...(shaded ? { borderShades: shaded.diagnostics } : {}), warning: 'Same-colored foreground may also be removed. Inspect original and result.' } };
}
async function readSidecar(filename, inputHash, image) {
  const sidecarPath = filename + '.pixel.json';
  let text;
  try { const stat = await fs.stat(sidecarPath); if (stat.size > 128 * 1024) return { status: 'invalid', reason: 'Sidecar exceeds 128 KiB.' }; text = await fs.readFile(sidecarPath, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return { status: 'absent' }; throw error; }
  let value; try { value = JSON.parse(text); } catch { return { status: 'invalid', reason: 'Malformed sidecar JSON.' }; }
  const algorithms = { background: ['global-chroma-key', 'chroma-fringe-v1'], grid: ['fixed-grid-source-center-v2', 'fixed-grid-palette-first-majority-v1', 'explicit-native-hard-alpha-v1', 'coverage-dominant-grid-v1'], 'source-colors': ['source-cell-local-background-color-v1', 'global-key-hue-shades-v1'], 'material-detail': ['explicit-material-local-color-v1', 'frozen-warm-material-inner-outline-v1'], 'color-clusters': ['source-medoids-edge-potts-v1', 'lab-medoid-hard-palette-v1', 'lab-shared-palette-lock-v1'], 'outer-contour': ['bounded-bamboo-joint-rhythm-v2'], export: ['native-png-export-v1'] };
  const recipe = value?.recipe, version = value?.version;
  const legacyRecipe = version < 3 && ['center', 'majority'].includes(recipe?.sampler) && recipe?.phaseX === 0 && recipe?.phaseY === 0 && [64, 96].includes(recipe?.paletteBudget);
  const currentRecipe = version === 3 && ['center', 'majority', 'coverage'].includes(recipe?.sampler) && Number.isSafeInteger(recipe?.phaseX) && Number.isSafeInteger(recipe?.phaseY) && Number.isSafeInteger(recipe?.paletteBudget) && recipe.paletteBudget >= 1 && recipe.paletteBudget <= 256 && ['fringe', 'classic'].includes(recipe.keyer) && ['off', 'auto'].includes(recipe.grid) && typeof recipe.crop === 'boolean' && typeof recipe.cleanup === 'boolean' && Number.isSafeInteger(recipe.padding) && recipe.padding >= 0 && recipe.padding <= 64 && (recipe.paletteFile === null || validHash(recipe.paletteFile));
  const valid = value?.producer === WORKFLOW && [1, 2, RECIPE_VERSION].includes(version) && value.completed === true && validHash(value.sourceSha256) && value.outputSha256 === inputHash && value.width === image.width && value.height === image.height && recipe?.id === WORKFLOW && recipe.version === version && (version === 1 || recipe.cleanKeyShades === false) && recipe.width === image.width && recipe.height === image.height && recipe.alphaThreshold === 128 && recipe.exportScale === 1 && ['keep', 'chroma'].includes(recipe.background) && (recipe.background !== 'chroma' || validKey(recipe.keyColor)) && ['generic', 'foliage', 'bamboo', 'glass'].includes(recipe.material) && (legacyRecipe || currentRecipe) && Array.isArray(value.stageProofs) && value.stageProofs.length === STAGES.length && value.stageProofs.every((stage, i) => stage && stage.id === STAGES[i] && ['run', 'skip'].includes(stage.status) && (stage.status === 'skip' ? typeof stage.reason === 'string' && stage.reason.length > 0 : algorithms[stage.id].includes(stage.algorithm))) && [1, 4, 6].every(i => value.stageProofs[i].status === 'run') && (recipe.material === 'generic' ? value.stageProofs[3].status === 'skip' : value.stageProofs[3].status === 'run') && (recipe.material === 'bamboo' ? value.stageProofs[5].status === 'run' : value.stageProofs[5].status === 'skip');
  if (!valid) return { status: 'invalid', reason: 'Output hash, dimensions, recipe, stage IDs, or algorithm proofs do not match.' };
  const expectedGrid = recipe.native ? 'explicit-native-hard-alpha-v1' : recipe.sampler === 'coverage' ? 'coverage-dominant-grid-v1' : recipe.sampler === 'center' ? 'fixed-grid-source-center-v2' : 'fixed-grid-palette-first-majority-v1';
  if (value.stageProofs[1].algorithm !== expectedGrid) return { status: 'invalid', reason: 'Grid sampling recipe and algorithm proof differ.' };
  try { assertNative(image); } catch (error) { return { status: 'invalid', reason: error.message }; }
  return { status: 'matched', value };
}
export async function inspectFile(filename) {
  const input = path.resolve(filename), decoded = await decodeFile(input), hash = sha(decoded.bytes), sidecar = await readSidecar(input, hash, decoded.image);
  return { input, sha256: hash, ...statistics(decoded.image), border: borderEvidence(decoded.image), verifiedCompletion: sidecar.status === 'matched', sidecarStatus: sidecar.status, ...(sidecar.reason ? { sidecarReason: sidecar.reason } : {}) };
}
function pipelineChoices(options) {
  const keyer = options.keyer ?? 'fringe', sampler = options.sampler ?? 'coverage', grid = options.grid ?? 'off';
  if (!['fringe', 'classic'].includes(keyer)) throw Error('--keyer must be fringe or classic.');
  if (!['coverage', 'center', 'majority'].includes(sampler)) throw Error('--sampler must be coverage, center, or majority.');
  if (!['off', 'auto'].includes(grid)) throw Error('--grid must be off or auto.');
  if (options.cleanup !== undefined && !['on', 'off'].includes(options.cleanup)) throw Error('--cleanup must be on or off.');
  if (options.padding !== undefined && options.crop !== true) throw Error('--padding requires --crop.');
  const padding = Number(options.padding ?? 0);
  if (!Number.isSafeInteger(padding) || padding < 0 || padding > 64) throw Error('--padding must be an integer from 0 to 64.');
  const cleanup = options.cleanup === undefined ? keyer !== 'classic' : options.cleanup === 'on';
  return { keyer, sampler, grid, crop: options.crop === true, padding, cleanup };
}
export async function runPipeline(options) {
  if (!options.input || !options['output-dir']) throw Error('run requires --input PNG and --output-dir NEW_DIRECTORY.');
  if (options.native && options.size) throw Error('Choose --native or --size; their meanings are different.');
  if (options.key && (options.background ?? 'auto') !== 'chroma') throw Error('--key requires --background chroma; auto mode uses measured evidence.');
  const choices = pipelineChoices(options);
  const input = path.resolve(options.input), outdir = path.resolve(options['output-dir']);
  try { await fs.lstat(outdir); throw Error('Output directory already exists. Choose a new directory; input and prior results are never overwritten.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const decoded = await decodeFile(input), originalHash = sha(decoded.bytes), original = decoded.image, before = statistics(original);
  if (!before.visiblePixels) throw Error('Input has no visible subject.');
  const material = options.material ?? 'generic';
  let budget = Number(options.palette ?? 24), paletteColors = null, paletteFile = null;
  if (!['generic', 'foliage', 'bamboo', 'glass'].includes(material)) throw Error('--material must be generic, foliage, bamboo, or glass.');
  if (!Number.isSafeInteger(budget) || budget < 8 || budget > 256) throw Error('--palette must be an integer from 8 to 256.');
  if (options['palette-file']) {
    const text = await fs.readFile(path.resolve(options['palette-file']), 'utf8');
    paletteColors = parsePalette(text); paletteFile = sha(Buffer.from(text)); budget = paletteColors.length;
  }
  const sidecar = await readSidecar(input, originalHash, original);
  if (sidecar.status === 'invalid') throw Error('Existing completion sidecar is invalid: ' + sidecar.reason + ' Use the frozen original input, or resolve that provenance record explicitly.');
  let image, recipe, stages, repeated = false;
  if (sidecar.status === 'matched') {
    const prior = sidecar.value.recipe, target = dimensions(original, options);
    const explicitChange = options.material !== undefined && options.material !== prior.material || options.palette !== undefined && Number(options.palette) !== prior.paletteBudget || options['palette-file'] !== undefined || options.size !== undefined && (target.width !== original.width || target.height !== original.height) || options.background !== undefined && options.background !== 'auto' && options.background !== 'keep' || options.sampler !== undefined && options.sampler !== prior.sampler || options.keyer !== undefined && options.keyer !== prior.keyer || options.crop === true && prior.crop !== true || options.grid !== undefined && options.grid !== prior.grid || options.cleanup !== undefined && choices.cleanup !== prior.cleanup || options.padding !== undefined && choices.padding !== prior.padding;
    if (explicitChange) throw Error('This PNG is a verified finished output. Change settings by rerunning its frozen original source, not by feeding a refined result back through inference.');
    repeated = true; image = original; recipe = prior;
    stages = STAGES.map(id => id === 'export' ? { id, status: 'run', algorithm: 'native-png-export-v1', reason: 'Copy the verified completed native PNG.' } : { id, status: 'skip', reason: 'Verified matching output SHA and complete sidecar; preserve finished pixels.' });
  } else {
    const background = chooseBackground(original, options);
    stages = [];
    let keyed, registeredSource = null, unmatted = original;
    if (background.method === 'chroma' && choices.keyer === 'classic') {
      const result = colorKey(original, background.keyColor); keyed = result.image; registeredSource = keyed;
      stages.push({ id: 'background', status: 'run', algorithm: result.diagnostics.algorithm, diagnostics: { ...result.diagnostics, evidence: background.proof, explicitlySelected: background.explicit } });
    } else if (background.method === 'chroma') {
      const result = removeKeyFringe(original, background.keyColor); keyed = result.image; registeredSource = keyed;
      stages.push({ id: 'background', status: 'run', algorithm: result.diagnostics.algorithm, diagnostics: { ...result.diagnostics, evidence: background.proof, explicitlySelected: background.explicit } });
    } else { keyed = canonical(original); stages.push({ id: 'background', status: 'skip', reason: 'Keep existing alpha/background; hard-alpha normalization occurs in the grid stage.' }); }
    if (choices.crop) {
      const bounds = subjectBounds(keyed, choices.padding);
      if (!bounds) throw Error('Crop found no visible subject after background removal.');
      keyed = cropImage(keyed, bounds); unmatted = cropImage(original, bounds); if (registeredSource) registeredSource = keyed;
    }
    const target = options.native ? { width: keyed.width, height: keyed.height } : dimensions(keyed, options);
    if (target.width * target.height > MAX_NATIVE_PIXELS) throw Error('Native output exceeds 1,048,576 pixels.');
    let phaseX = 0, phaseY = 0, gridEvidence = null;
    if (options.native) {
      image = canonical(keyed); assertNative(image);
      stages.push({ id: 'grid', status: 'run', algorithm: 'explicit-native-hard-alpha-v1', diagnostics: { width: image.width, height: image.height, alphaThreshold: 128, automaticGridDetection: false, resampling: false } });
    } else if (choices.sampler === 'coverage') {
      const detected = choices.grid === 'auto' ? detectPixelGrid(keyed) : { confident: false, periodX: 0, periodY: 0, phaseX: 0, phaseY: 0, scoreX: 0, scoreY: 0 };
      const layout = planPixelLayout(keyed.width, keyed.height, { fit: 'contain', anchor: 'center', cols: target.width, rows: target.height, scale: 1 });
      if (detected.confident) { phaseX = detected.phaseX; phaseY = detected.phaseY; }
      const colCuts = detected.confident ? snappedCuts(keyed.width, layout.content.width, detected.periodX, detected.phaseX) : gridCuts(keyed.width, layout.content.width, 0);
      const rowCuts = detected.confident ? snappedCuts(keyed.height, layout.content.height, detected.periodY, detected.phaseY) : gridCuts(keyed.height, layout.content.height, 0);
      const sampled = sampleCoverage(keyed, target.width, target.height, { cols: layout.content.width, rows: layout.content.height, colCuts, rowCuts, contentX: layout.content.x, contentY: layout.content.y });
      image = sampled.image;
      if (registeredSource) gridEvidence = { colCuts, rowCuts, contentX: layout.content.x, contentY: layout.content.y, alphaThreshold: 128, paletteMappingPreserved: true };
      stages.push({ id: 'grid', status: 'run', algorithm: 'coverage-dominant-grid-v1', diagnostics: { algorithm: 'coverage-dominant-grid-v1', ...sampled.diagnostics, sourceWidth: keyed.width, sourceHeight: keyed.height, width: target.width, height: target.height, fit: 'contain', anchor: 'center', contentX: layout.content.x, contentY: layout.content.y, contentWidth: layout.content.width, contentHeight: layout.content.height, colCuts, rowCuts, alphaThreshold: 128, phaseX, phaseY, sampler: 'coverage', gridDetection: detected, quantization: 'after-downsample', interpolation: 'none' } });
    } else {
      const result = await strictGrid(keyed, target.width, target.height, { sampler: choices.sampler }); image = result.image; gridEvidence = result.evidence;
      stages.push({ id: 'grid', status: 'run', algorithm: result.diagnostics.algorithm, diagnostics: result.diagnostics });
    }
    image = canonical(image); assertNative(image);
    if (!statistics(image).visiblePixels) throw Error('Background removal left no visible subject.');
    if (rgbKey(image).size > 8192) {
      if (options.native) throw Error('Native image has more than 8192 visible colors. Use an explicit strict-grid size instead of --native.');
      image = quantizeMedoids(image, Math.min(256, budget)).image; gridEvidence = null;
    }
    recipe = { id: WORKFLOW, version: RECIPE_VERSION, width: target.width, height: target.height, native: options.native === true, background: background.method, ...(background.keyColor ? { keyColor: background.keyColor } : {}), material, paletteBudget: budget, paletteFile, sampler: choices.sampler, keyer: choices.keyer, grid: choices.grid, crop: choices.crop, padding: choices.padding, cleanup: choices.cleanup, alphaThreshold: 128, phaseX, phaseY, exportScale: 1, cleanKeyShades: false };
    const residualKeyShades = { skipped: true, skipReason: 'disabled-by-default', policy: 'preserve-unresolved-v1', removedPixels: 0 };
    if (registeredSource && gridEvidence && background.keyColor) {
      const result = refineBackgroundColors(image, { ...gridEvidence, sourceRGBA: registeredSource, unmattedSourceRGBA: unmatted, keyColor: background.keyColor });
      // Evidence repair stays RGB-only. Fringe removal already happened; this pass
      // does not start a second hue erase.
      image = result.image; stages.push({ id: 'source-colors', status: result.diagnostics.skipped ? 'skip' : 'run', ...(result.diagnostics.skipped ? { reason: result.diagnostics.skipReason || 'No verified source color evidence.' } : { algorithm: result.diagnostics.algorithm }), diagnostics: { ...result.diagnostics, residualKeyShades } });
    } else stages.push({ id: 'source-colors', status: 'skip', reason: 'No registered before/after key-removal raster and strict-grid source cells; do not infer missing original colors.', diagnostics: { residualKeyShades } });
    if (material !== 'generic') { const result = refineImageDetails(image, { profile: material }); image = result.image; stages.push({ id: 'material-detail', status: 'run', algorithm: result.diagnostics.algorithm, diagnostics: result.diagnostics }); }
    else stages.push({ id: 'material-detail', status: 'skip', reason: 'No explicit material selected; do not guess semantics.' });
    let despill = null;
    if (background.keyColor && choices.keyer === 'fringe') { const result = despillEdges(image, background.keyColor, 2); image = result.image; despill = result.diagnostics; }
    const clustered = paletteColors ? lockPalette(image, paletteColors) : choices.keyer === 'classic' && [40, 64, 96].includes(budget) ? refineAdaptiveColors(image, { paletteBudget: budget }) : quantizeMedoids(image, budget);
    image = clustered.image;
    if (background.keyColor && choices.keyer === 'fringe') { const again = despillEdges(image, background.keyColor, 2); image = again.image; if (despill) despill = { ...despill, recolored: despill.recolored + again.diagnostics.recolored, afterPalette: again.diagnostics.recolored }; }
    let isolated = null;
    if (choices.cleanup) { const result = cleanupIsolated(image); image = result.image; isolated = result.diagnostics; }
    stages.push({ id: 'color-clusters', status: 'run', algorithm: clustered.diagnostics.algorithm, diagnostics: { ...clustered.diagnostics, ...(despill ? { despill } : {}), ...(isolated ? { isolated } : {}) } });
    if (material === 'bamboo') { const result = refineOuterContour(image, { profile: 'bamboo' }); image = result.image; stages.push({ id: 'outer-contour', status: 'run', algorithm: result.diagnostics.algorithm, diagnostics: result.diagnostics }); }
    else stages.push({ id: 'outer-contour', status: 'skip', reason: 'Only explicitly selected bamboo uses one bounded outer-contour pass.' });
    image = canonical(image); assertNative(image); stages.push({ id: 'export', status: 'run', algorithm: 'native-png-export-v1', diagnostics: { width: image.width, height: image.height, scale: 1, interpolation: 'none' } });
  }
  const output = repeated ? decoded.bytes : await png(image), outputHash = sha(output), final = statistics(image);
  assertNative(image);
  const manifest = { producer: WORKFLOW, version: recipe.version, packageVersion: VERSION, sourceSha256: repeated ? sidecar.value.sourceSha256 : originalHash, inputSha256: originalHash, outputSha256: outputHash, recipe, repeatedCompletedInput: repeated, qualityStatus: 'candidate-needs-visual-review', stages, output: { file: 'sprite.png', ...final }, warnings: ['Hard pixels and successful export do not establish artistic quality, accurate materials, or correct missing details.', 'Changing palette, size, material, background, sampler or crop should start from the frozen original source.', 'Fringe removal deletes border-connected key-hue pixels. A solid interior blob of that hue can remain; a subject painted only in the key color cannot be separated from the backing.'], limitations: { semanticBackgroundRemoval: false, automaticGridRecovery: recipe.grid === 'auto', imageGeneration: false, terrainAtlasValidation: false } };
  const proof = { producer: WORKFLOW, version: recipe.version, completed: true, sourceSha256: manifest.sourceSha256, outputSha256: outputHash, width: image.width, height: image.height, recipe, stageProofs: (repeated ? sidecar.value.stageProofs : stages.map(stage => ({ id: stage.id, status: stage.status, ...(stage.algorithm ? { algorithm: stage.algorithm } : { reason: stage.reason }) }))) };
  await fs.mkdir(path.dirname(outdir), { recursive: true }); await fs.mkdir(outdir);
  try {
    await fs.writeFile(path.join(outdir, 'sprite.png'), output, { flag: 'wx' });
    await fs.writeFile(path.join(outdir, 'sprite.png.pixel.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
    await fs.writeFile(path.join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  } catch (error) { throw Error('Could not write complete output bundle: ' + error.message + '. Preserve input and choose another output directory; do not treat partial files as success.'); }
  return { ok: true, command: 'run', input, outputDirectory: outdir, output: path.join(outdir, 'sprite.png'), sidecar: path.join(outdir, 'sprite.png.pixel.json'), manifest: path.join(outdir, 'manifest.json'), ...final, repeatedCompletedInput: repeated, stages: stages.map(stage => ({ id: stage.id, status: stage.status, ...(stage.algorithm ? { algorithm: stage.algorithm } : { reason: stage.reason }) })), qualityStatus: manifest.qualityStatus };
}
function argumentsFor(argv) {
  const suppliedCommand = argv.shift() || 'help', command = ['--help', '-h'].includes(suppliedCommand) ? 'help' : suppliedCommand, options = {}, allowed = new Set(['input', 'output-dir', 'size', 'material', 'background', 'key', 'palette', 'palette-file', 'native', 'crop', 'padding', 'sampler', 'keyer', 'grid', 'cleanup']);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]; if (!flag.startsWith('--') || !allowed.has(flag.slice(2))) throw Error('Unknown argument: ' + flag);
    const key = flag.slice(2); if (Object.hasOwn(options, key)) throw Error('Duplicate argument: ' + flag);
    if (key === 'native' || key === 'crop') options[key] = true;
    else { const value = argv[++i]; if (!value || value.startsWith('--')) throw Error('Missing value for ' + flag); options[key] = value; }
  }
  return { command, options };
}
async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Node.js 22 or newer is required.');
  const { command, options } = argumentsFor(process.argv.slice(2));
  if (command === 'help') return { ok: true, commands: { doctor: 'Check the portable runtime; no network or writes.', inspect: '--input PNG', run: '--input PNG --output-dir NEW_DIRECTORY [--size N|WxH | --native] [--crop] [--padding N] [--background auto|keep|chroma] [--key #RRGGBB] [--keyer fringe|classic] [--sampler coverage|center|majority] [--grid off|auto] [--cleanup on|off] [--material generic|foliage|bamboo|glass] [--palette 8..256] [--palette-file .hex|.gpl]' }, defaults: { longestEdge: 256, material: 'generic', palette: 24, background: 'auto', keyer: 'fringe', sampler: 'coverage', grid: 'off', cleanup: 'on', crop: false }, outputFiles: ['sprite.png', 'sprite.png.pixel.json', 'manifest.json'] };
  if (command === 'doctor') { if (Object.keys(options).length) throw Error('doctor takes no options.'); return { ok: true, command, packageVersion: VERSION, node: process.versions.node, sharp: sharp.versions.sharp, sourceCommit: '40e333545b84285d7f135eef1abfd29d2f376ffb', capabilities: { chromaBackground: true, chromaFringe: true, coverageSampling: true, sharedPalette: true, strictGrid: true, sourceColorCleanupWithRegisteredEvidence: true, explicitMaterials: ['foliage', 'bamboo', 'glass'], colorClusters: true, bambooOuterContour: true, semanticModels: false, imageGeneration: false, automaticGridRecovery: 'opt-in', terrainAtlasValidation: false } }; }
  if (command === 'inspect') { if (!options.input || Object.keys(options).some(k => k !== 'input')) throw Error('inspect takes exactly --input PNG.'); return { ok: true, command, ...await inspectFile(options.input) }; }
  if (command === 'run') return runPipeline(options);
  throw Error('Unknown command: ' + command);
}
if (process.argv[1] && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) main().then(value => process.stdout.write(JSON.stringify(value) + '\n')).catch(error => { process.stderr.write(JSON.stringify({ ok: false, error: error.message }) + '\n'); process.exitCode = 1; });
