import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source = await fs.readFile(new URL('../desktop/ui/account-view.js', import.meta.url), 'utf8');
const exported = { module: { exports: {} } }; vm.runInNewContext(source, exported);
const { turnBubbleModules, quotaLabel } = exported.module.exports;

test('quota periods remain distinct regardless of incoming label',()=>{
  assert.equal(quotaLabel({windowDurationMins:300,label:'primary'}),'5 小时额度');
  assert.equal(quotaLabel({windowDurationMins:10080,label:'secondary'}),'每周额度');
  assert.equal(quotaLabel({windowDurationMins:60,label:'独立窗口'}),'独立窗口');
});

test('completion bubble includes compact tokens and per-model pure speed, cache and API estimate', () => {
  const modules = turnBubbleModules({ completionKind: 'success', tokens: 2299061, amount: 5, metricsComplete: true,
    modelMetrics: [{ model: 'gpt-6.1-sol', generationMs: 2000, timedOutput: 85, input: 1000, cachedInput: 870, apiCostUsd: 0.1234 }] });
  assert.deepEqual(Array.from(modules, item => item.text), ['本轮用量', '2.3M tok', '42.5t/s · 0.12$ · 87%命中']);
  assert.ok(modules[1].size > modules[0].size && modules[1].size > modules[2].size);
  assert.match(turnBubbleModules({ completionKind: 'failed', tokens: 10 })[0].text, /未完成/);
  assert.match(turnBubbleModules({ completionKind: 'cancelled', tokens: 0 })[0].text, /取消/);
  assert.equal(turnBubbleModules({ completionKind: 'cancelled', tokens: 0 })[1].text, '0 tok');
  assert.match(turnBubbleModules({ tokens: 12480 })[1].text, /12.5K/);
  assert.match(turnBubbleModules({ tokens: 1000000 })[1].text, /1M/);
  assert.equal(turnBubbleModules({ completionKind: 'failed', failureKind: 'high-demand' })[0].text, '挤不进去...');
  assert.equal(turnBubbleModules({ tokens: null })[1].text, '— tok');
});
function runtime(fetch) {
  const storage = new Map(); const events = [];
  const context = { document: { documentElement: {dataset:{}}, readyState: 'loading', addEventListener() {}, querySelectorAll(){return []} }, window: { dispatchEvent(e) { events.push(e); } }, localStorage: { getItem(k) { return storage.get(k); }, setItem(k,v) { storage.set(k,v); } }, fetch, CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } } };
  vm.runInNewContext(source, context);
  return { api: context.window.WhaleAccountView, storage, events, window:context.window };
}
test('subscription turn modules are available without an open card',async()=>{
  const r=runtime(async()=>({ok:true,json:async()=>({mode:'subscription'})}));
  assert.equal(r.api.mode,'subscription');
  await r.api.setMode('subscription');
  assert.match(r.api.turnBubbleModules({completionKind:'success',tokens:12480,amount:100})[1].text,/12.5K/);
});
test('a rejected save preserves mode and does not emit false switch events', async () => {
  for (const fetch of [async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({ mode: 'api' }) }), async () => { throw Error('offline'); }]) {
    const { api, storage, events } = runtime(fetch);
    assert.equal(await api.setMode('subscription'), false);
    assert.equal(api.mode, 'subscription'); assert.equal(storage.size, 0); assert.equal(events.length, 0);
  }
});
test('successful switches persist display mode only after server acknowledgement', async () => {
  let resolve; let request;
  const { api, storage, events } = runtime((url, options) => { request = { url, options }; return new Promise(r => { resolve = r; }); });
  const pending = api.setMode('subscription');
  assert.equal(api.mode, 'subscription'); assert.equal(storage.size, 0);
  assert.equal(await api.setMode('api'), false);
  resolve({ ok: true, json: async () => ({ mode: 'subscription' }) });
  assert.equal(await pending, true); assert.equal(api.mode, 'subscription');
  assert.equal(storage.get('dshw-account-view'), 'subscription');
  assert.equal(request.url, '/api/display-mode'); assert.equal(request.options.body, '{"mode":"subscription"}');
  assert.equal(events[0].type, 'whale-account-view'); assert.equal(events[0].detail.mode, 'subscription');
});

