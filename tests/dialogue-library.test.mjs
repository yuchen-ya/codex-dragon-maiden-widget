import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import core from '../lib/dialogue-core.cjs';
import { loadDialogueLibrary } from '../runtime/dialogue-library.mjs';
import { chooseReaction, REACTION_QUESTIONS } from '../runtime/reaction-policy.mjs';

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialogue-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('editable personal library is initialized once and retained instead of overwritten by defaults', t => {
  const dataDir = directory(t);
  const builtin = loadDialogueLibrary({ dataDir });
  assert.equal(builtin.groups.quotes.length, 52);
  const custom = { version: 1, groups: { tail_pull: [{ id: 'custom', text: '{title}，不许拽。' }] } };
  fs.writeFileSync(path.join(dataDir, 'dialogue-custom.json'), JSON.stringify(custom));
  const loaded = loadDialogueLibrary({ dataDir });
  assert.equal(loaded.groups.tail_pull[0].text, '{title}，不许拽。');
  assert.equal(loaded.groups.quotes.length, 0);
  assert.equal(core.render(loaded.groups.tail_pull[0].text, '主人'), '主人，不许拽。');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'dialogue-custom.json'))), custom);
});

test('missing or malformed libraries and invalid individual entries disable only unavailable dialogue', t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const dir = directory(t), file = path.join(dir, 'edited.json');
  assert.equal(loadDialogueLibrary({ file }).groups.task.length, 0);
  fs.writeFileSync(file, '{PRIVATE_BROKEN_CONTENT');
  assert.equal(loadDialogueLibrary({ file }).groups.task.length, 0);
  fs.writeFileSync(file, JSON.stringify({ version: 1, groups: {
    task: [{ id: 'empty', text: '  ' }, { id: 'broken', text: '{unknown}' }, { id: 'huge', text: '长'.repeat(1001) },
      { id: 'valid', text: ' {title}，继续。 ' }, { id: 'valid', text: 'duplicate' }], tail_pull: null
  } }));
  const library = loadDialogueLibrary({ file });
  assert.equal(library.groups.task.length, 1);
  assert.equal(library.groups.tail_pull.length, 0);
  assert.ok(!JSON.stringify(warn.mock.calls).includes('PRIVATE_BROKEN_CONTENT'));
  fs.writeFileSync(file, ' '.repeat(1024 * 1024 + 1));
  assert.equal(loadDialogueLibrary({ file }).groups.task.length, 0);
});

test('address substitution is literal, bounded and does not reinterpret custom text as markup', () => {
  assert.equal(core.addressTitle(undefined), '老大');
  assert.equal(core.addressTitle('  '), '老大');
  assert.equal(core.addressTitle(' 主人 ', true), '主人');
  for (const value of ['称'.repeat(13), '{title}', '两\n行', null]) assert.throws(() => core.addressTitle(value, true));
  assert.equal(core.render('{title}，{title}。', '$&'), '$&，$&。');
  assert.equal(core.render('{title}，好。', '<主人>'), '<主人>，好。');
  const long = core.render('😀'.repeat(100));
  assert.equal([...long].length, 80); assert.ok(long.endsWith('…'));
});

test('edited reaction IDs, one remaining line and a deleted scene work without fixed ID assumptions', () => {
  const answers = { hold_back: { type: 'noul', noul: 0 } };
  for (const [name, choice] of Object.entries({ relation: 'unavailable', emotion: 'weak_or_none', occasion: 'task', mood: 'neutral', intent: 'instruct' })) {
    answers[name] = { type: 'choice', choice, probabilities: Object.fromEntries(Object.keys(REACTION_QUESTIONS[name].criteria).map(key => [key, key === choice ? 1 : 0])) };
  }
  const library = core.normalizeLibrary({ version: 1, groups: { task: [{ id: 'new-line', text: '{title}，继续。' }] } });
  assert.equal(chooseReaction({ answers }, { route: 'user_only' }, 'removed-id', library).id, 'new-line');
  assert.equal(chooseReaction({ answers }, { route: 'user_only' }, 'new-line', library).id, 'new-line');
  library.groups.task = [];
  assert.equal(chooseReaction({ answers }, { route: 'user_only' }, '', library), null);
});
