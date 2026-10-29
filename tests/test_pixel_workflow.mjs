import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runWorkflow, resumeWorkflow, workflowConfig } from '../skills/pixel-asset-pipeline/scripts/pixel_workflow.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '像素 workflow '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const width = 64, data = Buffer.alloc(width * width * 4);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const inObject = x >= 12 && x < 52 && y >= 8 && y < 56;
    const hole = x >= 24 && x < 40 && y >= 20 && y < 36;
    const color = inObject && !hole ? [160, 110, 50, 255] : [255, 0, 255, 255];
    data.set(color, (y * width + x) * 4);
  }
  const png = await sharp(data, { raw: { width, height: width, channels: 4 } }).png().toBuffer();
  let requests = 0;
  const generateImage = async options => {
    requests++;
    await fs.mkdir(options.outputDir);
    const outputPath = path.join(options.outputDir, 'source.png'); await fs.writeFile(outputPath, png);
    return { outputPath, sourceSha256: sha(png), model: options.model, protocol: 'openai', jobId: 'known-job' };
  };
  return { root, png, generateImage, count: () => requests };
}

test('single generation to native transparent PNG, then completed resume never regenerates', async t => {
  const f = await fixture(t), outputDir = path.join(f.root, 'run');
  const result = await runWorkflow({ mode: 'studio', providerId: 'saved-id', prompt: 'a basket', outputDir, size: '32x32' }, { generateImage: f.generateImage });
  assert.equal(f.count(), 1); assert.equal(result.status, 'succeeded');
  assert.equal(result.final.width, 32); assert.equal(result.final.height, 32);
  assert.equal(result.final.partialAlphaPixels, 0); assert.equal(result.final.hiddenRgbPixels, 0);
  const pixels = await sharp(result.processing.output).ensureAlpha().raw().toBuffer();
  assert.equal(pixels[(14 * 32 + 14) * 4 + 3], 0, 'enclosed hole remains transparent');
  assert.equal(pixels[(8 * 32 + 8) * 4 + 3], 255, 'foreground survives');
  assert.deepEqual(await fs.readFile(result.generation.outputPath), f.png, 'source bytes frozen');
  const resumed = await resumeWorkflow({ outputDir }, { generateImage: () => { throw Error('must not generate'); } });
  assert.equal(resumed.status, 'succeeded'); assert.equal(f.count(), 1);
  assert.equal(resumed.final.sha256, result.final.sha256);
});

test('generation timeout recovers known result without invoking generation twice', async t => {
  const f = await fixture(t), outputDir = path.join(f.root, 'run'); let posts = 0, collections = 0;
  await assert.rejects(runWorkflow({ providerId: 'saved-id', prompt: 'a basket', outputDir, size: '32' }, { generateImage: async () => { posts++; throw Error('waiting for known-job'); } }), /known-job/);
  const result = await resumeWorkflow({ outputDir }, {
    generateImage: () => { posts++; throw Error('no'); },
    resumeGeneration: async options => { collections++; return f.generateImage(options); },
  });
  assert.equal(posts, 1); assert.equal(collections, 1); assert.equal(result.status, 'succeeded');
});

test('source tampering prevents processing or successful completed resume', async t => {
  const f = await fixture(t), outputDir = path.join(f.root, 'run');
  const result = await runWorkflow({ providerId: 'saved-id', prompt: 'a basket', outputDir, size: '32' }, { generateImage: f.generateImage });
  await fs.appendFile(result.generation.outputPath, 'changed');
  await assert.rejects(resumeWorkflow({ outputDir }), /Frozen generated source changed/);
  assert.equal(f.count(), 1);
});

test('sensitive URLs and a key inside prompt are rejected before writing run records', async t => {
  const f = await fixture(t), variable = 'PIXEL_WORKFLOW_TEST_KEY';
  process.env[variable] = 'not-a-standard-prefix-test-secret'; t.after(() => delete process.env[variable]);
  assert.throws(() => workflowConfig({ mode: 'api', apiKeyEnv: variable, baseUrl: 'https://relay.example/v1?key=secret' }), /URLs cannot contain/);
  const outputDir = path.join(f.root, 'secret-run');
  await assert.rejects(runWorkflow({ mode: 'api', baseUrl: 'https://relay.example/v1', apiKeyEnv: variable, prompt: 'oops ' + process.env[variable], outputDir }), /Prompt must not contain/);
  await assert.rejects(fs.stat(outputDir), { code: 'ENOENT' });
});

test('missing Studio processing prerequisite stops before generation or output creation', async t => {
  const f = await fixture(t), outputDir = path.join(f.root, 'run'); let generated = 0;
  await assert.rejects(runWorkflow({ providerId: 'saved-id', processor: 'studio', prompt: 'a basket', outputDir }, { generateImage: async () => { generated++; }, preflightStudio: async () => { throw Error('Python/model not ready'); } }), /not ready/);
  assert.equal(generated, 0); await assert.rejects(fs.stat(outputDir), { code: 'ENOENT' });
});

test('existing output cannot trigger another request or overwrite a result', async t => {
  const f = await fixture(t), outputDir = path.join(f.root, 'run'); await fs.mkdir(outputDir);
  await assert.rejects(runWorkflow({ providerId: 'saved-id', prompt: 'a basket', outputDir }, { generateImage: f.generateImage }), { code: 'EEXIST' });
  assert.equal(f.count(), 0);
});

test('all public Node entry points execute through a symlink directory with JSON output', async t => {
  const f = await fixture(t), alias = path.join(f.root, '技能 链接');
  const scripts = fileURLToPath(new URL('../skills/pixel-asset-pipeline/scripts/', import.meta.url));
  await fs.symlink(scripts, alias, 'dir');
  for (const name of ['pixel_local.mjs', 'pixel_generate.mjs', 'pixel_workflow.mjs']) {
    const stdout = execFileSync(process.execPath, [path.join(alias, name), '--help'], { encoding: 'utf8' });
    assert.ok(JSON.parse(stdout).commands, name + ' must actually run, not exit silently');
  }
});
