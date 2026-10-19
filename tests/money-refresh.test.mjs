import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../desktop/ui/money.js', import.meta.url), 'utf8');
const box = { module: { exports: {} }, Intl, Date };
vm.runInNewContext(source, box);
const { createMoneyState } = box.module.exports;
const clockAt = Date.parse('2026-09-16T04:00:00Z');
const quote = (rate, extra = {}) => ({ usdCny: rate, date: '2026-09-15', retrievedAt: new Date(clockAt).toISOString(), checkedAt: new Date(clockAt).toISOString(), stale: false, ...extra });
const create = options => createMoneyState({ now: () => clockAt, ...options });
const tick = () => new Promise(resolve => setImmediate(resolve));
function bind(money, value) {
  const element = { textContent: '', isConnected: true, writes: 0, contains(other) { return other === this; } };
  money.bind(element, () => money.formatMoney(value, 'USD'), text => { element.textContent = text; element.writes++; });
  return element;
}

test('background quotes leave visible balance, alert and budget bindings unchanged until a new scene applies them', async () => {
  let rate = 7;
  const money = create({ loadQuote: async () => quote(rate) });
  await money.ready(); await money.setDisplayCurrency('CNY');
  const elements = [2, 10, 20].map(value => bind(money, value));
  assert.deepEqual(elements.map(item => item.textContent), ['¥14.00', '¥70.00', '¥140.00']);
  rate = 8;
  assert.equal(await money.refreshQuote({ apply: false }), true);
  assert.equal(money.state().quote.usdCny, 7); assert.equal(money.state().latestQuote.usdCny, 8);
  assert.equal(money.state().hasPendingQuote, true);
  assert.deepEqual(elements.map(item => item.writes), [1, 1, 1]);
  money.applyLatestQuote({ refreshBindings: false });
  assert.equal(money.state().quote.usdCny, 8); assert.equal(money.state().hasPendingQuote, false);
  assert.deepEqual(elements.map(item => item.textContent), ['¥14.00', '¥70.00', '¥140.00']);
  assert.equal(bind(money, 2).textContent, '¥16.00');
});

test('manual refresh updates all captured monetary texts without replacing nodes or random text', async () => {
  let rate = 7;
  const money = create({ loadQuote: async () => quote(rate) });
  await money.ready(); await money.setDisplayCurrency('CNY');
  const amounts = Object.freeze([2, 10, 20]), elements = amounts.map(value => bind(money, value));
  const random = { textContent: '固定随机语' };
  rate = 8; assert.equal(await money.refreshQuote({ force: true, apply: true }), true);
  assert.deepEqual(elements.map(item => item.textContent), ['¥16.00', '¥80.00', '¥160.00']);
  assert.deepEqual(elements.map(item => item.writes), [2, 2, 2]); assert.equal(random.textContent, '固定随机语');
  assert.deepEqual(amounts, [2, 10, 20]);
});

test('a saved display preference survives first-load failure and returns when a quote is applied', async () => {
  let failed = true; const saved = [];
  const money = create({ readPreference: () => 'CNY', savePreference: value => saved.push(value), loadQuote: async () => {
    if (failed) throw new Error('offline'); return quote(7);
  } });
  assert.equal(await money.ready(), false);
  assert.equal(money.state().displayCurrency, 'USD'); assert.equal(money.state().preferredCurrency, 'CNY');
  const element = bind(money, 2); assert.equal(element.textContent, '$2.00');
  failed = false; await money.refreshQuote({ apply: false });
  assert.equal(element.textContent, '$2.00'); assert.equal(money.state().displayCurrency, 'USD');
  money.applyLatestQuote(); assert.equal(element.textContent, '¥14.00'); assert.equal(money.state().displayCurrency, 'CNY');
  assert.deepEqual(saved, []);
});

