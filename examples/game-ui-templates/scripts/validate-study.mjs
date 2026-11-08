#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
async function files(dir) {
  const list = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) list.push(...await files(absolute)); else list.push(absolute);
  }
  return list;
}
const paths = await files(root), byPath = new Set(paths.map(p => path.normalize(p)));
const index = JSON.parse(await readFile(path.join(root, 'templates/index.json'), 'utf8'));
const catalog = JSON.parse(await readFile(path.join(root, 'references/catalog.json'), 'utf8'));
assert.equal(index.count, 12); assert.equal(index.templates.length, 12); assert.equal(catalog.length, 15);
assert.equal(new Set(catalog.map(r => r.imageUrl.split('?')[0])).size, 14);
assert.equal(new Set(catalog.map(r => r.game.replace(': Alchemist Simulator', ''))).size, 10);
const atlas = await readFile(path.join(root, 'reference-atlas.md'), 'utf8');
for (const kind of ['inventory', 'shop', 'dialogue', 'crafting']) {
  assert.equal(index.templates.filter(t => t.kind === kind).length, 3);
  assert.ok(new Set(catalog.filter(r => r.kind === kind).map(r => r.game)).size >= 3);
}
let links = 0;
for (const file of paths.filter(p => p.endsWith('.md'))) {
  const text = await readFile(file, 'utf8');
  assert.ok(!text.includes('/Users/qian/'), `Nonportable local path in ${file}`);
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^https:\/\//.test(target)) continue;
    assert.ok(!/^[a-z]+:/.test(target), `Unexpected URI in ${file}`);
    const [relative, anchor] = target.split('#'), resolved = path.resolve(path.dirname(file), decodeURIComponent(relative || path.basename(file)));
    assert.ok(byPath.has(resolved), `Missing local link ${target} in ${file}`);
    if (anchor && resolved.endsWith('reference-atlas.md')) assert.ok(atlas.includes(`id="${anchor}"`));
    links++;
  }
}
for (const entry of index.templates) {
  const record = JSON.parse(await readFile(path.join(root, entry.path), 'utf8'));
  assert.equal(record.id, entry.id); assert.equal(record.width, entry.width); assert.equal(record.height, entry.height);
  const [w, h] = record.aspectRatio.split(':').map(Number);
  assert.equal(record.width * h, record.height * w);
  assert.equal(record.provenance.newArtworkGenerated, false);
  for (const id of record.referenceIds) assert.ok(catalog.some(r => r.id === id));
  for (const background of ['transparent', 'neutral']) {
    const compiled = record.compiled[background];
    assert.equal(compiled.standardSnapshot.options.uiPreset, entry.id);
    assert.equal(compiled.standardSnapshot.options.background, background);
    assert.equal(compiled.defaultPrompt, record.subject + '\n\n' + compiled.constraintBlock);
  }
  const svg = await readFile(path.join(root, entry.diagramPath), 'utf8');
  assert.ok(svg.includes('非生成成品')); assert.ok(!svg.includes('<script') && !svg.includes('<image'));
}
const provenance = JSON.parse(await readFile(path.join(root, 'studio-integration/PROVENANCE.json'), 'utf8'));
const patch = await readFile(path.join(root, 'studio-integration/game-ui-templates.patch'));
assert.equal(createHash('sha256').update(patch).digest('hex'), provenance.sha256);
const payloads = await Promise.all(paths.filter(p => /\.(md|json|mjs|patch|txt|svg)$/.test(p)).map(async p => [p, await readFile(p, 'utf8')]));
for (const [file, text] of payloads) assert.ok(!/sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/.test(text), `Credential-shaped string in ${file}`);
console.log(JSON.stringify({ files: paths.length, templates: 12, references: 15, uniqueScreenshots: 14, games: 10, localLinks: links, patchSha256: provenance.sha256, status: 'passed' }, null, 2));
