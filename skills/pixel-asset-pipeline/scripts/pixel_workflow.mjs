#!/usr/bin/env node
/** Generate once, then run the existing fixed sprite recipe. */
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generateImage, resumeGeneration } from './pixel_generate.mjs';
import { runPipeline, inspectFile } from './pixel_local.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '0.2.1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const secretSafe = value => String(value).replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]').replace(/(Bearer\s+)\S+/gi, '$1[redacted]').slice(0, 1800);
const materialNames = ['generic', 'foliage', 'bamboo', 'glass'];
function safeUrl(value, studio, allowRemote) {
  let url; try { url = new URL(value); } catch { throw Error('Provide a valid API or Studio URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('URLs cannot contain credentials, query parameters or fragments.');
  const local = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname);
  if (studio && (!['', '/'].includes(url.pathname) || !local && !allowRemote)) throw Error('Studio requires a loopback origin, or explicit --allow-remote.');
  if (!studio && url.protocol === 'http:' && !local) throw Error('Remote custom APIs require HTTPS.');
  return url.toString().replace(/\/+$/, '');
}

export function workflowConfig(options = {}) {
  const mode = options.mode ?? 'studio', processor = options.processor ?? 'local';
  if (!['studio', 'api'].includes(mode)) throw Error('--mode must be studio or api.');
  if (!['local', 'studio'].includes(processor)) throw Error('--processor must be local or studio.');
  const material = options.material ?? 'generic', background = options.background ?? 'auto';
  if (!materialNames.includes(material)) throw Error('Unknown material.');
  if (!['auto', 'chroma', 'keep'].includes(background)) throw Error('--background must be auto, chroma or keep.');
  if (background === 'chroma' && !/^#[0-9a-f]{6}$/i.test(options.key ?? '')) throw Error('Explicit chroma requires --key #RRGGBB.');
  if (options.key && background !== 'chroma') throw Error('--key requires --background chroma.');
  const size = options.size ?? '256';
  if (!/^[1-9]\d{0,3}(x[1-9]\d{0,3})?$/.test(String(size)) || String(size).split('x').some(n => Number(n) > 1024)) throw Error('--size must be 1..1024 or WIDTHxHEIGHT (each 1..1024).');
  const palette = Number(options.palette ?? 96);
  if (![64, 96].includes(palette)) throw Error('--palette must be 64 or 96.');
  if (processor === 'studio' && (palette !== 96 || options.background !== undefined || options.key !== undefined)) throw Error('Studio preparation uses its fixed palette and semantic background plan. Palette and key overrides apply only to --processor local.');
  const timeout = Number(options.timeout ?? 240);
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 1800) throw Error('--timeout must be 1..1800 seconds.');
  const style = options.style ?? 'sprite';
  if (!['sprite', 'none'].includes(style)) throw Error('--style must be sprite or none.');
  const protocol = options.protocol ?? 'openai', apiKeyEnv = options.apiKeyEnv ?? 'PIXEL_IMAGE_API_KEY';
  if (!['openai', 'gemini'].includes(protocol)) throw Error('--protocol must be openai or gemini.');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) throw Error('Invalid API key environment variable name.');
  const model = options.model ?? 'nano-banana-2';
  if (typeof model !== 'string' || !model.trim() || model.length > 200 || /[\x00-\x1f\x7f]/.test(model)) throw Error('Invalid model identifier.');
  const aspectRatio = options.aspectRatio ?? '1:1', resolution = options.resolution ?? '1K';
  if (!['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'].includes(aspectRatio) || !['1K', '2K', '4K'].includes(resolution)) throw Error('Invalid aspect ratio or generation resolution.');
  const apiSize = options.apiSize;
  if (apiSize !== undefined && (!/^\d{2,5}x\d{2,5}$/.test(apiSize) || apiSize.split('x').some(n => Number(n) < 32 || Number(n) > 8192))) throw Error('Invalid API image size.');
  if (processor === 'studio' && String(size).split('x').some(n => Number(n) < 32)) throw Error('Studio logical size must be at least 32 pixels per dimension.');
  const baseUrl = options.baseUrl ?? (mode === 'studio' ? 'http://127.0.0.1:3410' : undefined);
  if (mode === 'api' && !baseUrl) throw Error('Custom API mode requires --base-url.');
  if (mode === 'api' && !process.env[apiKeyEnv]) throw Error('Set the selected API key environment variable before running.');
  if (options.providerId && !/^[A-Za-z0-9_-]{1,180}$/.test(options.providerId)) throw Error('Invalid saved provider identifier.');
  return {
    mode, processor, material, size: String(size), palette, background,
    ...(options.key ? { key: options.key } : {}), style,
    baseUrl: safeUrl(baseUrl, mode === 'studio', options.allowRemote),
    studioUrl: safeUrl(options.studioUrl ?? 'http://127.0.0.1:3410', true, options.allowRemote),
    providerId: options.providerId, protocol, model, apiKeyEnv,
    aspectRatio, resolution, apiSize, timeout,
    allowRemote: options.allowRemote === true,
  };
}

