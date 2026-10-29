#!/usr/bin/env node
/** Portable, bounded local pixel workflow. No network calls or generation. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { strictGrid, refineBackgroundColors, refineImageDetails, refineAdaptiveColors, refineOuterContour, removeBorderKeyShades } from './runtime/vendor/index.mjs';

const VERSION = '0.1.0', WORKFLOW = 'portable-pixel-fixed', RECIPE_VERSION = 1;
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
  const algorithms = { background: ['global-chroma-key'], grid: ['fixed-grid-palette-first-majority-v1', 'explicit-native-hard-alpha-v1'], 'source-colors': ['source-cell-local-background-color-v1'], 'material-detail': ['explicit-material-local-color-v1', 'frozen-warm-material-inner-outline-v1'], 'color-clusters': ['source-medoids-edge-potts-v1'], 'outer-contour': ['bounded-bamboo-joint-rhythm-v2'], export: ['native-png-export-v1'] };
  const valid = value?.producer === WORKFLOW && value.version === RECIPE_VERSION && value.completed === true && validHash(value.sourceSha256) && value.outputSha256 === inputHash && value.width === image.width && value.height === image.height && value.recipe?.id === WORKFLOW && value.recipe.version === RECIPE_VERSION && value.recipe.width === image.width && value.recipe.height === image.height && value.recipe.sampler === 'majority' && value.recipe.alphaThreshold === 128 && value.recipe.phaseX === 0 && value.recipe.phaseY === 0 && value.recipe.exportScale === 1 && ['keep', 'chroma'].includes(value.recipe.background) && (value.recipe.background !== 'chroma' || validKey(value.recipe.keyColor)) && ['generic', 'foliage', 'bamboo', 'glass'].includes(value.recipe.material) && [64, 96].includes(value.recipe.paletteBudget) && Array.isArray(value.stageProofs) && value.stageProofs.length === STAGES.length && value.stageProofs.every((stage, i) => stage && stage.id === STAGES[i] && ['run', 'skip'].includes(stage.status) && (stage.status === 'skip' ? typeof stage.reason === 'string' && stage.reason.length > 0 : algorithms[stage.id].includes(stage.algorithm))) && [1, 4, 6].every(i => value.stageProofs[i].status === 'run') && (value.recipe.material === 'generic' ? value.stageProofs[3].status === 'skip' : value.stageProofs[3].status === 'run') && (value.recipe.material === 'bamboo' ? value.stageProofs[5].status === 'run' : value.stageProofs[5].status === 'skip');
  if (!valid) return { status: 'invalid', reason: 'Output hash, dimensions, recipe, stage IDs, or algorithm proofs do not match.' };
  try { assertNative(image); } catch (error) { return { status: 'invalid', reason: error.message }; }
  return { status: 'matched', value };
}
export async function inspectFile(filename) {
  const input = path.resolve(filename), decoded = await decodeFile(input), hash = sha(decoded.bytes), sidecar = await readSidecar(input, hash, decoded.image);
  return { input, sha256: hash, ...statistics(decoded.image), border: borderEvidence(decoded.image), verifiedCompletion: sidecar.status === 'matched', sidecarStatus: sidecar.status, ...(sidecar.reason ? { sidecarReason: sidecar.reason } : {}) };
}
export async function runPipeline(options) {
  if (!options.input || !options['output-dir']) throw Error('run requires --input PNG and --output-dir NEW_DIRECTORY.');
  if (options.native && options.size) throw Error('Choose --native or --size; their meanings are different.');
  if (options.key && (options.background ?? 'auto') !== 'chroma') throw Error('--key requires --background chroma; auto mode uses measured evidence.');
  const input = path.resolve(options.input), outdir = path.resolve(options['output-dir']);
  try { await fs.lstat(outdir); throw Error('Output directory already exists. Choose a new directory; input and prior results are never overwritten.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const decoded = await decodeFile(input), originalHash = sha(decoded.bytes), original = decoded.image, before = statistics(original);
  if (!before.visiblePixels) throw Error('Input has no visible subject.');
  const material = options.material ?? 'generic', budget = Number(options.palette ?? 96);
  if (!['generic', 'foliage', 'bamboo', 'glass'].includes(material)) throw Error('--material must be generic, foliage, bamboo, or glass.');
  if (![64, 96].includes(budget)) throw Error('--palette must be 96 (default) or 64. It is a soft refinement budget, not a hard color-count ceiling.');
  const sidecar = await readSidecar(input, originalHash, original);
  if (sidecar.status === 'invalid') throw Error('Existing completion sidecar is invalid: ' + sidecar.reason + ' Use the frozen original input, or resolve that provenance record explicitly.');
  let image, recipe, stages, repeated = false;
  if (sidecar.status === 'matched') {
    const prior = sidecar.value.recipe, target = dimensions(original, options);
    const explicitChange = options.material !== undefined && options.material !== prior.material || options.palette !== undefined && budget !== prior.paletteBudget || options.size !== undefined && (target.width !== original.width || target.height !== original.height) || options.background !== undefined && options.background !== 'auto' && options.background !== 'keep';
    if (explicitChange) throw Error('This PNG is a verified finished output. Change settings by rerunning its frozen original source, not by feeding a refined result back through inference.');
    repeated = true; image = original; recipe = prior;
    stages = STAGES.map(id => id === 'export' ? { id, status: 'run', algorithm: 'native-png-export-v1', reason: 'Copy the verified completed native PNG.' } : { id, status: 'skip', reason: 'Verified matching output SHA and complete sidecar; preserve finished pixels.' });
  } else {
    const target = dimensions(original, options), background = chooseBackground(original, options);
    if (target.width * target.height > MAX_NATIVE_PIXELS) throw Error('Native output exceeds 1,048,576 pixels.');
    recipe = { id: WORKFLOW, version: RECIPE_VERSION, width: target.width, height: target.height, native: options.native === true, background: background.method, ...(background.keyColor ? { keyColor: background.keyColor } : {}), material, paletteBudget: budget, sampler: 'majority', alphaThreshold: 128, phaseX: 0, phaseY: 0, exportScale: 1 };
    stages = [];
    let registeredSource, gridEvidence;
    if (background.method === 'chroma') { const result = colorKey(original, background.keyColor); image = result.image; registeredSource = image; stages.push({ id: 'background', status: 'run', algorithm: result.diagnostics.algorithm, diagnostics: { ...result.diagnostics, evidence: background.proof, explicitlySelected: background.explicit } }); }
    else { image = canonical(original); stages.push({ id: 'background', status: 'skip', reason: 'Keep existing alpha/background; hard-alpha normalization occurs in the grid stage.' }); }
    if (options.native) { image = canonical(image); assertNative(image); stages.push({ id: 'grid', status: 'run', algorithm: 'explicit-native-hard-alpha-v1', diagnostics: { width: image.width, height: image.height, alphaThreshold: 128, automaticGridDetection: false, resampling: false } }); }
    else { const result = await strictGrid(image, target.width, target.height); image = result.image; gridEvidence = result.evidence; stages.push({ id: 'grid', status: 'run', algorithm: result.diagnostics.algorithm, diagnostics: result.diagnostics }); }
    assertNative(image);
    if (rgbKey(image).size > 8192) throw Error('Native image has more than 8192 visible colors. Use an explicit strict-grid size instead of --native.');
    if (registeredSource && gridEvidence && background.keyColor) {
      const result = refineBackgroundColors(image, { ...gridEvidence, sourceRGBA: registeredSource, unmattedSourceRGBA: original, keyColor: background.keyColor });
      image = result.image; stages.push({ id: 'source-colors', status: result.diagnostics.skipped ? 'skip' : 'run', ...(result.diagnostics.skipped ? { reason: result.diagnostics.skipReason || 'No verified source color evidence.' } : { algorithm: result.diagnostics.algorithm }), diagnostics: result.diagnostics });
    } else stages.push({ id: 'source-colors', status: 'skip', reason: 'No registered before/after key-removal raster and strict-grid source cells; do not infer missing original colors.' });
    if (material !== 'generic') { const result = refineImageDetails(image, { profile: material }); image = result.image; stages.push({ id: 'material-detail', status: 'run', algorithm: result.diagnostics.algorithm, diagnostics: result.diagnostics }); }
    else stages.push({ id: 'material-detail', status: 'skip', reason: 'No explicit material selected; do not guess semantics.' });
    const clustered = refineAdaptiveColors(image, { paletteBudget: budget }); image = clustered.image; stages.push({ id: 'color-clusters', status: 'run', algorithm: clustered.diagnostics.algorithm, diagnostics: clustered.diagnostics });
    if (material === 'bamboo') { const result = refineOuterContour(image, { profile: 'bamboo' }); image = result.image; stages.push({ id: 'outer-contour', status: 'run', algorithm: result.diagnostics.algorithm, diagnostics: result.diagnostics }); }
    else stages.push({ id: 'outer-contour', status: 'skip', reason: 'Only explicitly selected bamboo uses one bounded outer-contour pass.' });
    assertNative(image); stages.push({ id: 'export', status: 'run', algorithm: 'native-png-export-v1', diagnostics: { width: image.width, height: image.height, scale: 1, interpolation: 'none' } });
  }
  const output = repeated ? decoded.bytes : await png(image), outputHash = sha(output), final = statistics(image);
  assertNative(image);
  const manifest = { producer: WORKFLOW, version: RECIPE_VERSION, packageVersion: VERSION, sourceSha256: repeated ? sidecar.value.sourceSha256 : originalHash, inputSha256: originalHash, outputSha256: outputHash, recipe, repeatedCompletedInput: repeated, qualityStatus: 'candidate-needs-visual-review', stages, output: { file: 'sprite.png', ...final }, warnings: ['Hard pixels and successful export do not establish artistic quality, accurate materials, or correct missing details.', 'Changing palette, size, material or background should start from the frozen original source.'], limitations: { semanticBackgroundRemoval: false, automaticGridRecovery: false, imageGeneration: false, terrainAtlasValidation: false } };
  const proof = { producer: WORKFLOW, version: RECIPE_VERSION, completed: true, sourceSha256: manifest.sourceSha256, outputSha256: outputHash, width: image.width, height: image.height, recipe, stageProofs: (repeated ? sidecar.value.stageProofs : stages.map(stage => ({ id: stage.id, status: stage.status, ...(stage.algorithm ? { algorithm: stage.algorithm } : { reason: stage.reason }) }))) };
  await fs.mkdir(path.dirname(outdir), { recursive: true }); await fs.mkdir(outdir);
  try {
    await fs.writeFile(path.join(outdir, 'sprite.png'), output, { flag: 'wx' });
    await fs.writeFile(path.join(outdir, 'sprite.png.pixel.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
    await fs.writeFile(path.join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  } catch (error) { throw Error('Could not write complete output bundle: ' + error.message + '. Preserve input and choose another output directory; do not treat partial files as success.'); }
  return { ok: true, command: 'run', input, outputDirectory: outdir, output: path.join(outdir, 'sprite.png'), sidecar: path.join(outdir, 'sprite.png.pixel.json'), manifest: path.join(outdir, 'manifest.json'), ...final, repeatedCompletedInput: repeated, stages: stages.map(stage => ({ id: stage.id, status: stage.status, ...(stage.algorithm ? { algorithm: stage.algorithm } : { reason: stage.reason }) })), qualityStatus: manifest.qualityStatus };
}
function argumentsFor(argv) {
  const suppliedCommand = argv.shift() || 'help', command = ['--help', '-h'].includes(suppliedCommand) ? 'help' : suppliedCommand, options = {}, allowed = new Set(['input', 'output-dir', 'size', 'material', 'background', 'key', 'palette', 'native']);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]; if (!flag.startsWith('--') || !allowed.has(flag.slice(2))) throw Error('Unknown argument: ' + flag);
    const key = flag.slice(2); if (Object.hasOwn(options, key)) throw Error('Duplicate argument: ' + flag);
    if (key === 'native') options[key] = true;
    else { const value = argv[++i]; if (!value || value.startsWith('--')) throw Error('Missing value for ' + flag); options[key] = value; }
  }
  return { command, options };
}
async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Node.js 22 or newer is required.');
  const { command, options } = argumentsFor(process.argv.slice(2));
  if (command === 'help') return { ok: true, commands: { doctor: 'Check the portable runtime; no network or writes.', inspect: '--input PNG', run: '--input PNG --output-dir NEW_DIRECTORY [--size N|WxH | --native] [--background auto|keep|chroma] [--key #RRGGBB] [--material generic|foliage|bamboo|glass] [--palette 96|64]' }, defaults: { longestEdge: 256, material: 'generic', palette: 96, background: 'auto', gridDetection: false }, outputFiles: ['sprite.png', 'sprite.png.pixel.json', 'manifest.json'] };
  if (command === 'doctor') { if (Object.keys(options).length) throw Error('doctor takes no options.'); return { ok: true, command, packageVersion: VERSION, node: process.versions.node, sharp: sharp.versions.sharp, sourceCommit: '40e333545b84285d7f135eef1abfd29d2f376ffb', capabilities: { chromaBackground: true, strictGrid: true, sourceColorCleanupWithRegisteredEvidence: true, explicitMaterials: ['foliage', 'bamboo', 'glass'], colorClusters: true, bambooOuterContour: true, semanticModels: false, imageGeneration: false, automaticGridRecovery: false, terrainAtlasValidation: false } }; }
  if (command === 'inspect') { if (!options.input || Object.keys(options).some(k => k !== 'input')) throw Error('inspect takes exactly --input PNG.'); return { ok: true, command, ...await inspectFile(options.input) }; }
  if (command === 'run') return runPipeline(options);
  throw Error('Unknown command: ' + command);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(value => process.stdout.write(JSON.stringify(value) + '\n')).catch(error => { process.stderr.write(JSON.stringify({ ok: false, error: error.message }) + '\n'); process.exitCode = 1; });
