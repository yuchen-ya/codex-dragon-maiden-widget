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
