import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildBrief, listTemplates } from '../scripts/ui-brief.mjs';

test('all 12 briefs reproduce the real compiler output for both backgrounds', async () => {
  const templates = await listTemplates();
  assert.equal(templates.length, 12);
  for (const item of templates) {
    const record = JSON.parse(await readFile(new URL('../' + item.path, import.meta.url), 'utf8'));
    for (const background of ['transparent', 'neutral']) {
      const brief = await buildBrief({ id: item.id, background });
      assert.equal(brief.prompt, record.compiled[background].defaultPrompt);
      assert.deepEqual(brief.standardSnapshot, record.compiled[background].standardSnapshot);
      assert.equal(brief.generationStandard.background, background);
      assert.equal(brief.generationStandard.uiPreset, item.id);
      assert.deepEqual(brief.references, []);
      for (const note of [...record.interactionNotes, ...record.stateNotes]) assert.ok(!brief.prompt.includes(note));
    }
  }
});

test('custom subjects preserve layout rules while never injecting research images', async () => {
  const subject = '我的青绿色乡村背包，保留米白与竹木。';
  const brief = await buildBrief({ id: 'game-ui-inventory-wood-paper', subject, background: 'neutral' });
  assert.equal(brief.userPrompt, subject);
  assert.ok(brief.prompt.startsWith(subject + '\n\n'));
  assert.ok(brief.prompt.includes('4列4行'));
  assert.ok(brief.prompt.includes('中性浅灰纯色背景'));
  assert.ok(!brief.prompt.includes('https://'));
  assert.deepEqual(brief.references, []);
});

test('rejects unknown/path-traversal IDs, invalid backgrounds and empty or oversized subjects', async () => {
  for (const id of ['unknown', '../README', '__proto__']) await assert.rejects(buildBrief({ id }), /Unknown template/);
  await assert.rejects(buildBrief({ id: 'game-ui-inventory-wood-paper', background: 'magenta' }), /Background/);
  await assert.rejects(buildBrief({ id: 'game-ui-inventory-wood-paper', subject: ' ' }), /nonempty/);
  await assert.rejects(buildBrief({ id: 'game-ui-inventory-wood-paper', subject: 'a'.repeat(32000) }), /32000/);
});
