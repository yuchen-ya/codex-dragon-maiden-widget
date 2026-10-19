import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WhaleService } from '../runtime/service.mjs';
import { DEFAULT_CONFIG } from '../runtime/config.mjs';

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-balance-order-'));
  const current = { accountId: 'a'.repeat(24), model: 'demo', setting: structuredClone(DEFAULT_CONFIG),
    baseUrl: 'https://fake.example.test/v1', dashboardUrl: 'https://fake.example.test', providerName: 'Fake' };
  const config = { dataDir: root, codexHome: root, resolve: () => structuredClone(current) }, requests = [];
  const service = new WhaleService({ config, provider: { balance: context => new Promise((resolve, reject) => requests.push({ context, resolve, reject })) } });
  const sample = (used, context = current, currency = context.setting.currency) => ({ ok: true, accountId: context.accountId,
    currency, totalUsed: used, totalBalance: 1000 - used, updatedAt: new Date().toISOString() });
  function answer(index, used, currency) { requests[index].resolve(sample(used, requests[index].context, currency)); }
  async function observe(used, currency) { const pending = service.getBalance({ force: true }); answer(requests.length - 1, used, currency); return pending; }
  t.after(async () => {
    await service.close({ timeoutMs: 30 });
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('whale-balance-order-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { root, current, config, requests, service, sample, answer, observe };
}

test('late readings after a pricing edit cannot double-count daily debit or replace the UI balance', async t => {
  const { service, current, config, sample, answer, observe } = setup(t), scope = current.accountId + '-USD';
  service.ledger.observe(scope, sample(0));
  const roundSample = service.getBalance({ force: true, context: config.resolve() });
  const joinedUi = service.getBalance();
  current.setting.models = { demo: { input: 1, cachedInput: 0, output: 2 } };
  const newerUi = service.getBalance({ force: true }); answer(1, 2);
  assert.equal((await newerUi).todayUsage, 2);
  answer(0, 1);
  // The actual older interval sample is retained for its round; the UI gets
  // the newer sample, which can contain debit outside that round's interval.
  assert.equal((await roundSample).totalUsed, 1);
  assert.equal((await joinedUi).totalUsed, 2);
  const fresh = await observe(2);
  assert.equal(fresh.todayUsage, 2); assert.equal(fresh.totalBalance, 998);
  assert.equal(service.ledger.load(scope).lastObservation.used, 2);
});

test('a genuinely newer meter reset becomes a baseline and subsequent usage is still counted', async t => {
  const { observe } = setup(t);
  assert.equal((await observe(100)).todayUsage, 0);
  assert.equal((await observe(102)).todayUsage, 2);
  assert.equal((await observe(0)).todayUsage, 2);
  assert.equal((await observe(3)).todayUsage, 5);
});

test('late account or currency responses cannot switch active scope or a waiting UI request backwards', async t => {
  for (const change of ['account', 'currency', 'reported-currency']) {
    const { current, config, service, answer } = setup(t);
    const earlierRound = service.getBalance({ force: true, context: config.resolve() });
    const earlierUi = service.getBalance();
    if (change === 'account') current.accountId = 'b'.repeat(24);
    else if (change === 'currency') current.setting.currency = 'CNY';
    else current.setting.models = { demo: { input: 1, cachedInput: 0, output: 1 } };
    const currentUi = service.getBalance({ force: true }); answer(1, 2, 'CNY');
    assert.equal((await currentUi).currency, 'CNY');
    const expectedScope = current.accountId + '-CNY'; assert.equal(service.activeScope, expectedScope);
    answer(0, 1, 'USD'); await earlierRound;
    const uiResult = await earlierUi;
    assert.equal(uiResult.accountId, current.accountId); assert.equal(uiResult.currency, 'CNY');
    assert.equal(service.activeScope, expectedScope); assert.equal(service.usageRecords().currency, 'CNY');
  }
});

test('changing an API conversion starts a new baseline while price edits retain the meter', async t => {
  const { current, observe } = setup(t);
  await observe(1); assert.equal((await observe(3)).todayUsage, 2);
  current.setting.models = { demo: { input: 1, cachedInput: 0, output: 1 } };
  assert.equal((await observe(4)).todayUsage, 3);
  current.setting.balanceScale = 100;
  assert.equal((await observe(400)).todayUsage, 3);
  assert.equal((await observe(405)).todayUsage, 8);
});

test('balance responses arriving after close cannot recreate a ledger or start another request', async t => {
  const { root, service, requests, answer } = setup(t);
  const pending = service.getBalance({ force: true }); await service.close(); answer(0, 2);
  assert.equal((await pending).code, 'STOPPED');
  assert.equal(fs.existsSync(path.join(root, 'ledgers')), false); assert.equal(service.activeScope, null);
  assert.equal((await service.getBalance()).code, 'STOPPED'); assert.equal(requests.length, 1);
});

test('a late turn-start sample cannot overwrite the recovery journal after shutdown', async t => {
  const { root, service, answer } = setup(t), meta = { id: 'session:turn', sessionId: 'session', turnId: 'turn', ts: Date.now(), byModel: {} };
  service.beginTurn(meta); const pending = service.turns.get(meta.id).start;
  const file = path.join(root, 'turn-journal.json'), before = fs.readFileSync(file, 'utf8');
  await service.close(); answer(0, 1); await pending; await Promise.resolve();
  assert.equal(fs.readFileSync(file, 'utf8'), before); assert.equal(fs.existsSync(path.join(root, 'ledgers')), false);
});

test('a settlement still waiting at close leaves its journal recoverable and does not write late completion', async t => {
  const { root, service, current, requests, answer } = setup(t), meta = { id: 'session:turn', sessionId: 'session', turnId: 'turn', ts: Date.now(), byModel: {} };
  service.beginTurn(meta); answer(0, 1); await service.turns.get(meta.id).start;
  const job = service.finishTurn({ ...meta, outcome: 'completed', notify: true }); await Promise.resolve();
  assert.equal(requests.length, 2);
  await service.close({ timeoutMs: 10 });
  const journal = path.join(root, 'turn-journal.json'), ledger = service.ledger.file(current.accountId + '-USD');
  const oldJournal = fs.readFileSync(journal, 'utf8'), oldLedger = fs.readFileSync(ledger, 'utf8');
  answer(1, 2); await job;
  assert.equal(fs.readFileSync(journal, 'utf8'), oldJournal); assert.equal(fs.readFileSync(ledger, 'utf8'), oldLedger);
  assert.equal(JSON.parse(oldJournal).entries[0].stage, 'settling'); assert.equal(fs.existsSync(path.join(root, 'last-turn.json')), false);
});
