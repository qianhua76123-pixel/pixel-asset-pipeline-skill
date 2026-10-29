#!/usr/bin/env node
/** One bounded generation request, with durable recovery and no embedded secrets. */
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto';
import sharp from 'sharp';

const MAX_IMAGE = 64 * 1024 * 1024;
const MAX_JSON = 96 * 1024 * 1024;
const DEFAULT_STUDIO = 'http://127.0.0.1:3410';
const ACTIVE = new Set(['queued', 'pending', 'running']);
const RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'];
// Pixel Studio's Images-compatible presets, not a universal provider promise.
const SIZES = {
  '1K': ['1024x1024', '1152x864', '864x1152', '1536x864', '864x1536', '1536x1024', '1024x1536'],
  '2K': ['2048x2048', '2048x1536', '1536x2048', '2048x1152', '1152x2048', '2016x1344', '1344x2016'],
  '4K': ['4096x4096', '4096x3072', '3072x4096', '3840x2160', '2160x3840', '4080x2720', '2720x4080'],
};

export class GenerationError extends Error {
  constructor(message) { super(message); this.name = 'GenerationError'; }
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const loopback = host => host === 'localhost' || host === '::1' || host === '[::1]' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host);
function safeId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(value)) throw new GenerationError('Invalid provider, job or asset identifier');
  return value;
}
function text(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new GenerationError(`Invalid ${label}`);
  return value.trim();
}
function redact(value, key = '') {
  let result = String(value);
  if (key) result = result.split(key).join('[redacted]');
  return result.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]').replace(/(bearer\s+)[^\s"<>]+/gi, '$1[redacted]').replace(/([?&](?:key|api_key|token)=)[^&\s]+/gi, '$1[redacted]').replace(/https?:\/\/[^\s"<>]+/gi, raw => { try { const url = new URL(raw); return url.origin + url.pathname + (url.search ? '?[redacted]' : ''); } catch { return '[redacted URL]'; } }).slice(0, 1500);
}
function baseURL(value, mode, allowRemote = false) {
  let url;
  try { url = new URL(value); } catch { throw new GenerationError('API base URL must be an HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new GenerationError('API base URL cannot contain credentials, a query, or a fragment');
  if (mode === 'studio' && (!['', '/'].includes(url.pathname))) throw new GenerationError('Studio URL must be an origin without a path');
  if (mode === 'studio' && !loopback(url.hostname) && !allowRemote) throw new GenerationError('A non-loopback Studio requires --allow-remote');
  if (mode === 'api' && url.protocol === 'http:' && !loopback(url.hostname)) throw new GenerationError('A remote custom API must use HTTPS');
  return url.toString().replace(/\/+$/, '').replace(mode === 'api' ? /\/(?:images\/(?:generations|edits)|models)\/?$/ : /$^/, '');
}
function optionsFor(input = {}, requirePrompt = true) {
  const mode = input.mode ?? 'studio';
  if (!['studio', 'api'].includes(mode)) throw new GenerationError('Mode must be studio or api');
  const model = text(input.model ?? 'nano-banana-2', 'model');
  const protocol = input.protocol ?? 'openai';
  if (!['openai', 'gemini'].includes(protocol)) throw new GenerationError('API protocol must be openai or gemini');
  const aspectRatio = input.aspectRatio ?? '1:1';
  const resolution = input.resolution ?? '1K';
  if (!RATIOS.includes(aspectRatio) || !Object.hasOwn(SIZES, resolution)) throw new GenerationError('Unsupported aspect ratio or resolution');
  const size = input.size ?? SIZES[resolution][RATIOS.indexOf(aspectRatio)];
  if (typeof size !== 'string' || !/^\d{2,5}x\d{2,5}$/.test(size) || size.split('x').some(n => Number(n) < 32 || Number(n) > 8192)) throw new GenerationError('Image size must be WIDTHxHEIGHT, between 32 and 8192');
  const timeout = Number(input.timeout ?? 240);
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 3600) throw new GenerationError('Timeout must be between 0 and 3600 seconds');
  const pollIntervalMs = Number(input.pollIntervalMs ?? 1000);
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1) throw new GenerationError('Polling interval must be positive');
  const apiKeyEnv = input.apiKeyEnv ?? 'PIXEL_IMAGE_API_KEY';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) throw new GenerationError('API key environment variable name is invalid');
  const apiKey = mode === 'api' ? process.env[apiKeyEnv] ?? '' : '';
  if (/[\r\n]/.test(apiKey)) throw new GenerationError('API key cannot contain a newline');
  if (mode === 'api' && !apiKey) throw new GenerationError(`Set the ${apiKeyEnv} environment variable before generation`);
  const baseUrl = baseURL(input.baseUrl ?? (mode === 'studio' ? DEFAULT_STUDIO : ''), mode, input.allowRemote);
  if (apiKey && (baseUrl.includes(apiKey) || model.includes(apiKey))) throw new GenerationError('Configured API credential cannot appear in the base URL or model');
  if (requirePrompt && typeof input.prompt !== 'string' && !input.promptFile) throw new GenerationError('Supply prompt or promptFile');
  return { ...input, mode, model, protocol, aspectRatio, resolution, size, timeout, pollIntervalMs, apiKeyEnv, apiKey, baseUrl };
}
async function bounded(response, maximum) {
  if (Number(response.headers.get('content-length') ?? 0) > maximum) throw new GenerationError('Response exceeds the size limit');
  if (!response.body) throw new GenerationError('Empty service response');
  const chunks = []; let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > maximum) { await response.body.cancel().catch(() => {}); throw new GenerationError('Response exceeds the size limit'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function request(url, { body, headers = {}, timeout = 60, key = '', binary = false } = {}) {
  let response;
  try { response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.ceil(timeout * 1000))) }); }
  catch (error) { throw new GenerationError(`Request failed without retry: ${redact(error.message, key)}`); }
  const bytes = await bounded(response, binary ? MAX_IMAGE : MAX_JSON);
  let result;
  if (!binary || !response.ok) {
    try { result = JSON.parse(bytes.toString('utf8')); } catch { throw new GenerationError(`Service returned non-JSON HTTP ${response.status}`); }
  }
  if (!response.ok) {
    const error = new GenerationError(`HTTP ${response.status}: ${redact(typeof result?.error === 'string' ? result.error : result?.error?.message ?? result?.message ?? 'service rejected request', key)}`);
    error.httpStatus = response.status;
    throw error;
  }
  if (binary) return bytes;
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new GenerationError('Service JSON must be an object');
  return result;
}
function studioRequest(options, apiPath, body, binary = false) {
  return request(`${options.baseUrl}${apiPath}`, { body, binary, timeout: Math.min(options.timeout, 60), headers: { Origin: options.baseUrl, Accept: binary ? 'image/png' : 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) } });
}
function apiHeaders(options) {
  return { 'Content-Type': 'application/json', ...(options.protocol === 'gemini' ? { 'x-goog-api-key': options.apiKey } : { Authorization: `Bearer ${options.apiKey}` }) };
}
async function saveManifest(directory, manifest) {
  const temporary = path.join(directory, '.generation.json.tmp');
  await fs.writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temporary, path.join(directory, 'generation.json'));
}
async function loadManifest(directory) {
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(directory, 'generation.json'), 'utf8')); }
  catch { throw new GenerationError('No valid generation.json in this output directory'); }
  if (manifest?.version !== 1 || !['studio', 'api'].includes(manifest.mode)) throw new GenerationError('Unsupported generation manifest');
  return manifest;
}
function resultFor(directory, manifest) {
  return { outputPath: path.join(directory, 'source.png'), ...(manifest.assetId ? { assetId: manifest.assetId } : {}), ...(manifest.jobId ? { jobId: manifest.jobId } : {}), model: manifest.model, protocol: manifest.protocol, sourceSha256: manifest.sourceSha256, manifestPath: path.join(directory, 'generation.json') };
}
async function normalizeAndFinish(directory, manifest, image) {
  if (!image?.length || image.length > MAX_IMAGE) throw new GenerationError('Generated image is empty or too large');
  // The response image is a recovery artifact; never save the provider JSON or signed media URL.
  const responseFile = path.join(directory, 'image-response.bin');
  try { await fs.writeFile(responseFile, image, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  manifest.status = 'normalizing';
  manifest.responseSha256 = sha(image);
  await saveManifest(directory, manifest);
  let png;
  try {
    const decoder = sharp(image, { limitInputPixels: 32_000_000, animated: false });
    const metadata = await decoder.metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format) || (metadata.pages ?? 1) !== 1) throw new Error('Only static PNG, JPEG and WebP results are supported');
    png = await decoder.png().toBuffer();
  } catch (error) { throw new GenerationError('Generated image could not be decoded: ' + redact(error.message)); }
  try { await fs.writeFile(path.join(directory, 'source.png'), png, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (sha(await fs.readFile(path.join(directory, 'source.png'))) !== sha(png)) throw new GenerationError('Existing source.png differs from the saved generation; refusing to overwrite');
  }
  manifest.status = 'succeeded'; manifest.sourceSha256 = sha(png); manifest.finishedAt = new Date().toISOString();
  await saveManifest(directory, manifest);
  return resultFor(directory, manifest);
}
async function pollStudio(options, directory, manifest) {
  const deadline = Date.now() + options.timeout * 1000;
  while (true) {
    const response = await studioRequest(options, `/api/studio/jobs/${encodeURIComponent(safeId(manifest.jobId))}`);
    const job = response.job ?? response;
    if (job?.id !== manifest.jobId) throw new GenerationError('Job response does not match this generation');
    manifest.jobStatus = job.status; manifest.progress = job.progress;
    if (job.status === 'succeeded') {
      const assetId = safeId(job.assets?.[0]?.id);
      manifest.assetId = assetId; manifest.status = 'downloading';
      await saveManifest(directory, manifest);
      const image = await studioRequest(options, `/api/studio/assets/${encodeURIComponent(assetId)}/file`, undefined, true);
      return normalizeAndFinish(directory, manifest, image);
    }
    if (!ACTIVE.has(job.status)) {
      manifest.status = 'failed'; manifest.error = redact(job.error ?? `Generation ended with status ${job.status}`);
      await saveManifest(directory, manifest);
      throw new GenerationError(manifest.error);
    }
    manifest.status = 'running'; await saveManifest(directory, manifest);
    if (Date.now() >= deadline) throw new GenerationError(`Polling timed out; resume job ${manifest.jobId} from this output directory. Do not submit generation again.`);
    await new Promise(resolve => setTimeout(resolve, Math.min(options.pollIntervalMs, Math.max(1, deadline - Date.now()))));
  }
}
function sealedMedia(url, key) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', hkdfSync('sha256', key, salt, 'pixel-generation-media-url-v1', 32), iv);
  const bytes = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()]);
  return { version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: bytes.toString('base64') };
}
function openMedia(envelope, key) {
  try {
    if (envelope.version !== 1) throw new Error('version');
    const decipher = createDecipheriv('aes-256-gcm', hkdfSync('sha256', key, Buffer.from(envelope.salt, 'base64'), 'pixel-generation-media-url-v1', 32), Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8');
  } catch { throw new GenerationError('Could not decrypt the saved media URL; use the same API key environment value as the original generation'); }
}
async function imageFromAPI(options, response, directory, manifest) {
  let image;
  if (options.protocol === 'openai') image = response.data?.[0];
  else {
    const parts = response.candidates?.flatMap(c => c.content?.parts ?? []) ?? [];
    const inline = parts.map(p => p.inlineData ?? p.inline_data).find(p => typeof p?.data === 'string');
    if (inline) image = { b64_json: inline.data };
  }
  if (typeof image?.b64_json === 'string') {
    if (image.b64_json.length > MAX_IMAGE * 1.4 || !/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(image.b64_json)) throw new GenerationError('API returned invalid or oversized base64');
    return Buffer.from(image.b64_json, 'base64');
  }
  if (typeof image?.url === 'string') {
    if (/^data:image\/(?:png|jpe?g|webp);base64,/i.test(image.url)) {
      const b64 = image.url.slice(image.url.indexOf(',') + 1);
      if (b64.length > MAX_IMAGE * 1.4) throw new GenerationError('API returned oversized image data');
      return Buffer.from(b64, 'base64');
    }
    if (image.url.length > 8192) throw new GenerationError('API returned an oversized media URL');
    let url;
    try { url = new URL(image.url); } catch { throw new GenerationError('API returned an invalid media URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.protocol === 'http:' && !loopback(url.hostname)) throw new GenerationError('API returned an unsafe media URL');
    if (options.apiKey && image.url.includes(options.apiKey)) throw new GenerationError('API attempted to put the configured credential in a media URL');
    manifest.sealedMedia = sealedMedia(url.href, options.apiKey);
    manifest.status = 'downloading';
    await saveManifest(directory, manifest);
    // No API credentials or auth headers are forwarded to returned media URLs.
    return request(url.href, { binary: true, timeout: options.timeout });
  }
  throw new GenerationError('API returned no supported image; expected data[0].b64_json/url or Gemini inlineData');
}

export async function listProviders(input = {}) {
  const options = optionsFor(input, false);
  if (options.mode === 'studio') {
    const response = await studioRequest(options, '/api/studio/settings');
    if (!Array.isArray(response.providers)) throw new GenerationError('Studio did not return provider connections');
    return response.providers.map(p => ({ id: safeId(p.id), name: redact(p.name), model: redact(p.model), protocol: p.protocol, enabled: p.enabled === true, hasKey: p.hasKey === true }));
  }
  const result = await request(`${options.baseUrl}/models`, { headers: apiHeaders(options), timeout: options.timeout, key: options.apiKey });
  const entries = options.protocol === 'gemini' ? result.models : result.data;
  if (!Array.isArray(entries)) throw new GenerationError('API did not return a model list');
  return entries.map(m => ({ model: redact(m.id ?? m.name, options.apiKey) }));
}
export async function generationDoctor(input = {}) {
  const options = optionsFor(input, false);
  return { ok: true, mode: options.mode, protocol: options.protocol, model: options.model, baseUrl: options.baseUrl, keyPresent: options.mode === 'api' ? Boolean(options.apiKey) : undefined, node: process.versions.node, ...(options.mode === 'studio' ? { providers: await listProviders(input) } : { connectivityChecked: false }) };
}
function generationStandard(input) {
  let standard = input.generationStandard;
  if (input.logicalSize) {
    if (standard) throw new GenerationError('Choose generationStandard or logicalSize, not both');
    if (!/^\d+x\d+$/.test(input.logicalSize)) throw new GenerationError('Logical size must be WIDTHxHEIGHT');
    const [logicalWidth, logicalHeight] = input.logicalSize.split('x').map(Number);
    standard = { version: 1, enabled: true, logicalWidth, logicalHeight, view: input.view ?? 'rpg-top-down', outline: input.outline ?? 'material', background: input.background ?? 'neutral' };
  }
  if (standard === undefined || standard?.enabled === false) return undefined;
  if (!standard || typeof standard !== 'object' || Array.isArray(standard) || standard.version !== 1 || standard.enabled !== true || !['rpg-top-down', 'isometric', 'side'].includes(standard.view) || !['material', 'dark', 'none'].includes(standard.outline) || !['neutral', 'transparent'].includes(standard.background) || ['logicalWidth', 'logicalHeight'].some(k => !Number.isInteger(standard[k]) || standard[k] < 32 || standard[k] > 1024) || Object.keys(standard).some(k => !['version', 'enabled', 'logicalWidth', 'logicalHeight', 'view', 'outline', 'background'].includes(k))) throw new GenerationError('Invalid Pixel Studio generation standard');
  if (input.mode === 'api') throw new GenerationError('Direct API mode takes a complete prompt; append pixel constraints to that prompt instead of using Studio generationStandard');
  return { ...standard };
}
export async function generateImage(input = {}) {
  const options = optionsFor(input);
  if (input.prompt && input.promptFile) throw new GenerationError('Supply prompt or promptFile, not both');
  const prompt = text(input.promptFile ? await fs.readFile(input.promptFile, 'utf8') : input.prompt, 'prompt', 32000);
  if (options.apiKey && prompt.includes(options.apiKey)) throw new GenerationError('Prompt contains the configured API credential');
  const standard = generationStandard(input);
  if (!input.outputDir) throw new GenerationError('outputDir is required');
  const directory = path.resolve(input.outputDir);
  let provider;
  if (options.mode === 'studio') {
    const providers = await listProviders(options);
    if (input.providerId) provider = providers.find(p => p.id === safeId(input.providerId));
    else {
      const matches = providers.filter(p => p.enabled && p.model === options.model && ['openai', 'gemini'].includes(p.protocol));
      if (matches.length === 1) provider = matches[0];
      else throw new GenerationError('Choose --provider-id from providers; there must be exactly one enabled match to select automatically');
    }
    if (!provider?.enabled || !['openai', 'gemini'].includes(provider.protocol)) throw new GenerationError('Choose an enabled OpenAI Images or Gemini Studio connection');
  }
  await fs.mkdir(path.dirname(directory), { recursive: true });
  try { await fs.mkdir(directory); } catch (error) { if (error.code === 'EEXIST') throw new GenerationError('Output directory already exists; use status/resume or choose a fresh directory'); throw error; }
  const manifest = { version: 1, status: 'prepared', mode: options.mode, protocol: provider?.protocol ?? options.protocol, model: options.model, baseUrl: options.baseUrl, ...(provider ? { providerId: provider.id } : { apiKeyEnv: options.apiKeyEnv }), prompt, size: options.size, aspectRatio: options.aspectRatio, resolution: options.resolution, ...(standard ? { generationStandard: standard } : {}), requestedAt: new Date().toISOString(), requestCount: 0 };
  await saveManifest(directory, manifest);
  try {
    manifest.status = 'submitting'; manifest.requestCount = 1; await saveManifest(directory, manifest);
    if (options.mode === 'studio') {
      const result = await studioRequest(options, '/api/studio/generate', { providerId: provider.id, model: options.model, prompt, references: [], aspectRatio: options.aspectRatio, resolution: options.resolution, transparent: standard?.background === 'transparent', generationStandard: standard ?? { enabled: false } });
      manifest.jobId = safeId(result.jobId); manifest.status = 'submitted'; await saveManifest(directory, manifest);
      return await pollStudio(options, directory, manifest);
    }
    const body = options.protocol === 'gemini'
      ? { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: options.aspectRatio, imageSize: options.resolution } } }
      : { model: options.model, prompt, n: 1, size: options.size };
    const endpoint = options.protocol === 'gemini' ? `/models/${encodeURIComponent(options.model.replace(/^models\//, ''))}:generateContent` : '/images/generations';
    const response = await request(options.baseUrl + endpoint, { body, headers: apiHeaders(options), timeout: options.timeout, key: options.apiKey });
    manifest.status = 'response-received'; await saveManifest(directory, manifest);
    return await normalizeAndFinish(directory, manifest, await imageFromAPI(options, response, directory, manifest));
  } catch (error) {
    manifest.error = redact(error.message, options.apiKey);
    if (manifest.status === 'submitting') manifest.status = error.httpStatus ? 'rejected' : 'submission-unknown';
    await saveManifest(directory, manifest);
    throw new GenerationError(`${manifest.error} (state: ${path.join(directory, 'generation.json')})`);
  }
}
export async function generationStatus(input = {}) {
  if (!input.outputDir) throw new GenerationError('outputDir is required');
  const directory = path.resolve(input.outputDir); const manifest = await loadManifest(directory);
  let job;
  if (manifest.mode === 'studio' && manifest.jobId && manifest.status !== 'succeeded') {
    const options = optionsFor({ ...input, mode: 'studio', baseUrl: manifest.baseUrl, model: manifest.model }, false);
    const response = await studioRequest(options, `/api/studio/jobs/${encodeURIComponent(safeId(manifest.jobId))}`);
    const result = response.job ?? response;
    if (result.id !== manifest.jobId) throw new GenerationError('Job response does not match this generation');
    job = { status: result.status, progress: result.progress, ...(result.error ? { error: redact(result.error) } : {}) };
  }
  return { ...manifest, ...(job ? { liveJob: job } : {}), manifestPath: path.join(directory, 'generation.json') };
}
export async function resumeGeneration(input = {}) {
  if (!input.outputDir) throw new GenerationError('outputDir is required');
  const directory = path.resolve(input.outputDir); const manifest = await loadManifest(directory);
  if (manifest.status === 'succeeded') {
    const image = await fs.readFile(path.join(directory, 'source.png'));
    if (sha(image) !== manifest.sourceSha256) throw new GenerationError('Saved image hash does not match generation.json');
    return resultFor(directory, manifest);
  }
  if (manifest.responseSha256) {
    const image = await fs.readFile(path.join(directory, 'image-response.bin'));
    if (sha(image) !== manifest.responseSha256) throw new GenerationError('Saved response image hash does not match generation.json');
    return normalizeAndFinish(directory, manifest, image);
  }
  if (manifest.mode === 'api' && manifest.sealedMedia) {
    const options = optionsFor({ ...input, mode: 'api', baseUrl: manifest.baseUrl, protocol: manifest.protocol, model: manifest.model, apiKeyEnv: manifest.apiKeyEnv }, false);
    const url = openMedia(manifest.sealedMedia, options.apiKey);
    return normalizeAndFinish(directory, manifest, await imageFromAPI(options, { data: [{ url }] }, directory, manifest));
  }
  if (manifest.mode !== 'studio' || !manifest.jobId) throw new GenerationError('No known job or saved image to resume. Do not retry an uncertain generation automatically.');
  const options = optionsFor({ ...input, mode: 'studio', baseUrl: manifest.baseUrl, model: manifest.model }, false);
  return pollStudio(options, directory, manifest);
}

function parseArgs(argv) {
  const command = argv.shift() ?? 'help'; const input = {};
  const names = { mode: 'mode', 'base-url': 'baseUrl', 'provider-id': 'providerId', protocol: 'protocol', model: 'model', prompt: 'prompt', 'prompt-file': 'promptFile', 'output-dir': 'outputDir', size: 'size', 'aspect-ratio': 'aspectRatio', resolution: 'resolution', 'api-key-env': 'apiKeyEnv', timeout: 'timeout', 'poll-interval-ms': 'pollIntervalMs', 'logical-size': 'logicalSize', view: 'view', outline: 'outline', background: 'background' };
  while (argv.length) {
    const arg = argv.shift();
    if (arg === '--allow-remote') { input.allowRemote = true; continue; }
    if (!arg?.startsWith('--') || !names[arg.slice(2)] || !argv.length) throw new GenerationError(`Unknown or incomplete argument: ${arg}`);
    const value = argv.shift();
    if (value.startsWith('--')) throw new GenerationError(`Missing value for ${arg}`);
    input[names[arg.slice(2)]] = value;
  }
  return { command, input };
}
export async function cliMain(argv = process.argv.slice(2)) {
  const { command, input } = parseArgs([...argv]);
  if (['help', '--help', '-h'].includes(command)) return { commands: ['doctor', 'providers', 'generate', 'status', 'resume'], usage: 'pixel_generate.mjs generate --mode studio --provider-id ID --model nano-banana-2 --prompt-file prompt.txt --output-dir runs/new/generation', api: 'generate --mode api --protocol openai|gemini --base-url URL --api-key-env PIXEL_IMAGE_API_KEY --model nano-banana-2 --prompt-file prompt.txt --output-dir NEW_DIR' };
  const operation = { doctor: generationDoctor, providers: listProviders, generate: generateImage, status: generationStatus, resume: resumeGeneration }[command];
  if (!operation) throw new GenerationError(`Unknown command: ${command}`);
  return operation(input);
}
if (process.argv[1] && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  cliMain().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(JSON.stringify({ error: redact(error.message) })); process.exitCode = 1; });
}
