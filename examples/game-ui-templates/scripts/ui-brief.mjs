#!/usr/bin/env node
// Local brief preparation only: no provider, credentials or image generation.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function listTemplates() {
  const index = JSON.parse(await readFile(path.join(root, 'templates/index.json'), 'utf8'));
  if (index.schemaVersion !== 1 || !Array.isArray(index.templates)) throw new Error('Unsupported UI template index');
  return index.templates;
}

export async function buildBrief({ id, subject, background = 'transparent' }) {
  if (!['transparent', 'neutral'].includes(background)) throw new Error('Background must be transparent or neutral');
  const entry = (await listTemplates()).find(item => item.id === id);
  if (!entry) throw new Error('Unknown template ID; run list first');
  const record = JSON.parse(await readFile(path.join(root, entry.path), 'utf8'));
  if (record.schemaVersion !== 1 || record.id !== id || record.artifactType !== 'static-game-ui-art-brief') throw new Error('Invalid UI template record');
  const text = subject === undefined ? record.subject : subject;
  if (typeof text !== 'string' || !text.trim()) throw new Error('Subject must be nonempty text');
  const compiled = record.compiled[background];
  const prompt = text + '\n\n' + compiled.constraintBlock;
  if (prompt.length > 32000) throw new Error('Combined prompt exceeds 32000 characters');
  return {
    schemaVersion: 1, artifactType: record.artifactType, templateId: id,
    userPrompt: text, prompt, aspectRatio: record.aspectRatio,
    generationStandard: { ...compiled.standardSnapshot.options },
    standardSnapshot: compiled.standardSnapshot,
    references: [],
    interactionReview: record.interactionNotes, stateReview: record.stateNotes,
    provenance: record.provenance,
    notice: 'Prepared text only; no image API call, runnable game UI or artwork acceptance is implied. Research images are not provider inputs.',
  };
}

export async function main(argv) {
  const command = argv.shift();
  if (!command || ['help', '--help', '-h'].includes(command)) {
    console.log('ui-brief.mjs list\nui-brief.mjs build --id <template> [--subject <text>] [--background transparent|neutral] [--format json|prompt] [--out <new-file>]'); return;
  }
  if (command === 'list') {
    if (argv.length) throw new Error('list does not accept options');
    console.log(JSON.stringify(await listTemplates(), null, 2)); return;
  }
  if (command !== 'build') throw new Error('Unknown command');
  const allowed = new Set(['--id', '--subject', '--background', '--format', '--out']), args = {};
  while (argv.length) {
    const key = argv.shift(), value = argv.shift();
    if (!allowed.has(key) || value === undefined || value.startsWith('--') || key in args) throw new Error('Invalid, duplicate or missing option');
    args[key] = value;
  }
  const format = args['--format'] ?? 'json';
  if (!['json', 'prompt'].includes(format)) throw new Error('Format must be json or prompt');
  const brief = await buildBrief({ id: args['--id'], subject: args['--subject'], background: args['--background'] });
  const output = (format === 'prompt' ? brief.prompt : JSON.stringify(brief, null, 2)) + '\n';
  if (args['--out']) await writeFile(path.resolve(args['--out']), output, { encoding: 'utf8', flag: 'wx' });
  else process.stdout.write(output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