test('quota reads work without a popup, merge concurrent clicks and notify the native bubble', async () => {
  let resolve; const requests = [];
  const { api, events } = runtime(url => { requests.push(url); return new Promise(r => { resolve = r; }); });
  const first = api.refresh(true), second = api.refresh(true);
  assert.equal(first, second);
  assert.deepEqual(requests, ['/api/insights?refresh=1']);
  resolve({ ok: true, json: async () => ({ subscription: { available: true, windows: [{ usedPercent: 37, windowDurationMins: 10080 }] } }) });
  await first;
  assert.equal(api.subscription.windows[0].usedPercent, 37);
  assert.equal(api.bubbleModules()[0].text, '本周');
  assert.equal(api.bubbleModules()[1].text, '剩余 63%');
  assert.deepEqual(events.map(e => e.type), ['whale-quota']);
});

test('failed quota refresh clears the old snapshot rather than presenting it as current', async () => {
  let fail = false;
  const { api } = runtime(async () => ({ ok: !fail, json: async () => ({ subscription: { available: true, windows: [{ usedPercent: 37 }] } }) }));
  await api.refresh(); fail = true; await api.refresh(true);
  assert.equal(api.subscription.available, false);
  assert.equal(api.bubbleModules()[1].text, '剩余 —');
});

test('a later completion from a slower conversation cannot replace a newer request speed', async () => {
  const handlers = new Map(); let init;
  const box = { document: { documentElement: { dataset: {} }, readyState: 'loading', addEventListener(_name, fn) { init = fn; }, querySelector() { return null; }, querySelectorAll() { return []; } },
    window: { addEventListener(name, fn) { handlers.set(name, fn); }, dispatchEvent() {} }, localStorage: { getItem() {}, setItem() {} }, setInterval() {}, CustomEvent: class {},
    fetch: async url => ({ ok: true, json: async () => url === '/api/recent-generation' ? { recent: { model: 'gpt-6.1-terra', timestamp: 2000, tokensPerSecond: 80 } } : url.startsWith('/api/insights') ? { subscription: { available: true, windows: [{ windowDurationMins: 10080, usedPercent: 50 }] } } : { mode: 'subscription' } }) };
  vm.runInNewContext(source, box); init(); await box.window.WhaleAccountView.refreshRecent(); await box.window.WhaleAccountView.refresh();
  handlers.get('whale-turn-notice')({ detail: { recentGeneration: { model: 'gpt-6.1-sol', timestamp: 1000, tokensPerSecond: 40 } } });
  assert.ok(box.window.WhaleAccountView.bubbleModules().some(row => row.text.includes('80 tok/s')));
  handlers.get('whale-turn-notice')({ detail: { recentGeneration: { model: 'gpt-6-astra', timestamp: 3000, tokensPerSecond: 30 } } });
  assert.ok(box.window.WhaleAccountView.bubbleModules().some(row => row.text.includes('30 tok/s')));
});

test('multi-model completion keeps the hierarchy and weights generation and cache correctly', () => {
  const rows = turnBubbleModules({ tokens: 3300, metricsComplete: true, modelMetrics: [
    { generationMs: 1000, timedOutput: 100, input: 1000, cachedInput: 800, apiCostUsd: 0.1 },
    { generationMs: 4000, timedOutput: 200, input: 2000, cachedInput: 1000, apiCostUsd: 0.2 }
  ] });
  assert.deepEqual(Array.from(rows, row => row.text), ['本轮用量', '3.3K tok', '60t/s · 0.3$ · 60%命中']);
});