test('a later explicit currency choice wins over an earlier manual quote request and startup completion', async () => {
  let release, slow = false;
  const money = create({ loadQuote: () => slow ? new Promise(resolve => { release = resolve; }) : Promise.resolve(quote(7)) });
  await money.ready(); await money.setDisplayCurrency('CNY'); const element = bind(money, 2);
  slow = true;
  const manual = money.refreshQuote({ force: true, apply: true }); await Promise.resolve();
  await money.setDisplayCurrency('USD'); release(quote(8)); assert.equal(await manual, true);
  assert.equal(money.state().displayCurrency, 'USD'); assert.equal(money.state().preferredCurrency, 'USD'); assert.equal(element.textContent, '$2.00');
  let resolveStartup;
  const startup = create({ readPreference: () => 'CNY', loadQuote: () => new Promise(resolve => { resolveStartup = resolve; }) });
  const ready = startup.ready(); await Promise.resolve(); await startup.setDisplayCurrency('USD'); resolveStartup(quote(7));
  await ready; assert.equal(startup.state().displayCurrency, 'USD'); assert.equal(startup.state().preferredCurrency, 'USD');
});

test('a force click behind a normal request makes exactly one serialized force request and never applies the intermediate quote', async () => {
  const requests = []; let normalRelease, forceRelease, count = 0;
  const money = create({ loadQuote: options => {
    requests.push({ ...options }); count++;
    if (count === 1) return Promise.resolve(quote(7));
    return new Promise(resolve => { if (options.force) forceRelease = resolve; else normalRelease = resolve; });
  } });
  await money.ready(); await money.setDisplayCurrency('CNY'); const element = bind(money, 2);
  const background = money.refreshQuote({ apply: false, reason: 'timer' }); await Promise.resolve();
  const manual = money.refreshQuote({ force: true, apply: true }), duplicate = money.refreshQuote({ force: true, apply: true });
  normalRelease(quote(8)); await background; await tick();
  assert.equal(requests.length, 3); assert.equal(requests[1].force, false); assert.equal(requests[2].force, true);
  assert.equal(element.textContent, '¥14.00'); assert.equal(money.state().quote.usdCny, 7);
  forceRelease(quote(9)); assert.equal(await manual, true); assert.equal(await duplicate, true);
  assert.equal(element.textContent, '¥18.00'); assert.equal(money.state().refreshing, false);
});

test('a queued forced refresh still runs when the earlier automatic read fails', async () => {
  let count = 0, rejectNormal; const options = [];
  const money = create({ loadQuote: request => {
    options.push({ ...request }); count++;
    if (count === 1) return Promise.resolve(quote(7));
    if (count === 2) return new Promise((_resolve, reject) => { rejectNormal = reject; });
    return Promise.resolve(quote(9));
  } });
  await money.ready(); await money.setDisplayCurrency('CNY');
  const background = money.refreshQuote(); await Promise.resolve();
  const manual = money.refreshQuote({ force: true, apply: true }); rejectNormal(new Error('automatic failed'));
  assert.equal(await background, false); assert.equal(await manual, true);
  assert.equal(options.length, 3); assert.equal(options[2].force, true); assert.equal(money.state().error, '');
  assert.equal(money.formatMoney(2, 'USD'), '¥18.00');
});

test('failed or stale background refresh changes status metadata without rewriting the active quote', async () => {
  let mode = 'fresh', at = clockAt;
  const money = createMoneyState({ now: () => at, loadQuote: async () => {
    if (mode === 'throw') { const error = new Error('offline'); error.checkedAt = new Date(at).toISOString(); error.cooldownRemainingMs = 15000; throw error; }
    return quote(7, { stale: mode === 'stale', checkedAt: new Date(at).toISOString() });
  } });
  await money.ready(); await money.setDisplayCurrency('CNY'); const element = bind(money, 2), before = money.state().quote;
  mode = 'throw'; at += 1000;
  assert.equal(await money.refreshQuote({ force: true, apply: true }), false);
  assert.equal(element.textContent, '¥14.00'); assert.equal(element.writes, 1); assert.equal(money.state().quote.stale, before.stale);
  assert.equal(money.state().checkedAt, new Date(at).toISOString()); assert.equal(money.state().cooldownRemainingMs, 15000);
  at += 1000; assert.equal(money.state().cooldownRemainingMs, 14000);
  mode = 'stale'; assert.equal(await money.refreshQuote({ apply: false }), false);
  assert.equal(element.writes, 1); assert.equal(money.state().latestQuote.stale, true);
});