export function spritePrompt(prompt, config) {
  if (config.style === 'none') return prompt;
  const backing = config.processor === 'local' && config.background !== 'keep'
    ? `Use a perfectly uniform ${config.key ?? '#ff00ff'} chroma-key background, including all holes and open spaces. Do not use that background color on the object. No ground shadow, gradient, halo, text, border or painted checkerboard.`
    : 'Use a single plain background, no ground shadow, text, labels or painted checkerboard.';
  return `${prompt.trim()}\n\nGame sprite production constraints: one isolated complete object, generous empty margin on all four sides, consistent RPG elevated top-down view, no perspective convergence. Carefully designed pixel clusters, clean stepped silhouettes, thin structures and intentional openings, a restrained material palette, no blurry interpolation or scattered noise. Preserve identifiable local Chinese rural materials and small details. ${backing} This is source artwork; a separate deterministic program will restore the final logical pixel grid.`;
}

async function saveState(dir, state) {
  const temporary = path.join(dir, '.workflow-' + process.pid + '-' + Date.now() + '.json');
  await fs.writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await fs.rename(temporary, path.join(dir, 'workflow.json'));
}
async function readJson(filename) { return JSON.parse(await fs.readFile(filename, 'utf8')); }

export async function preflightStudio(config) {
  const args = [path.join(HERE, 'pixel_studio.py'), '--base-url', config.studioUrl];
  if (config.allowRemote) args.push('--allow-remote');
  args.push('--http-timeout', '15', 'doctor');
  const { stdout } = await promisify(execFile)(process.env.PIXEL_PYTHON ?? 'python3', args, { timeout: 20000, maxBuffer: 1024 * 1024 });
  const result = JSON.parse(stdout);
  if (!result.reachable || !result.capabilities?.semanticModelReady || !result.models?.['birefnet-lite']) throw Error('Studio semantic background model is not ready. Configure it before generating, or choose local processing with a chroma backing.');
  return result;
}

export async function studioPrepare({ config, source, directory, recovery }) {
  const args = [path.join(HERE, 'pixel_studio.py'), '--base-url', config.studioUrl];
  if (config.allowRemote) args.push('--allow-remote');
  if (recovery?.jobId) args.push('resume', '--job-id', recovery.jobId);
  else {
    args.push('run', ...(source.assetId && config.mode === 'studio' && config.baseUrl.replace(/\/+$/, '') === config.studioUrl.replace(/\/+$/, '') ? ['--asset-id', source.assetId] : ['--input', source.outputPath]));
    if (config.material !== 'generic') args.push('--profile', config.material);
  }
  args.push('--output-dir', directory, '--wait', String(config.timeout));
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PIXEL_PYTHON ?? 'python3', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), (config.timeout + 90) * 1000);
    child.stdout.on('data', b => { stdout = (stdout + b).slice(-2 * 1024 * 1024); });
    child.stderr.on('data', b => { stderr = (stderr + b).slice(-4096); });
    child.once('error', error => { clearTimeout(timer); reject(Error('Python adapter could not start: ' + secretSafe(error.message))); });
    child.once('close', async code => {
      clearTimeout(timer);
      let report;
      try { report = await readJson(path.join(directory, 'run-report.json')); }
      catch { try { report = JSON.parse(stdout); } catch { report = { status: 'adapter-error', error: secretSafe(stderr || 'Adapter did not leave a report.') }; } }
      if (code !== 0 || report.status !== 'succeeded') return resolve({ ok: false, ...report });
      resolve({ ok: true, ...report, output: report.downloads?.[0]?.path });
    });
  });
}

