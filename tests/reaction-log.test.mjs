import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReactionLog } from '../runtime/reaction-log.mjs';

test('internal decision journal persists bounded records across restarts with one rotated file', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reaction-log-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = new ReactionLog({ dataDir: dir, now: () => 1234 });
  log.write({ event: 'skipped', trace: 'sample', reason: 'too-long' });
  const records = () => fs.readFileSync(log.file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(records()[0].reason, 'too-long');
  assert.equal(records()[0].at, 1234);
  new ReactionLog({ dataDir: dir, now: () => 1235 }).write({ event: 'configured', enabled: true });
  assert.equal(records().length, 2);
  const entry = { event: 'decision', decisions: { test: 'x'.repeat(1000) } };
  for (let index = 0; index < 2300; index++) log.write(entry);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['jev-reactions.jsonl', 'jev-reactions.previous.jsonl']);
  for (const name of fs.readdirSync(dir)) {
    assert.ok(fs.statSync(path.join(dir, name)).size <= 1024 * 1024);
    for (const line of fs.readFileSync(path.join(dir, name), 'utf8').trim().split('\n')) assert.ok(JSON.parse(line).event);
  }
});

test('anonymous daily classifications accumulate across restart without retaining text or depending on bubble display', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reaction-statistics-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let now = new Date(2026, 10, 5, 12).getTime();
  const decision = { event: 'decision', reason: 'hold-back', decisions: {
    mood: { choice: 'neutral', probability: .95 }, intent: { choice: 'discuss', probability: .48 }
  } };
  const log = new ReactionLog({ dataDir: dir, now: () => now });
  log.write(decision);
  new ReactionLog({ dataDir: dir, now: () => now }).write(decision);
  // Restart before changing days, as production has one writer per runtime.
  const restarted = new ReactionLog({ dataDir: dir, now: () => now });
  now = new Date(2026, 10, 6, 12).getTime(); restarted.write(decision);
  const stats = JSON.parse(fs.readFileSync(log.statisticsFile));
  assert.deepEqual(stats, { version: 1, days: {
    '2026-11-05': { total: 2, mood: { neutral: 2 }, intent: { discuss: 2 }, lowConfidence: { mood: 0, intent: 2 } },
    '2026-11-06': { total: 1, mood: { neutral: 1 }, intent: { discuss: 1 }, lowConfidence: { mood: 0, intent: 1 } }
  } });
});

test('a damaged statistics file is preserved and does not stop the decision journal', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reaction-statistics-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const warn = t.mock.method(console, 'warn', () => {});
  const log = new ReactionLog({ dataDir: dir });
  fs.writeFileSync(log.statisticsFile, '{PRIVATE_BROKEN');
  log.write({ event: 'decision', decisions: { mood: { choice: 'neutral', probability: 1 }, intent: { choice: 'ask', probability: 1 } } });
  log.write({ event: 'shown' });
  assert.equal(fs.readFileSync(log.statisticsFile, 'utf8'), '{PRIVATE_BROKEN');
  assert.equal(fs.readFileSync(log.file, 'utf8').trim().split('\n').length, 2);
  assert.equal(warn.mock.calls[0].arguments[0], 'Jev statistics disabled: INVALID_JSON');
});
