import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { generateImage, resumeGeneration, generationStatus, generationDoctor, listProviders, cliMain } from '../skills/pixel-asset-pipeline/scripts/pixel_generate.mjs';

const SECRET = 'sk-unit-test-credential-never-log';
process.env.PIXEL_GENERATE_TEST_KEY = SECRET;
const png = await sharp({ create: { width: 64, height: 48, channels: 4, background: { r: 20, g: 80, b: 130, alpha: 1 } } }).png().toBuffer();
const json = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
async function fixture(t, handler) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixel gen 测试 '));
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    const bodyText = Buffer.concat(parts).toString();
    let body; try { body = JSON.parse(bodyText); } catch {}
    const info = { url: req.url, method: req.method, headers: req.headers, body };
    requests.push(info);
    try { await handler(req, res, info, requests); } catch (e) { json(res, { error: e.message }, 500); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  return { root, baseUrl, requests, outputDir: path.join(root, 'generation') };
}
const api = f => ({ mode: 'api', protocol: 'openai', baseUrl: f.baseUrl + '/v1', apiKeyEnv: 'PIXEL_GENERATE_TEST_KEY', prompt: 'One isolated rural ceramic jar on a plain background.', outputDir: f.outputDir });

test('OpenAI compatible API sends exact nano-banana-2 once and exports original frame', async t => {
  const f = await fixture(t, (_req, res) => json(res, { data: [{ b64_json: png.toString('base64') }] }));
  const result = await generateImage(api(f));
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, '/v1/images/generations');
  assert.deepEqual(f.requests[0].body, { model: 'nano-banana-2', prompt: api(f).prompt, n: 1, size: '1024x1024' });
  assert.equal(f.requests[0].headers.authorization, `Bearer ${SECRET}`);
  assert.deepEqual((({ width, height }) => ({ width, height }))(await sharp(result.outputPath).metadata()), { width: 64, height: 48 });
  const manifest = await fs.readFile(result.manifestPath, 'utf8');
  assert.ok(!manifest.includes(SECRET));
  assert.equal(JSON.parse(manifest).requestCount, 1);
  assert.equal(JSON.parse(manifest).status, 'succeeded');
  assert.deepEqual(await resumeGeneration({ outputDir: f.outputDir }), result);
  assert.equal(f.requests.length, 1);
});

test('Gemini native custom endpoint uses header credential and one image modality request', async t => {
  const f = await fixture(t, (_req, res) => json(res, { candidates: [{ content: { parts: [{ text: 'ready' }, { inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }] }));
  await generateImage({ ...api(f), protocol: 'gemini', baseUrl: f.baseUrl + '/v1beta', model: 'nano-banana-2', aspectRatio: '4:3', resolution: '2K' });
  assert.equal(f.requests[0].url, '/v1beta/models/nano-banana-2:generateContent');
  assert.equal(f.requests[0].headers['x-goog-api-key'], SECRET);
  assert.equal(f.requests[0].headers.authorization, undefined);
  assert.deepEqual(f.requests[0].body.generationConfig.imageConfig, { aspectRatio: '4:3', imageSize: '2K' });
});

test('Returned media request never forwards provider auth and normalizes JPEG to PNG', async t => {
  const jpeg = await sharp(png).jpeg().toBuffer();
  const f = await fixture(t, (_req, res, info) => {
    if (info.url === '/image.jpg') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end(jpeg); }
    else json(res, { data: [{ url: f.baseUrl + '/image.jpg' }] });
  });
  const result = await generateImage(api(f));
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].headers.authorization, undefined);
  assert.equal(f.requests[1].headers['x-goog-api-key'], undefined);
  assert.equal((await sharp(result.outputPath).metadata()).format, 'png');
});

