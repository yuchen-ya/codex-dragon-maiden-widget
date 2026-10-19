import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createDispatcher } from '../runtime/dispatcher.mjs';
import { MEDIA_POLICY } from '../lib/media-validation.mjs';
import { FX_POLICY } from '../runtime/fx.mjs';

const fxResponse = rate => new Response(JSON.stringify({ amount: 1, base: 'USD', date: '2026-09-15', rates: { CNY: rate } }));
async function setup(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-dispatcher-'));
  const state = { balances: 0, closes: 0 };
  const service = {
    config: { codexHome: path.join(root, 'codex'), publicInfo: () => ({ settings: { monitorSessions: false } }), resolve: () => ({ model: 'test', setting: { monitorSessions: false } }) },
    turns: new Map(),
    getBalance: async () => { state.balances++; return { ok: true, totalBalance: 20 }; },
    close: async args => { state.closes++; assert.equal(args.timeoutMs, 3000); },
    ...options.service,
  };
  const server = createDispatcher({ dataDir: root, monitor: false, autoRefresh: false, fxFetchImpl: async () => fxResponse(6.7), ...options, service });
  t.after(async () => {
    await server.close().catch(() => {});
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('whale-dispatcher-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  async function request(route, method = 'GET') { const response = await server.dispatch(route, { method }); return { ...response, payload: JSON.parse(response.body.toString()) }; }
  return { server, state, service, root, request };
}

test('media policy and the guarded script are served locally before widget startup', async t => {
  const { server, request } = await setup(t);
  const policy = await request('/api/media-policy'); assert.equal(policy.status, 200); assert.deepEqual(policy.payload.policy, MEDIA_POLICY);
  assert.equal((await request('/api/media-policy', 'PUT')).status, 405);
  const script = await server.dispatch('/media-guard.js'); assert.equal(script.status, 200); assert.match(script.headers['content-type'], /javascript/); assert.match(script.body.toString(), /WhaleMediaGuard/);
  const head = await server.dispatch('/media-guard.js', { method: 'HEAD' }); assert.equal(head.body.length, 0);
  const html = (await server.dispatch('/widget.html')).body.toString();
  assert.ok(html.indexOf('src="/media-guard.js"') >= 0 && html.indexOf('src="/media-guard.js"') < html.indexOf('src="/dsh-whale/widget.js"'));
  assert.ok(html.indexOf('src="/turn-notice.js"') >= 0 && html.indexOf('src="/turn-notice.js"') < html.indexOf('src="/dsh-whale/widget.js"'));
});

test('FX refresh=1 performs one deliberate fetch beyond a valid cache and preserves cooldown', async t => {
  let calls = 0;
  const { request } = await setup(t, { fxFetchImpl: async () => fxResponse(6 + ++calls / 10) });
  assert.equal((await request('/api/fx/usd-cny')).payload.usdCny, 6.1);
  assert.equal((await request('/api/fx/usd-cny')).payload.usdCny, 6.1); assert.equal(calls, 1);
  const manual = await request('/api/fx/usd-cny?refresh=1'); assert.equal(manual.payload.usdCny, 6.2); assert.equal(calls, 2);
  assert.ok(manual.payload.cooldownRemainingMs > 0 && manual.payload.cooldownRemainingMs <= FX_POLICY.manualCooldownMs);
  const repeated = await request('/api/fx/usd-cny?refresh=1'); assert.equal(repeated.payload.usdCny, 6.2); assert.equal(calls, 2);
  assert.equal((await request('/api/fx/usd-cny?refresh=1', 'POST')).status, 405);
});

test('FX failures retain checked time, manual cooldown and automatic retry metadata without raw errors', async t => {
  let calls = 0;
  const { request } = await setup(t, { fxFetchImpl: async () => { calls++; throw new Error('private server failure text'); } });
  const result = await request('/api/fx/usd-cny?refresh=1'); assert.equal(result.status, 503); assert.equal(result.payload.ok, false);
  assert.ok(Number.isFinite(Date.parse(result.payload.checkedAt)));
  assert.ok(result.payload.cooldownRemainingMs > 0 && result.payload.retryAfterMs > 0);
  assert.equal(JSON.stringify(result.payload).includes('private server failure text'), false);
  const again = await request('/api/fx/usd-cny'); assert.equal(again.status, 503); assert.equal(calls, 1);
});

test('automatic FX starts in the background and close aborts it before stopping the monitor and service', async t => {
  const calls = []; let began;
  const started = new Promise(resolve => { began = resolve; });
  const { server, state } = await setup(t, {
    monitor: true, autoRefresh: true,
    fxFetchImpl: async (_url, { signal }) => { signal.addEventListener('abort', () => calls.push('fx-abort'), { once: true }); began(); return new Promise(() => {}); },
    service: { close: async options => { assert.equal(options.timeoutMs, 3000); calls.push('service'); } },
  });
  await started; assert.equal(state.balances, 0);
  const stop = server.watcher.stop.bind(server.watcher);
  server.watcher.stop = async options => { assert.equal(options.timeoutMs, 1200); calls.push('monitor'); return stop(options); };
  const first = server.close(), second = server.close(); assert.equal(first, second);
  await first; assert.deepEqual(calls, ['fx-abort', 'monitor', 'service']);
  const rejected = await server.dispatch('/api/media-policy'); assert.equal(rejected.status, 503);
});

test('close continues to settle the service after a monitor cleanup error', async t => {
  let closed = false;
  const { server } = await setup(t, { monitor: true, service: { close: async () => { closed = true; } } });
  const stop = server.watcher.stop.bind(server.watcher);
  server.watcher.stop = async options => { await stop(options); throw new Error('synthetic cleanup failure'); };
  await assert.rejects(server.close(), /部分挂件组件/); assert.equal(closed, true);
});

test('subscription mode does not query API balances at startup, on periodic ticks or after shutdown', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { server, state } = await setup(t, { autoRefresh: true });
  assert.equal(state.balances, 0); t.mock.timers.tick(60000); assert.equal(state.balances, 0);
  await server.close(); t.mock.timers.tick(60000); assert.equal(state.balances, 0);
  t.mock.timers.reset();
});
