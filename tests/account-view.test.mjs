import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source = await fs.readFile(new URL('../desktop/ui/account-view.js', import.meta.url), 'utf8');
const exported = { module: { exports: {} } }; vm.runInNewContext(source, exported);
const { windowText, tokenText, noticeText, quotaLabel } = exported.module.exports;

test('quota periods remain distinct regardless of incoming label',()=>{
  assert.equal(quotaLabel({windowDurationMins:300,label:'primary'}),'5 小时额度');
  assert.equal(quotaLabel({windowDurationMins:10080,label:'secondary'}),'每周额度');
  assert.equal(quotaLabel({windowDurationMins:60,label:'独立窗口'}),'独立窗口');
});

test('missing snapshot values never become zero quota or tokens', () => {
  for (const value of [null, undefined, NaN, Infinity, -1, '50']) {
    assert.equal(windowText({ usedPercent: value }), '额度比例未知');
    assert.equal(tokenText(value), '暂无记录');
  }
  assert.match(windowText({ usedPercent: 25.5, stale: true }), /已用 25.5% · 剩余 74.5%（快照已过期）/);
  assert.equal(tokenText(0), '0 token');
});
test('subscription failure consumption displays tokens without API money or fun failure text', () => {
  assert.equal(noticeText({ completionKind: 'failed', tokens: 10, amount: 5 }), '本轮本机已观测：10 token');
  assert.equal(noticeText({ completionKind: 'failed', failureKind: 'high-demand' }), '挤不进去...');
  assert.equal(noticeText({ completionKind: 'completed', tokens: 10, amount: 5 }), '本轮本机已观测：10 token');
});
function runtime(fetch) {
  const storage = new Map(); const events = [];
  const context = { document: { documentElement: {dataset:{}}, readyState: 'loading', addEventListener() {}, querySelectorAll(){return []} }, window: { dispatchEvent(e) { events.push(e); } }, localStorage: { getItem(k) { return storage.get(k); }, setItem(k,v) { storage.set(k,v); } }, fetch, CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } } };
  vm.runInNewContext(source, context);
  return { api: context.window.WhaleAccountView, storage, events, window:context.window };
}
test('subscription completion and cancellation report tokens without an open card or API money',async()=>{
  const r=runtime(async()=>({ok:true,json:async()=>({mode:'subscription'})}));
  const messages=[];r.window.whaleToast=message=>messages.push(message);
  assert.equal(r.api.mode,'subscription');
  r.api.notice({completionKind:'success',tokens:12,amount:100,notify:false});assert.equal(messages.length,0);
  await r.api.setMode('subscription');
  r.api.notice({completionKind:'success',tokens:12480,amount:100,currency:'USD'});
  r.api.notice({completionKind:'cancelled',tokens:12,amount:10});
  r.api.notice({completionKind:'success',tokens:12,notify:false});
  assert.equal(messages.length,2);assert.match(messages[0],/12,480 token/);assert.match(messages[1],/12 token/);
  assert.ok(messages.every(m=>!/[\$¥]|USD|API/.test(m)));
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
  assert.equal(api.bubbleModules()[1].text, '剩余 63.0%');
  assert.deepEqual(events.map(e => e.type), ['whale-quota']);
});

test('failed quota refresh clears the old snapshot rather than presenting it as current', async () => {
  let fail = false;
  const { api } = runtime(async () => ({ ok: !fail, json: async () => ({ subscription: { available: true, windows: [{ usedPercent: 37 }] } }) }));
  await api.refresh(); fail = true; await api.refresh(true);
  assert.equal(api.subscription.available, false);
  assert.equal(api.bubbleModules()[1].text, '暂时读不到');
});