test('Studio uses saved connection, model override, logical standard and same job polling', async t => {
  const standard = { version: 1, enabled: true, logicalWidth: 128, logicalHeight: 128, view: 'rpg-top-down', outline: 'material', background: 'neutral' };
  let polls = 0;
  const f = await fixture(t, (_req, res, info) => {
    if (info.url === '/api/studio/settings') json(res, { providers: [{ id: 'conn-1', name: 'Saved image provider', model: 'gpt-image-2', protocol: 'openai', enabled: true, hasKey: true }] });
    else if (info.url === '/api/studio/generate') json(res, { jobId: 'job-1', status: 'queued' }, 202);
    else if (info.url === '/api/studio/jobs/job-1') json(res, { id: 'job-1', status: ++polls < 2 ? 'running' : 'succeeded', progress: 100, assets: [{ id: 'asset-1' }] });
    else { assert.equal(info.url, '/api/studio/assets/asset-1/file'); res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(png); }
  });
  const result = await generateImage({ mode: 'studio', providerId: 'conn-1', baseUrl: f.baseUrl, prompt: 'A bamboo tray', outputDir: f.outputDir, generationStandard: standard, pollIntervalMs: 1 });
  const submitted = f.requests.find(r => r.method === 'POST');
  assert.equal(submitted.body.model, 'nano-banana-2');
  assert.deepEqual(submitted.body.generationStandard, standard);
  assert.equal(submitted.headers.authorization, undefined);
  assert.equal(result.assetId, 'asset-1'); assert.equal(result.jobId, 'job-1');
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
});

test('Studio timeout persists known job; resume only GETs same job and downloads', async t => {
  let finished = false;
  const f = await fixture(t, (_req, res, info) => {
    if (info.url === '/api/studio/settings') json(res, { providers: [{ id: 'conn-1', name: 'Saved', model: 'nano-banana-2', protocol: 'openai', enabled: true, hasKey: true }] });
    else if (info.url === '/api/studio/generate') json(res, { jobId: 'job-1', status: 'queued' });
    else if (info.url === '/api/studio/jobs/job-1') json(res, { id: 'job-1', status: finished ? 'succeeded' : 'running', assets: [{ id: 'asset-1' }] });
    else { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(png); }
  });
  await assert.rejects(generateImage({ mode: 'studio', baseUrl: f.baseUrl, prompt: 'A stool', outputDir: f.outputDir, timeout: 0.08, pollIntervalMs: 30 }), /Polling timed out/);
  const state = await generationStatus({ outputDir: f.outputDir });
  assert.equal(state.jobId, 'job-1'); assert.equal(state.requestCount, 1);
  finished = true;
  const result = await resumeGeneration({ outputDir: f.outputDir });
  assert.equal(result.jobId, 'job-1');
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
});

test('Network timeout records unknown submission and never silently regenerates', async t => {
  const f = await fixture(t, () => {});
  await assert.rejects(generateImage({ ...api(f), timeout: 0.03 }), /without retry/);
  const state = await generationStatus({ outputDir: f.outputDir });
  assert.equal(state.status, 'submission-unknown'); assert.equal(state.requestCount, 1);
  await assert.rejects(resumeGeneration({ outputDir: f.outputDir }), /No known job/);
  await assert.rejects(generateImage(api(f)), /already exists/);
  assert.equal(f.requests.length, 1);
});

test('Provider errors redact arbitrary configured credential in errors and manifest', async t => {
  const f = await fixture(t, (_req, res) => json(res, { error: { message: 'Bad auth ' + SECRET } }, 500));
  const rejected = await generateImage(api(f)).catch(e => e);
  assert.ok(!rejected.message.includes(SECRET));
  assert.ok(!JSON.stringify(await generationStatus({ outputDir: f.outputDir })).includes(SECRET));
  assert.equal((await generationStatus({ outputDir: f.outputDir })).status, 'rejected');
  assert.equal(f.requests.length, 1);
});

test('No request for unsafe base, missing key, unknown flag or pre-existing output', async t => {
  const f = await fixture(t, (_req, res) => json(res, { data: [] }));
  await assert.rejects(generateImage({ ...api(f), baseUrl: f.baseUrl + '/v1?key=nope' }), /cannot contain/);
  await assert.rejects(generateImage({ ...api(f), baseUrl: 'http://example.com/v1' }), /HTTPS/);
  await assert.rejects(generateImage({ ...api(f), apiKeyEnv: 'PIXEL_GENERATE_MISSING_KEY' }), /environment variable/);
  await fs.mkdir(f.outputDir);
  await assert.rejects(generateImage(api(f)), /already exists/);
  await assert.rejects(cliMain(['generate', '--api-key', SECRET]), /Unknown/);
  assert.equal(f.requests.length, 0);
});

