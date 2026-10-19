import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { CodexQuotaError, normalizeCodexQuota, readCodexQuota, createCodexQuotaService } from '../runtime/codex-quota.mjs';

const snapshot = () => ({
  accountId: 'PRIVATE_ACCOUNT_ID',
  rateLimits: { limitId: 'unrelated', primary: { usedPercent: 99, windowDurationMins: 300 } },
  rateLimitsByLimitId: { codex: { limitId: 'codex', primary: {
    usedPercent: 35, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 3600,
  }, secondary: null } },
  rateLimitResetCredits: { availableCount: 1, credits: [{ id: 'PRIVATE_CREDIT_ID' }] },
});

function server(onMessage) {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.killed = false;
  child.kill = () => { child.killed = true; queueMicrotask(() => child.emit('close', 0)); };
  const messages = [];
  child.stdin.on('data', bytes => {
    for (const line of bytes.toString().trim().split('\n')) {
      const message = JSON.parse(line); messages.push(message);
      queueMicrotask(() => onMessage(message, child));
    }
  });
  return { child, messages, spawnImpl: () => child };
}
const reply = (child, message) => child.stdout.write(JSON.stringify(message) + '\n');

test('live quota uses the Codex bucket, real durations and authoritative reset count without exposing account or credit IDs', () => {
  const result = normalizeCodexQuota(snapshot());
  assert.deepEqual(result.windows.map(w => [w.windowDurationMins, w.remainingPercent]), [[10080, 65]]);
  assert.equal(result.resetCreditsAvailable, 1);
  assert.equal(result.source, 'codex-app-server');
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(normalizeCodexQuota({}).resetCreditsAvailable, null);
  assert.equal(normalizeCodexQuota({}).available, false);
});

test('quota read completes initialize and initialized before the read-only request, then terminates its child', async () => {
  let initialized = false;
  const fixture = server((message, child) => {
    if (message.method === 'initialize') reply(child, { id: message.id, result: {} });
    else if (message.method === 'initialized') initialized = true;
    else {
      assert.equal(initialized, true);
      assert.equal(message.method, 'account/rateLimits/read');
      reply(child, { id: message.id, result: snapshot() });
    }
  });
  const result = await readCodexQuota({ codexHome: 'fixture', spawnImpl: fixture.spawnImpl });
  assert.equal(result.windows[0].remainingPercent, 65);
  assert.equal(fixture.child.killed, true);
  assert.deepEqual(fixture.messages.map(message => message.method), ['initialize', 'initialized', 'account/rateLimits/read']);
});

test('quota read handles backend errors and malformed messages without exposing raw responses', async () => {
  for (const output of [
    JSON.stringify({ id: 1, error: { code: -1, message: 'PRIVATE_TOKEN_SECRET' } }),
    '{not json', 'null',
  ]) {
    const fixture = server((_message, child) => child.stdout.write(output + '\n'));
    await assert.rejects(readCodexQuota({ codexHome: 'fixture', spawnImpl: fixture.spawnImpl }), error => {
      assert.ok(error instanceof CodexQuotaError);
      assert.equal(error.message.includes('PRIVATE'), false); return true;
    });
    assert.equal(fixture.child.killed, true);
  }
});

test('timeouts, cancellation and early exit terminate quota reads', async () => {
  const timeout = server(() => {});
  await assert.rejects(readCodexQuota({ codexHome: 'fixture', spawnImpl: timeout.spawnImpl, timeoutMs: 10 }), /超时/);
  assert.equal(timeout.child.killed, true);
  const cancellation = server(() => {}), controller = new AbortController();
  const pending = readCodexQuota({ codexHome: 'fixture', spawnImpl: cancellation.spawnImpl, signal: controller.signal });
  controller.abort(); await assert.rejects(pending, /停止/); assert.equal(cancellation.child.killed, true);
  const exited = server((_message, child) => child.emit('close', 1));
  await assert.rejects(readCodexQuota({ codexHome: 'fixture', spawnImpl: exited.spawnImpl }), /退出/);
});

test('quota service shares concurrent reads, caches for polling and refreshes explicitly without falling back to stale data', async () => {
  let reads = 0, complete;
  const service = createCodexQuotaService({ codexHome: 'fixture', read: () => {
    reads++; return new Promise(resolve => { complete = resolve; });
  } });
  const a = service.get(), b = service.get();
  assert.equal(reads, 1); complete(normalizeCodexQuota(snapshot()));
  assert.deepEqual(await a, await b);
  await service.get(); assert.equal(reads, 1);
  const forced = service.get({ force: true }); assert.equal(reads, 2);
  complete(normalizeCodexQuota({})); assert.equal((await forced).available, false);
  service.close(); assert.equal((await service.get()).available, false);
});

test('quota service turns known connection errors into visible reasons and propagates programming errors', async () => {
  const unavailable = createCodexQuotaService({ read: async () => { throw new CodexQuotaError('请登录 Codex'); } });
  assert.equal((await unavailable.get()).reason, '请登录 Codex'); unavailable.close();
  const broken = createCodexQuotaService({ read: async () => { throw new TypeError('programming error'); } });
  await assert.rejects(broken.get(), TypeError); broken.close();
});
