#!/usr/bin/env node
/** Apply one explicit same-silhouette garment region; no network, sampling or inference. */
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const PRODUCER = 'pixel-garment', VERSION = 1;
const MAX_BYTES = 40 * 1024 * 1024, MAX_PIXELS = 1_048_576;
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MARKER = Buffer.from('pixel-garment\0');
const sha = value => createHash('sha256').update(value).digest('hex');

function pngChunks(bytes) {
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw Error('Inputs must be PNG files.');
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) throw Error('Truncated PNG chunk.');
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) throw Error('Truncated PNG chunk data.');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    chunks.push({ type, offset, data: bytes.subarray(offset + 8, end - 4) });
    offset = end;
    if (type === 'IEND') return chunks;
  }
  throw Error('PNG has no IEND chunk.');
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function markOutput(bytes, role, sourceSha256) {
  const data = Buffer.concat([MARKER, Buffer.from(JSON.stringify({ producer: PRODUCER, version: VERSION, role, sourceSha256 }))]);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length); chunk.write('tEXt', 4, 'ascii'); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, chunk.length - 4)), chunk.length - 4);
  const end = pngChunks(bytes).find(c => c.type === 'IEND').offset;
  return Buffer.concat([bytes.subarray(0, end), chunk, bytes.subarray(end)]);
}

async function rgba(bytes) {
  return sharp(bytes, { limitInputPixels: MAX_PIXELS, animated: false }).toColourspace('srgb').ensureAlpha().raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
}

async function readInput(filename, role) {
  if (typeof filename !== 'string' || !filename) throw Error(`Missing --${role === 'editMask' ? 'edit-mask' : role}.`);
  const file = path.resolve(filename), info = await fs.stat(file);
  if (!info.isFile() || info.size > MAX_BYTES) throw Error(`${role} must be a PNG file no larger than 40 MiB.`);
  const bytes = await fs.readFile(file);
  if (bytes.length > MAX_BYTES) throw Error(`${role} exceeds 40 MiB.`);
  const chunks = pngChunks(bytes);
  if (chunks.some(c => c.type === 'acTL')) throw Error(`${role} must be a single static PNG, not an animation.`);
  if (role === 'base' && chunks.some(c => c.type === 'tEXt' && c.data.subarray(0, MARKER.length).equals(MARKER))) throw Error('A garment output cannot become a new base. Return to the frozen original mother template; recursive application is disabled.');
  const metadata = await sharp(bytes, { limitInputPixels: MAX_PIXELS, animated: false }).metadata();
  if (metadata.format !== 'png' || (metadata.pages ?? 1) !== 1 || metadata.depth !== 'uchar' || (metadata.orientation ?? 1) !== 1) throw Error(`${role} must be a native 8-bit static PNG without orientation transforms.`);
  if (metadata.icc) throw Error(`${role} contains an ICC color profile; export an untagged native sRGB PNG first so protected RGB values are not color-converted.`);
  const decoded = await rgba(bytes);
  if (decoded.info.channels !== 4) throw Error(`${role} could not be decoded as RGBA.`);
  for (let i = 3; i < decoded.data.length; i += 4) if (decoded.data[i] !== 0 && decoded.data[i] !== 255) throw Error(`${role} must have hard alpha (only 0 or 255); no thresholding is performed.`);
  return { file, sha256: sha(bytes), rgbaSha256: sha(decoded.data), width: decoded.info.width, height: decoded.info.height, data: decoded.data };
}

function inputRecord({ file, sha256, rgbaSha256, width, height }) { return { file, sha256, rgbaSha256, width, height }; }

