import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createFxService, FX_URL } from '../runtime/fx.mjs';

const box = { module: { exports: {} }, Intl, Date };
vm.runInNewContext(await fs.readFile(new URL('../desktop/ui/money.js', import.meta.url), 'utf8'), box);
const { createMoneyState } = box.module.exports;
const quote = () => ({ usdCny: 6.7115, date: '2026-09-15', retrievedAt: new Date().toISOString(), stale: false });
const create = options => createMoneyState({ loadQuote: async () => quote(), ...options });

test('one USD/CNY display state converts balance, alert and budget without changing native values', async () => {
  const money = create(), amounts = Object.freeze([12.3456, 50, 20]);
  await money.ready();
  assert.deepEqual(amounts.map(value => money.formatMoney(value, 'USD')), ['$12.35', '$50.00', '$20.00']);
  await money.setDisplayCurrency('CNY');
  assert.deepEqual(amounts.map(value => money.formatMoney(value, 'USD')), ['¥82.86', '¥335.58', '¥134.23']);
  for (let i = 0; i < 100; i++) { await money.setDisplayCurrency('USD'); await money.setDisplayCurrency('CNY'); }
  assert.deepEqual(amounts, [12.3456, 50, 20]);
  assert.equal(money.state().nativeCurrency, 'USD');
  assert.equal(money.formatMoney(0, 'USD'), '¥0.00');
  assert.equal(money.formatMoney(Infinity, 'USD'), '不限额');
  assert.equal(money.formatMoney(null, 'USD'), '--');
  await money.setDisplayCurrency('USD');
  assert.equal(money.formatMoney(1.005, 'USD'), '$1.01');
});

test('CNY API amounts use the inverse of the same quote and keep user preference after refresh', async () => {
  const money = create(); money.setNativeCurrency('CNY'); await money.ready();
  assert.equal(money.state().displayCurrency, 'CNY');
  await money.setDisplayCurrency('USD');
  assert.equal(money.formatMoney(671.15, 'CNY'), '$100.00');
  money.setNativeCurrency('CNY');
  assert.equal(money.state().displayCurrency, 'USD');
  await money.setDisplayCurrency('CNY');
  const native = money.fromDisplay(350, 'USD');
  assert.equal(money.formatNumber(native, 'USD'), '350.00');
  assert.equal(money.formatNumber(671.15, 'CNY'), '671.15');
});

test('late currency requests cannot override a newer selection and share the rate request', async () => {
  let resolve, calls = 0;
  const money = create({ loadQuote: () => { calls++; return new Promise(done => { resolve = done; }); } });
  const first = money.setDisplayCurrency('CNY');
  const second = money.setDisplayCurrency('CNY');
  await Promise.resolve();
  await money.setDisplayCurrency('USD');
  resolve(quote());
  assert.equal(await first, false); assert.equal(await second, false);
  assert.equal(calls, 1); assert.equal(money.state().displayCurrency, 'USD');
});

test('missing rates keep native values, never relabel dollars as yuan', async () => {
  const money = create({ loadQuote: async () => { throw new Error('离线'); }, readPreference: () => 'CNY' });
  assert.equal(await money.ready(), false);
  assert.equal(money.formatMoney(12.3456, 'USD'), '$12.35');
  await assert.rejects(money.setDisplayCurrency('CNY'), /离线/);
  assert.equal(money.state().displayCurrency, 'USD');
  money.setNativeCurrency('CNY');
  assert.equal(money.formatMoney(12.3456, 'CNY'), '¥12.35');
});

test('text bindings use captured values and reused bubble nodes release old bindings', async () => {
  const money = create(); await money.ready();
  let liveBalance = 12.3456;
  const node = { textContent: '', isConnected: true, contains: other => other === node };
  const captured = liveBalance;
  money.bind(node, () => money.formatMoney(captured, 'USD'));
  liveBalance = 999;
  await money.setDisplayCurrency('CNY'); assert.equal(node.textContent, '¥82.86');
  money.clearBindings(node); node.textContent = '固定随机语';
  await money.setDisplayCurrency('USD'); assert.equal(node.textContent, '固定随机语');
  assert.equal(liveBalance, 999);
});

async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-fx-test-'));
  t.after(async () => {
    const resolved = path.resolve(dir);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('whale-fx-test-'));
    await fs.rm(resolved, { recursive: true });
  });
  return dir;
}
const response = () => new Response(JSON.stringify({ amount: 1, base: 'USD', date: '2026-09-15', rates: { CNY: 6.7115 } }));

test('fixed public FX endpoint deduplicates requests, validates data and marks stale cache on failure', async t => {
  const dataDir = await directory(t); let clock = Date.parse('2026-09-15T10:00:00Z'), calls = 0, fail = false;
  const fx = createFxService({ dataDir, now: () => clock, fetchImpl: async (url, options) => {
    calls++; assert.equal(url, FX_URL); assert.equal(Object.keys(options.headers).join(), 'Accept');
    if (fail) throw new Error('Offline');
    return response();
  } });
  const results = await Promise.all(Array.from({ length: 10 }, () => fx.get()));
  assert.equal(calls, 1); assert.ok(results.every(value => value.usdCny === 6.7115 && value.stale === false));
  clock += 7 * 60 * 60 * 1000; fail = true;
  const cached = await fx.get();
  assert.equal(cached.stale, true); assert.equal(cached.date, '2026-09-15'); assert.equal(cached.usdCny, 6.7115);
  const restarted = createFxService({ dataDir, now: () => clock, fetchImpl: async () => { throw new Error('Offline'); } });
  assert.equal((await restarted.get()).stale, true);
});

test('invalid FX responses and timeouts never produce an implicit 1:1 conversion', async t => {
  const dataDir = await directory(t);
  for (const body of [ {}, { amount: 1, base: 'CNY', date: '2026-09-15', rates: { CNY: 1 } }, { amount: 1, base: 'USD', date: 'bad', rates: { CNY: -1 } } ]) {
    const fx = createFxService({ dataDir, fetchImpl: async () => new Response(JSON.stringify(body)) });
    await assert.rejects(fx.get(), /无法取得/);
  }
  const fx = createFxService({ dataDir, timeoutMs: 25, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true })) });
  await assert.rejects(fx.get(), /无法取得/);
});