async function verifyOutput(filename, config) {
  if (!filename) throw Error('Processing did not return a saved output PNG.');
  const inspected = await inspectFile(filename);
  if (inspected.partialAlphaPixels || inspected.hiddenRgbPixels || !inspected.visiblePixels) throw Error('Export failed native alpha or subject validation.');
  if (config.background !== 'keep' && inspected.visiblePixels === inspected.width * inspected.height) throw Error('Export has no transparent pixels; do not report successful cutout.');
  return inspected;
}

async function advance(directory, state, options, dependencies, recovering) {
  const generate = dependencies.generateImage ?? generateImage;
  const resume = dependencies.resumeGeneration ?? resumeGeneration;
  const processLocal = dependencies.runPipeline ?? runPipeline;
  const prepare = dependencies.studioPrepare ?? studioPrepare;
  const verify = dependencies.verifyOutput ?? verifyOutput;
  const config = state.config;
  try {
    if (!state.generation) {
      state.status = 'generating'; await saveState(directory, state);
      const logical = config.size.split('x').map(Number);
      const generationStandard = config.mode === 'studio' && config.processor === 'studio' && config.style === 'sprite'
        ? { version: 1, enabled: true, view: 'rpg-top-down', logicalWidth: logical[0], logicalHeight: logical[1] ?? logical[0], outline: 'material', background: 'neutral' } : undefined;
      const generationOptions = { ...config, size: config.apiSize, outputDir: path.join(directory, 'generation'), prompt: state.effectivePrompt, ...(generationStandard ? { generationStandard } : {}) };
      state.generation = recovering ? await resume(generationOptions) : await generate(generationOptions);
      state.generation.outputPath = path.resolve(state.generation.outputPath);
      const sourceBytes = await fs.readFile(state.generation.outputPath);
      if (sha(sourceBytes) !== state.generation.sourceSha256) throw Error('Generated source hash does not match its generation record.');
      state.status = 'generated'; await saveState(directory, state);
    } else {
      if (sha(await fs.readFile(state.generation.outputPath)) !== state.generation.sourceSha256) throw Error('Frozen generated source changed; do not continue processing it.');
    }
    if (state.processing?.status === 'succeeded') {
      if (sha(await fs.readFile(state.processing.output)) !== state.final.sha256) throw Error('Completed export changed; keep its original bundle.');
      return { ok: true, ...state, outputDirectory: directory, resumedWithoutGeneration: recovering };
    }
    if (state.processing && config.processor === 'studio' && !state.processing.jobId) {
      const prior = await readJson(path.join(state.processing.attemptDir, 'run-report.json')).catch(() => null);
      if (prior?.jobId) state.processing.jobId = prior.jobId;
      else throw Error('Prior Studio preparation has no known job ID. Inspect its report and server history; automatic resubmission is disabled.');
    }
    state.status = 'processing';
    const previous = state.processing;
    const attempt = (previous?.attempt ?? 0) + 1;
    const attemptDir = path.join(directory, 'prepare-' + attempt);
    state.processing = { status: 'running', attempt, attemptDir, ...(previous?.jobId ? { jobId: previous.jobId } : {}) };
    await saveState(directory, state);
    let result;
    if (config.processor === 'local') {
      result = await processLocal({ input: state.generation.outputPath, 'output-dir': attemptDir, size: config.size, material: config.material, palette: config.palette, background: config.background, ...(config.key ? { key: config.key } : {}) });
    } else result = await prepare({ config, source: state.generation, directory: attemptDir, recovery: previous });
    if (!result.ok) {
      state.processing = { ...state.processing, status: result.status ?? 'failed', ...(result.jobId ? { jobId: result.jobId } : {}), report: result };
      throw Error(result.error ?? 'Processing is incomplete; resume the saved job.');
    }
    const final = await verify(result.output, config);
    state.processing = { ...state.processing, status: 'succeeded', output: result.output, ...(result.jobId ? { jobId: result.jobId } : {}), report: result };
    state.final = final;
    state.status = 'succeeded'; state.completedAt = new Date().toISOString();
    state.qualityStatus = 'candidate-needs-visual-review';
    delete state.error;
    await saveState(directory, state);
    return { ok: true, ...state, outputDirectory: directory, resumedWithoutGeneration: recovering };
  } catch (error) {
    state.error = secretSafe(error.message);
    state.status = state.generation ? 'processing-incomplete' : 'generation-incomplete';
    state.recovery = 'Use resume --output-dir on this same run. Never repeat run to recover a paid request.';
    await saveState(directory, state);
    throw Error(state.error + ' Run record: ' + path.join(directory, 'workflow.json'));
  }
}

