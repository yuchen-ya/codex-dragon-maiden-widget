import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createFxService, FX_URL, FX_POLICY, dailySlot, nextDailyCheck, validQuoteDate } from '../runtime/fx.mjs';

const body = (rate = 6.7, date = '2026-09-15') => ({ amount: 1, base: 'USD', date, rates: { CNY: rate } });
const response = (rate = 6.7, date = '2026-09-15') => new Response(JSON.stringify(body(rate, date)));
async function setup(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-fx-refresh-')), instances = [];
  t.after(async () => {
    for (const instance of instances) await instance.close();
    const resolved = path.resolve(dir);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('whale-fx-refresh-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  let at = Date.parse('2026-09-15T10:00:00Z');
  const clock = { now: () => at, set: value => { at = typeof value === 'number' ? value : Date.parse(value); }, advance: ms => { at += ms; } };
  const create = extra => { const fx = createFxService({ dataDir: dir, now: clock.now, ...options, ...extra }); instances.push(fx); return fx; };
  return { dir, clock, create };
}

test('daily slot is Beijing 00:15 and strict dates reject normalized impossible dates', () => {
  assert.equal(dailySlot(Date.parse('2026-09-15T16:14:59.999Z')), '2026-09-15');
  assert.equal(dailySlot(Date.parse('2026-09-15T16:15:00.000Z')), '2026-09-16');
  assert.equal(new Date(nextDailyCheck(Date.parse('2026-09-15T16:14:59Z'))).toISOString(), '2026-09-15T16:15:00.000Z');
  for (const value of ['2026-02-31', '2026-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', '2026-9-1']) assert.equal(validQuoteDate(value), false);
  assert.equal(validQuoteDate('2024-02-29'), true); assert.equal(validQuoteDate('2026-09-15'), true);
});

test('constructor is idle; manual refresh bypasses cache, deduplicates and has a real cooldown', async t => {
  const { create, clock } = await setup(t); let calls = 0;
  const fx = create({ fetchImpl: async (url, options) => {
    calls++; assert.equal(url, FX_URL); assert.deepEqual(Object.keys(options.headers), ['Accept']);
    assert.equal(options.redirect, 'error'); return response(6 + calls / 10);
  } });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 0);
  const initial = await Promise.all(Array.from({ length: 8 }, () => fx.get()));
  assert.equal(calls, 1); assert.ok(initial.every(quote => quote.usdCny === 6.1));
  clock.advance(1000);
  const forced = await Promise.all(Array.from({ length: 8 }, () => fx.get({ force: true })));
  assert.equal(calls, 2); assert.ok(forced.every(quote => quote.usdCny === 6.2 && quote.cooldownRemainingMs === 15000));
  clock.advance(1000);
  assert.equal((await fx.get({ force: true })).cooldownRemainingMs, 14000); assert.equal(calls, 2);
  clock.advance(14000);
  assert.equal((await fx.get({ force: true })).usdCny, 6.3); assert.equal(calls, 3);
});

test('crossing a daily slot refreshes a quote only one minute old', async t => {
  const { create, clock } = await setup(t); let calls = 0;
  clock.set('2026-09-15T16:14:00Z');
  const fx = create({ fetchImpl: async () => { calls++; return response(6 + calls / 10); } });
  const first = await fx.get();
  clock.advance(60000);
  const second = await fx.check();
  assert.equal(calls, 2); assert.equal(second.usdCny, 6.2); assert.equal(second.stale, false);
  assert.notEqual(second.retrievedAt, first.retrievedAt); assert.equal(second.checkedAt, new Date(clock.now()).toISOString());
});

test('a manual click joining an automatic request also starts the manual cooldown', async t => {
  const { create } = await setup(t); let release, began, calls = 0;
  const beginning = new Promise(resolve => { began = resolve; });
  const fx = create({ fetchImpl: async () => { calls++; began(); return new Promise(resolve => { release = resolve; }); } });
  const automatic = fx.get(); await beginning;
  const manual = fx.get({ force: true });
  await Promise.resolve(); release(response());
  await Promise.all([automatic, manual]);
  assert.equal((await fx.get({ force: true })).cooldownRemainingMs, 15000);
  assert.equal(calls, 1);
});

test('failed refresh preserves quote and success time, persists stale state, and retries automatic checks after one minute', async t => {
  const { create, clock, dir } = await setup(t); let calls = 0, fail = false;
  const fx = create({ fetchImpl: async () => { calls++; if (fail) throw new Error('offline'); return response(); } });
  const first = await fx.get(); clock.advance(1000); fail = true;
  const failed = await fx.get({ force: true });
  assert.equal(failed.usdCny, first.usdCny); assert.equal(failed.retrievedAt, first.retrievedAt);
  assert.equal(failed.stale, true); assert.equal(failed.retryAfterMs, 60000); assert.notEqual(failed.checkedAt, first.checkedAt);
  const saved = JSON.parse(await fs.readFile(path.join(dir, 'display-fx.json'), 'utf8'));
  assert.equal(saved.lastAttemptFailed, true); assert.equal(saved.checkedAt, failed.checkedAt);
  clock.advance(59999); await fx.check({ reason: 'wake' }); assert.equal(calls, 2);
  clock.advance(1); fail = false;
  const recovered = await fx.check({ reason: 'wake' }); assert.equal(calls, 3); assert.equal(recovered.stale, false);
});

test('a recent failed refresh remains stale after restart even within the six-hour cache', async t => {
  const { create, clock } = await setup(t); let fail = false;
  const first = create({ fetchImpl: async () => { if (fail) throw new Error('offline'); return response(); } });
  await first.get(); clock.advance(1000); fail = true; const failed = await first.get({ force: true }); await first.close();
  let restartedCalls = 0;
  const restarted = create({ fetchImpl: async () => { restartedCalls++; throw new Error('offline'); } });
  const restored = await restarted.get();
  assert.equal(restartedCalls, 0); assert.equal(restored.stale, true); assert.equal(restored.checkedAt, failed.checkedAt);
  assert.equal(restored.retrievedAt, failed.retrievedAt);
});

test('manual refresh without a cached quote reports cooldown and permits deliberate retry after fifteen seconds', async t => {
  const { create, clock } = await setup(t); let calls = 0;
  const fx = create({ fetchImpl: async () => { calls++; if (calls === 1) throw new Error('offline'); return response(); } });
  await assert.rejects(fx.get({ force: true }), error => error.cooldownRemainingMs === 15000 && error.retryAfterMs === 60000);
  await assert.rejects(fx.get({ force: true }), error => error.cooldownRemainingMs === 15000); assert.equal(calls, 1);
  clock.advance(15000);
  assert.equal((await fx.get({ force: true })).stale, false); assert.equal(calls, 2);
});

test('periodic checks are opt-in, detect wake gaps, and are removed by close', async t => {
  const { create, clock } = await setup(t), scheduled = new Map(); let serial = 0, calls = 0;
  const timers = {
    setTimeout(fn, ms) { const handle = { id: ++serial, due: clock.now() + ms, unref() {} }; scheduled.set(handle, fn); return handle; },
    clearTimeout(handle) { scheduled.delete(handle); },
  };
  const fx = create({ timers, fetchImpl: async () => { calls++; return response(); } });
  assert.equal(scheduled.size, 0); await fx.start(); assert.equal(calls, 1); assert.equal(scheduled.size, 1);
  async function firePeriodicAfter(ms) {
    clock.advance(ms); const [handle, fn] = [...scheduled.entries()].sort(([a], [b]) => a.due - b.due)[0];
    assert.ok(handle.due <= clock.now()); scheduled.delete(handle); await fn();
  }
  await firePeriodicAfter(30000); assert.equal(calls, 1);
  await firePeriodicAfter(5 * 60000); assert.equal(calls, 2);
  await fx.close(); assert.equal(scheduled.size, 0); await assert.rejects(fx.get(), /已停止/);
});

test('oversize streaming response is cancelled before the full body is buffered', async t => {
  const { create } = await setup(t); let sent = 0, cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { sent += 4096; controller.enqueue(new Uint8Array(4096)); },
    cancel() { cancelled = true; },
  });
  const fx = create({ fetchImpl: async () => new Response(stream) });
  await assert.rejects(fx.get(), /无法取得/);
  assert.equal(cancelled, true); assert.ok(sent <= FX_POLICY.maxBytes + 8192);
});