export async function applyGarment(options = {}) {
  if (typeof options.outputDir !== 'string' || !options.outputDir) throw Error('Supply --output-dir NEW_DIRECTORY.');
  const outputDir = path.resolve(options.outputDir);
  try { await fs.stat(outputDir); throw Error('Output directory already exists; preserve the prior bundle and use a new directory.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const [base, proposal, mask] = await Promise.all([readInput(options.base, 'base'), readInput(options.proposal, 'proposal'), readInput(options.editMask, 'editMask')]);
  if ([proposal, mask].some(image => image.width !== base.width || image.height !== base.height)) throw Error('Base, proposal and edit-mask must have identical native dimensions; no resizing or alignment is performed.');
  const composite = Buffer.from(base.data), layer = Buffer.alloc(base.data.length);
  let maskedPixels = 0, changedPixels = 0;
  for (let i = 0; i < mask.data.length; i += 4) {
    if (mask.data[i + 3] === 0) continue;
    const pixel = i / 4, x = pixel % base.width, y = Math.floor(pixel / base.width);
    if (base.data[i + 3] !== 255) throw Error(`Edit mask escapes the solid base at (${x}, ${y}); this command cannot expand the silhouette.`);
    if (proposal.data[i + 3] !== 255) throw Error(`Proposal is missing opaque coverage inside the edit mask at (${x}, ${y}).`);
    maskedPixels++;
    if (!proposal.data.subarray(i, i + 4).equals(base.data.subarray(i, i + 4))) changedPixels++;
    proposal.data.copy(composite, i, i, i + 4);
    proposal.data.copy(layer, i, i, i + 4);
  }
  if (!maskedPixels) throw Error('Edit mask is empty; explicitly mark the intended clothing region.');
  const encode = async (data, role) => markOutput(await sharp(data, { raw: { width: base.width, height: base.height, channels: 4 } }).png().toBuffer(), role, base.sha256);
  const [compositePng, layerPng] = await Promise.all([encode(composite, 'composite'), encode(layer, 'garment-layer')]);
  const [savedComposite, savedLayer] = await Promise.all([rgba(compositePng), rgba(layerPng)]);
  if (!savedComposite.data.equals(composite) || !savedLayer.data.equals(layer)) throw Error('PNG encoding changed decoded RGBA; refusing to export.');
  let protectedChanged = 0, silhouetteChanged = 0;
  for (let i = 0; i < base.data.length; i += 4) {
    if (mask.data[i + 3] === 0 && !savedComposite.data.subarray(i, i + 4).equals(base.data.subarray(i, i + 4))) protectedChanged++;
    if (savedComposite.data[i + 3] !== base.data[i + 3]) silhouetteChanged++;
  }
  if (protectedChanged || silhouetteChanged) throw Error('Mother-template protection failed; no files were written.');
  const report = {
    producer: PRODUCER, version: VERSION, operation: 'apply-same-silhouette-garment',
    sourceSha256: base.sha256, width: base.width, height: base.height,
    maskedPixels, changedPixels, protectedPixels: base.width * base.height - maskedPixels, protectedChanged, silhouetteChanged,
    comparison: 'decoded-8-bit-sRGB-RGBA-bytes',
    inputs: { base: inputRecord(base), proposal: inputRecord(proposal), editMask: inputRecord(mask) },
    outputs: { garmentLayer: { file: 'garment-layer.png', sha256: sha(layerPng) }, composite: { file: 'composite.png', sha256: sha(compositePng) } },
    safeguards: { noResampling: true, noMaskExpansion: true, noSourceMutation: true, recursiveBaseGuard: 'embedded-png-marker' },
    limitations: ['Only the explicit mask determines what is protected; no body-part semantics are inferred.', 'This is a same-silhouette edit, not a visibility mask, dye mask, automatic garment fit or skeletal rig.', 'Do not strip the output provenance marker to use a composite as a new mother template.'],
  };
  await fs.mkdir(path.dirname(outputDir), { recursive: true });
  await fs.mkdir(outputDir);
  try {
    await fs.writeFile(path.join(outputDir, 'garment-layer.png'), layerPng, { flag: 'wx', mode: 0o600 });
    await fs.writeFile(path.join(outputDir, 'composite.png'), compositePng, { flag: 'wx', mode: 0o600 });
    await fs.writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) { throw Error(`Could not write complete garment bundle: ${error.message}. Preserve the inputs and inspect the partial output directory.`); }
  return { ok: true, ...report, outputDirectory: outputDir, reportPath: path.join(outputDir, 'report.json') };
}

export async function cliMain(argv = process.argv.slice(2)) {
  const args = [...argv], command = args.shift() ?? 'help';
  if (['help', '--help', '-h'].includes(command)) return { commands: { apply: '--base mother.png --proposal candidate.png --edit-mask clothing-region.png --output-dir NEW_DIRECTORY' }, note: 'Same-size native hard-alpha PNGs only. No resizing, generation, silhouette expansion or recursive base edits.' };
  if (command !== 'apply') throw Error('Unknown command: ' + command);
  const names = { '--base': 'base', '--proposal': 'proposal', '--edit-mask': 'editMask', '--output-dir': 'outputDir' }, options = {};
  while (args.length) {
    const flag = args.shift(), key = names[flag], value = args.shift();
    if (!key) throw Error('Unknown option: ' + flag);
    if (!value || value.startsWith('--')) throw Error('Missing value for ' + flag);
    if (Object.hasOwn(options, key)) throw Error('Duplicate option: ' + flag);
    options[key] = value;
  }
  return applyGarment(options);
}
if (process.argv[1] && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) cliMain().then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n')).catch(error => { process.stderr.write(JSON.stringify({ ok: false, error: error.message }) + '\n'); process.exitCode = 1; });
