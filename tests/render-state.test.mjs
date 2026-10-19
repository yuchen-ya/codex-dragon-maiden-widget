import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { UiStateStore } = require('../desktop/ui-state-store.cjs');

test('UI state flush preserves the newest update across queued asynchronous writes', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-render-state-'));
  t.after(async () => {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('whale-render-state-'));
    await fs.rm(resolved, { recursive: true });
  });
  const file = path.join(directory, 'ui-state.json'), store = new UiStateStore(file);
  store.set({ 'dshw-pos': 'old', secret: 'not accepted' });
  const first = store.flush();
  for (let i = 0; i < 100; i++) store.set({ 'dshw-pos': String(i), 'dshw-role': 'default' });
  await Promise.all([first, store.flush()]);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { 'dshw-pos': '99', 'dshw-role': 'default' });
  assert.deepEqual(new UiStateStore(file).get(), store.get());
  assert.deepEqual(await fs.readdir(directory), ['ui-state.json']);
});

test('UI state ignores invalid updates without discarding the cached settings', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-render-state-'));
  t.after(async () => {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('whale-render-state-'));
    await fs.rm(resolved, { recursive: true });
  });
  const store = new UiStateStore(path.join(directory, 'ui-state.json'));
  store.set({ 'dshw-pos': 'saved' }); store.set(null); store.set([]); store.set('bad');
  await store.flush(); assert.equal(store.get()['dshw-pos'], 'saved');
});
