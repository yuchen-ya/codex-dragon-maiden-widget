import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createModelUsageService } from '../runtime/model-usage.mjs';

const tokens = (input, output, cached = 0) => ({ input_tokens: input, output_tokens: output, cached_input_tokens: cached, total_tokens: input + output });
const event = (model, input, output, timing = {}) => ({ model, last_token_usage: tokens(input, output), ...timing });
function fixture(t, { enabled = true, fail = false, malformed = false } = {}) {
  const state = { enabled, fail, malformed, starts: 0, requests: [] };
  const config = { codexHome: '/fixture', resolve: () => ({ setting: { monitorSessions: state.enabled } }) };
  const runtime = { async start() { state.starts++; return 'http://127.0.0.1:12345'; }, async close() {} };
  const service = createModelUsageService(config, { runtime, fetchImpl: async url => {
    const u = new URL(url); state.requests.push(u);
    if (state.fail) throw Error('private-path-and-token');
    let result;
    if (u.pathname === '/api/health') result = { app: 'codex-usage-dashboard', version: '1.1.3', index: { phase: 'ready' } };
    else if (u.pathname === '/api/v2/sessions') {
      const cursor = u.searchParams.get('cursor');
      result = { page: { revision: 'stable', offset: cursor ? 1 : 0, next_cursor: cursor ? null : 'session-page-2', items: [{ uid: cursor ? 'child' : 'main' }], summary: { model_breakdown: [
        { model: 'gpt-6.1-sol', usage: tokens(3000, 600, 2400), estimated_cost_usd: 2.15, cost_complete: true },
        { model: 'gpt-6-astra', usage: tokens(1000, 100, 150), estimated_cost_usd: null, cost_complete: false },
      ] } } };
      if (state.malformed) result.page.summary.model_breakdown[0].usage.input_tokens = '3000';
    } else if (u.pathname === '/api/v2/events') {
      assert.equal(u.searchParams.get('revision'), 'stable');
      const second = !!u.searchParams.get('cursor');
      const child = u.searchParams.get('id') === 'child';
      result = { revision: 'stable', offset: second ? 2 : 0, next_cursor: !child && !second ? 'event-page-2' : null,
        events: child ? [event('gpt-6.1-sol', 1000, 300)] : second ? [event('gpt-6-astra', 1000, 100)] : [
          event('gpt-6.1-sol', 1000, 100, { request_duration_ms: 2000 }),
          event('gpt-6.1-sol', 1000, 200, { generation_duration_ms: 1000, request_duration_ms: 9000 }),
          event('gpt-6.1-sol', 0, 0, { request_duration_ms: 1000 }),
        ] };
    } else assert.fail(u.pathname);
    return new Response(JSON.stringify(result));
  } });
  t.after(() => service.close());
  return { service, state };
}

test('model totals use upstream attribution; request counts span all pages, speed is weighted, zero deltas are excluded', async t => {
  const { service, state } = fixture(t);
  const result = await service.get(); assert.equal(result.available, true);
  assert.deepEqual(result.models.map(row => [row.model, row.tokens, row.requests]), [['gpt-6.1-sol', 3600, 3], ['gpt-6-astra', 1100, 1]]);
  assert.equal(result.models[0].estimatedCostUsd, 2.15);
  assert.equal(result.models[0].tokensPerSecond, 200); // Only 200 output tokens / 1 second of first-token timing.
  assert.equal(result.models[0].timedRequests, 1);
  assert.equal(result.speedBasis, 'first-token-generation');
  assert.equal(result.models[0].cacheHitPercent, 80);
  assert.equal(result.models[1].estimatedCostUsd, null);
  assert.equal(result.models[1].tokensPerSecond, null);
  assert.equal(result.models[1].cacheHitPercent, 15);
  assert.ok(state.requests.every(u => u.searchParams.get('timezone') === 'Asia/Shanghai' || u.pathname === '/api/health'));
  assert.ok(!JSON.stringify(result).includes('private-path'));
});

test('concurrent reads coalesce; refresh bypasses cache; all records use normalized, bounded period events', async t => {
  const { service, state } = fixture(t);
  const [first, second] = await Promise.all([service.get(), service.get()]);
  assert.deepEqual(first, second); assert.equal(state.starts, 1);
  await service.get(); assert.equal(state.starts, 1);
  await service.get({ force: true }); assert.equal(state.starts, 2);
  await service.get({ period: 'all' });
  const query = state.requests.find(u => u.searchParams.get('start') === '1970-01-01');
  assert.equal(query.searchParams.get('period'), 'custom');
  assert.match(query.searchParams.get('end'), /^\d{4}-\d{2}-\d{2}$/);
  await assert.rejects(service.get({ period: 'invalid' }), /统计范围无效/);
});

test('disabled observation never starts a process; upstream failures and invalid counters do not become zero usage', async t => {
  const { service, state } = fixture(t, { enabled: false });
  assert.equal((await service.get()).available, false); assert.equal(state.starts, 0);
  state.enabled = true; state.fail = true;
  const unavailable = await service.get(); assert.equal(unavailable.available, false); assert.match(unavailable.reason, /无法连接/); assert.ok(!unavailable.reason.includes('private-path'));
  state.fail = false; state.malformed = true;
  const malformed = await service.get(); assert.equal(malformed.available, false); assert.match(malformed.reason, /无效数据/);
  state.malformed = false; assert.equal((await service.get()).available, true);
});

test('unknown and partial metrics render distinctly from measured zeroes', async () => {
  const source = await fs.readFile(new URL('../desktop/ui/insights.js', import.meta.url), 'utf8');
  const context = { module: { exports: {} } }; vm.runInNewContext(source, context);
  const { modelStatsText } = context.module.exports;
  assert.equal(modelStatsText({ requests: 8, estimatedCostUsd: 2.15, costComplete: true, tokensPerSecond: 13, cacheHitPercent: 87 }), '8 个请求 · ≈$2.15 · 纯生成 ≈13 token/秒 · 缓存命中率 87%');
  assert.match(modelStatsText({ requests: 1, estimatedCostUsd: null, costComplete: false, tokensPerSecond: null, cacheHitPercent: null }), /费用未知 · 纯生成速度暂无记录 · 缓存命中率未知/);
  assert.match(modelStatsText({ requests: 1, estimatedCostUsd: 0, costComplete: false, tokensPerSecond: null, cacheHitPercent: 0 }), /部分估算 \$0.00.*缓存命中率 0%/);
});