test('API redirects are rejected and credential cannot enter returned media URL', async t => {
  const f = await fixture(t, (_req, res, info) => {
    if (info.url === '/v1/images/generations') { res.writeHead(307, { Location: '/destination' }); res.end(); }
    else json(res, {});
  });
  await assert.rejects(generateImage(api(f)), /without retry/);
  assert.equal(f.requests.length, 1);
  const second = await fixture(t, (_req, res) => json(res, { data: [{ url: second.baseUrl + '/image?token=' + SECRET }] }));
  await assert.rejects(generateImage(api(second)), /credential in a media URL/);
  assert.equal(second.requests.length, 1);
  assert.ok(!(await fs.readFile(path.join(second.outputDir, 'generation.json'), 'utf8')).includes(SECRET));
});

test('Status and resume verify recorded output hash without contacting provider', async t => {
  const f = await fixture(t, (_req, res) => json(res, { data: [{ b64_json: png.toString('base64') }] }));
  await generateImage(api(f));
  await fs.writeFile(path.join(f.outputDir, 'source.png'), 'changed');
  await assert.rejects(resumeGeneration({ outputDir: f.outputDir }), /hash does not match/);
  assert.equal(f.requests.length, 1);
});

test('Doctor reports API configuration without generating and model list is bounded metadata', async t => {
  const f = await fixture(t, (_req, res) => json(res, { data: [{ id: 'nano-banana-2' }, { id: 'other-model' }] }));
  const result = await generationDoctor(api(f));
  assert.equal(result.connectivityChecked, false); assert.equal(result.keyPresent, true); assert.equal(f.requests.length, 0);
  assert.deepEqual(await listProviders(api(f)), [{ model: 'nano-banana-2' }, { model: 'other-model' }]);
  assert.equal(f.requests[0].url, '/v1/models');
});

test('Custom API media download resumes encrypted descriptor without another generation', async t => {
  let ready = false;
  const signedPart = 'temporary-private-media-signature';
  const f = await fixture(t, (_req, res, info) => {
    if (info.url.startsWith('/image?')) {
      assert.equal(info.headers.authorization, undefined);
      if (!ready) json(res, { error: 'temporary media failure' }, 503);
      else { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(png); }
    } else json(res, { data: [{ url: f.baseUrl + '/image?signature=' + signedPart }] });
  });
  await assert.rejects(generateImage(api(f)), /HTTP 503/);
  const raw = await fs.readFile(path.join(f.outputDir, 'generation.json'), 'utf8');
  assert.ok(!raw.includes(signedPart)); assert.ok(!raw.includes(SECRET));
  assert.equal(JSON.parse(raw).status, 'downloading');
  assert.ok(JSON.parse(raw).sealedMedia.data);
  const state = await generationStatus({ outputDir: f.outputDir });
  assert.equal(state.requestCount, 1);
  ready = true;
  const result = await resumeGeneration({ outputDir: f.outputDir });
  assert.equal((await sharp(result.outputPath).metadata()).width, 64);
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
  assert.equal(f.requests.filter(r => r.url.startsWith('/image?')).length, 2);
});

test('Resume rejects modified encrypted media state or changed API key without transmission', async t => {
  const f = await fixture(t, (_req, res, info) => info.url.startsWith('/image') ? json(res, { error: 'later' }, 503) : json(res, { data: [{ url: f.baseUrl + '/image?signature=private' }] }));
  await assert.rejects(generateImage(api(f)), /HTTP 503/);
  const count = f.requests.length;
  const previous = process.env.PIXEL_GENERATE_TEST_KEY;
  process.env.PIXEL_GENERATE_TEST_KEY = 'another-credential';
  try { await assert.rejects(resumeGeneration({ outputDir: f.outputDir }), /same API key/); }
  finally { process.env.PIXEL_GENERATE_TEST_KEY = previous; }
  assert.equal(f.requests.length, count);
});