test('metadata-only quote checks do not report a pending rate change', async () => {
  let checkedAt = clockAt;
  const money = create({ loadQuote: async () => quote(7, { checkedAt: new Date(checkedAt).toISOString() }) });
  await money.ready(); checkedAt += 60000; await money.refreshQuote();
  assert.equal(money.state().hasPendingQuote, false);
  assert.equal(money.state().quote.checkedAt, new Date(clockAt).toISOString());
  assert.equal(money.state().checkedAt, new Date(checkedAt).toISOString());
});

test('invalid quotes never replace a good rate or cause implicit one-to-one conversion', async () => {
  let invalid = false;
  const money = create({ loadQuote: async () => quote(invalid ? 1 : 7, { date: invalid ? '2026-02-31' : '2026-09-15' }) });
  await money.ready(); await money.setDisplayCurrency('CNY'); invalid = true;
  assert.equal(await money.refreshQuote({ force: true, apply: true }), false);
  assert.equal(money.formatMoney(2, 'USD'), '¥14.00'); assert.equal(money.state().quote.date, '2026-09-15');
});

test('browser refresh requests carry force/reason and automatic events only stage quotes', async () => {
  const browserEvents = new Map(), documentEvents = new Map(), intervals = new Map(), urls = [];
  let rate = 7, disconnected = false;
  const document = { body: {}, hidden: false,
    addEventListener(name, callback) { documentEvents.set(name, callback); }, removeEventListener(name) { documentEvents.delete(name); } };
  const browser = { Intl, Date, document,
    localStorage: { getItem: () => null, setItem() {} },
    MutationObserver: class { observe() {} disconnect() { disconnected = true; } },
    addEventListener(name, callback) { browserEvents.set(name, callback); }, removeEventListener(name) { browserEvents.delete(name); },
    setInterval(callback, ms) { intervals.set(1, { callback, ms }); return 1; }, clearInterval(id) { intervals.delete(id); },
    fetch: async (url, options) => { urls.push(url); assert.equal(options.cache, 'no-store'); assert.equal(options.headers, undefined); return { ok: true, json: async () => ({ ok: true, ...quote(rate, { retrievedAt: new Date().toISOString() }) }) }; },
  };
  vm.runInNewContext(source, browser); await tick();
  const money = browser.WhaleMoney; assert.ok(money.state().quote); assert.equal(intervals.get(1).ms, 60000);
  assert.ok(urls[0].includes('reason=startup') && !urls[0].includes('refresh=1'));
  await money.setDisplayCurrency('CNY'); const element = bind(money, 2);
  rate = 8; await money.refreshQuote({ force: true, apply: true });
  assert.equal(urls.at(-1), '/api/fx/usd-cny?refresh=1&reason=manual'); assert.equal(element.textContent, '¥16.00');
  rate = 9; await intervals.get(1).callback(); assert.ok(urls.at(-1).includes('reason=timer'));
  assert.equal(element.textContent, '¥16.00'); assert.equal(money.state().latestQuote.usdCny, 9);
  await browserEvents.get('online')(); assert.ok(urls.at(-1).includes('reason=online'));
  const count = urls.length; document.hidden = true; documentEvents.get('visibilitychange')(); await tick(); assert.equal(urls.length, count);
  document.hidden = false; documentEvents.get('visibilitychange')(); await tick(); assert.ok(urls.at(-1).includes('reason=visibility'));
  assert.equal(element.textContent, '¥16.00'); browserEvents.get('pagehide')();
  assert.equal(intervals.size, 0); assert.equal(disconnected, true); assert.equal(browserEvents.has('online'), false); assert.equal(documentEvents.has('visibilitychange'), false);
});