export async function runWorkflow(options, dependencies = {}) {
  const config = workflowConfig(options);
  if (!options.outputDir) throw Error('run requires --output-dir NEW_DIRECTORY.');
  if (Boolean(options.prompt) === Boolean(options.promptFile)) throw Error('Provide exactly one --prompt or --prompt-file.');
  const prompt = options.promptFile ? await fs.readFile(options.promptFile, 'utf8') : options.prompt;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 28000) throw Error('Prompt must contain 1..28000 characters.');
  if (config.mode === 'api' && !config.baseUrl) throw Error('Custom API mode requires --base-url.');
  if (config.mode === 'studio' && !config.providerId) throw Error('Studio mode requires --provider-id; use pixel_generate.mjs providers first.');
  const effectivePrompt = spritePrompt(prompt, config);
  const key = config.mode === 'api' ? process.env[config.apiKeyEnv] : '';
  if (key && (prompt.includes(key) || effectivePrompt.includes(key))) throw Error('Prompt must not contain the API credential.');
  if (config.processor === 'studio') await (dependencies.preflightStudio ?? preflightStudio)(config);
  const directory = path.resolve(options.outputDir);
  await fs.mkdir(path.dirname(directory), { recursive: true });
  await fs.mkdir(directory); // Do not reuse or overwrite an earlier paid run.
  const state = { producer: 'pixel-asset-pipeline', version: VERSION, startedAt: new Date().toISOString(), status: 'created', config, prompt, effectivePrompt };
  await saveState(directory, state);
  return advance(directory, state, options, dependencies, false);
}

export async function resumeWorkflow(options, dependencies = {}) {
  if (!options.outputDir) throw Error('resume requires the existing --output-dir.');
  const directory = path.resolve(options.outputDir), state = await readJson(path.join(directory, 'workflow.json'));
  if (state.producer !== 'pixel-asset-pipeline' || !['0.2.0', VERSION].includes(state.version) || !state.config) throw Error('Unknown workflow record.');
  return advance(directory, state, options, dependencies, true);
}

const FLAGS = new Map(Object.entries({ 'output-dir': 'outputDir', 'prompt-file': 'promptFile', 'base-url': 'baseUrl', 'studio-url': 'studioUrl', 'provider-id': 'providerId', 'api-key-env': 'apiKeyEnv', 'aspect-ratio': 'aspectRatio', 'api-size': 'apiSize', 'allow-remote': 'allowRemote' }));
function parse(argv) {
  const command = argv.shift() ?? 'help', options = {}, allowed = new Set(['mode', 'processor', 'model', 'protocol', 'prompt', 'size', 'material', 'palette', 'background', 'key', 'resolution', 'timeout', 'style', ...FLAGS.keys()]);
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || !allowed.has(name)) throw Error('Unknown option: ' + argv[i]);
    const key = FLAGS.get(name) ?? name;
    if (Object.hasOwn(options, key)) throw Error('Duplicate option: ' + name);
    if (name === 'allow-remote') options[key] = true;
    else { const value = argv[++i]; if (!value || value.startsWith('--')) throw Error('Missing value for --' + name); options[key] = value; }
  }
  return { command, options };
}
export async function cliMain(argv) {
  const { command, options } = parse([...argv]);
  if (['help', '--help', '-h'].includes(command)) return { ok: true, version: VERSION, commands: { run: '--mode studio --provider-id ID --prompt-file brief.txt --output-dir NEW_DIRECTORY [--model nano-banana-2] [--processor local|studio] [--size 256] [--material bamboo]', customAPI: 'run --mode api --protocol openai|gemini --base-url URL --api-key-env PIXEL_IMAGE_API_KEY --prompt-file brief.txt --output-dir NEW_DIRECTORY', resume: '--output-dir EXISTING_DIRECTORY (poll/download/prepare only; never generates again)' }, note: 'Local sprite style requests a uniform chroma backing. Semantic cutout requires an existing Studio service. Inspect every final PNG.' };
  if (command === 'run') return runWorkflow(options);
  if (command === 'resume') { if (Object.keys(options).some(k => k !== 'outputDir')) throw Error('resume uses saved configuration; pass only --output-dir.'); return resumeWorkflow(options); }
  throw Error('Unknown command: ' + command);
}
if (process.argv[1] && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) cliMain(process.argv.slice(2)).then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(error => { process.stderr.write(JSON.stringify({ ok: false, error: secretSafe(error.message) }) + '\n'); process.exitCode = 1; });