test('declared oversize and impossible response dates cannot replace a valid cached quote', async t => {
  const { create, clock } = await setup(t); let kind = 'good';
  const fx = create({ fetchImpl: async () => kind === 'large' ? new Response('{}', { headers: { 'content-length': String(FX_POLICY.maxBytes + 1) } }) : response(6.7, kind === 'date' ? '2026-02-31' : '2026-09-15') });
  const first = await fx.get();
  for (const next of ['large', 'date']) {
    kind = next; clock.advance(15000); const result = await fx.get({ force: true });
    assert.equal(result.usdCny, first.usdCny); assert.equal(result.date, first.date); assert.equal(result.stale, true);
    assert.equal(result.retrievedAt, first.retrievedAt);
  }
});

test('timeout covers a stalled response stream and close aborts a fetch that ignores signals', async t => {
  const { create } = await setup(t); let cancelled = false;
  const slow = create({ timeoutMs: 25, fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) });
  await assert.rejects(slow.get(), /无法取得/); assert.equal(cancelled, true);
  let began;
  const beginning = new Promise(resolve => { began = resolve; });
  const stuck = create({ fetchImpl: async () => { began(); return new Promise(() => {}); } });
  const request = stuck.get(); const rejection = assert.rejects(request, /已停止/);
  await beginning; await stuck.close(); await rejection;
});

test('in-process JSON response stubs retain compatibility and obey the same accepted-size limit', async t => {
  const { create, clock } = await setup(t); let large = false;
  const fx = create({ fetchImpl: async () => ({ ok: true, json: async () => large ? { ...body(), padding: 'x'.repeat(FX_POLICY.maxBytes) } : body() }) });
  assert.equal((await fx.get()).usdCny, 6.7);
  clock.advance(15000); large = true; assert.equal((await fx.get({ force: true })).stale, true);
});
