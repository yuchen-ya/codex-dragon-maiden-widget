import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionParser } from '../runtime/session-monitor.mjs';
import { GenerationTimer, summarizeMetrics, safeMetrics } from '../runtime/generation-metrics.mjs';
import { estimateApiRequest } from '../runtime/api-pricing.mjs';
import { ConfigStore } from '../runtime/config.mjs';
import { WhaleService } from '../runtime/service.mjs';

const at = Date.parse('2026-10-29T04:00:00Z');
const line = (ms, type, payload) => ({ timestamp: new Date(at + ms).toISOString(), type, payload });
const usage = (input = 1000, output = 100, cached = 800) => ({ input_tokens: input, output_tokens: output, cached_input_tokens: cached, reasoning_output_tokens: 20 });

test('live turn counters exclude waiting, unknown timing and repeated snapshots; propagate prices and cache to completion', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-generation-'));
  t.after(() => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true }); });
  const config = new ConfigStore({ dataDir: path.join(root, 'data'), codexHome: root, env: {} });
  config.save({ provider: 'none' });
  const service = new WhaleService({ config }); t.after(() => service.close());
  const jobs = [];
  const parser = new SessionParser({ id: 'session', defaultModel: 'gpt-6.1-sol', onStart: meta => service.beginTurn(meta), onUpdate: meta => service.updateTurn(meta), onEnd: meta => jobs.push(service.finishTurn(meta)) });
  const counts = usage();
  const tokens = line(5000, 'event_msg', { type: 'token_count', info: { total_token_usage: counts, last_token_usage: counts } });
  const logs = [line(0, 'event_msg', { type: 'task_started', turn_id: 'turn' }),
    line(4500, 'event_msg', { type: 'item_completed', item: { type: 'Reasoning' }, started_at_ms: at + 4000 }), tokens, tokens,
    line(14000, 'response_item', { type: 'message', role: 'assistant' }),
    line(15000, 'event_msg', { type: 'token_count', info: { total_token_usage: usage(2000, 300, 1600), last_token_usage: usage(1000, 200, 800) } }),
    line(16000, 'event_msg', { type: 'task_complete', turn_id: 'turn' })];
  logs.forEach(entry => parser.accept(entry)); await Promise.all(jobs);
  const record = service.lastTurn(), row = record.modelMetrics[0];
  assert.equal(row.model, 'gpt-6.1-sol'); assert.equal(row.requests, 2); assert.equal(row.tokensPerSecond, 100); assert.equal(row.timedRequests, 1);
  assert.equal(row.cacheHitPercent, 80); assert.ok(Math.abs(row.apiCostUsd - 0.00396) < 1e-12);
  assert.equal(record.metricsComplete, true); assert.equal(record.tokens, 2300);
  assert.equal(service.recentGeneration.tokensPerSecond, null, 'the newest request has no first-token timing; never substitute an older speed');
});

test('tool completion cannot lengthen a known generation window; missing first token stays unknown', () => {
  const timer = new GenerationTimer();
  timer.observe(line(0, 'turn_context', { model: 'gpt-6.1-sol' }));
  timer.observe(line(1000, 'event_msg', { type: 'item_completed', item: { type: 'Reasoning' }, started_at_ms: at + 500 }));
  timer.observe(line(10000, 'response_item', { type: 'function_call_output' }));
  assert.equal(timer.finish(at + 10010, usage()), 500);
  timer.observe(line(12000, 'response_item', { type: 'message', role: 'assistant' }));
  assert.equal(timer.finish(at + 15000, usage()), null);
});

test('startup replay closes historical timing windows before measuring new requests', () => {
  let finished;
  const parser = new SessionParser({ id: 'replay', defaultModel: 'gpt-6.1-sol', onEnd: meta => { finished = meta; } });
  parser.prime([line(0, 'event_msg', { type: 'task_started', turn_id: 'running' }),
    line(4500, 'event_msg', { type: 'item_completed', item: { type: 'Reasoning' }, started_at_ms: at + 4000 }),
    line(5000, 'event_msg', { type: 'token_count', info: { total_token_usage: usage(), last_token_usage: usage() } })]);
  parser.accept(line(14500, 'event_msg', { type: 'item_completed', item: { type: 'Reasoning' }, started_at_ms: at + 14000 }));
  parser.accept(line(15000, 'event_msg', { type: 'token_count', info: { total_token_usage: usage(2000, 200, 1600), last_token_usage: usage() } }));
  parser.accept(line(16000, 'event_msg', { type: 'task_complete', turn_id: 'running' }));
  assert.equal(finished.metrics['gpt-6.1-sol'].generationMs, 1000);
  assert.equal(finished.metrics['gpt-6.1-sol'].output, 100);
  assert.equal(finished.recentGeneration.tokensPerSecond, 100);
});

test('API estimates match pinned dashboard standard, Fast, long-context and unknown prices', () => {
  assert.ok(Math.abs(estimateApiRequest('gpt-6.1-sol', usage(), at) - 0.00148) < 1e-12);
  assert.ok(Math.abs(estimateApiRequest('gpt-6.1-sol', usage(), at, 'priority') - 0.00296) < 1e-12);
  assert.ok(Math.abs(estimateApiRequest('gpt-6.1-sol', usage(300000, 100, 200000), at) - 0.4415) < 1e-12);
  assert.equal(estimateApiRequest('unpriced-model', usage(), at), null);
  assert.equal(estimateApiRequest('__PROTO__', usage(), at), null);
});

test('main and child generation statistics merge without counting reasoning or cached input twice', () => {
  const rows = { 'gpt-6.1-sol': { input: 1000, cachedInput: 800, output: 100, requests: 1, timedRequests: 1, timedOutput: 100, generationMs: 1000, apiCostUsd: 0.00148 } };
  const [combined] = summarizeMetrics([safeMetrics(rows), safeMetrics(rows)]);
  assert.equal(combined.tokens, 2200); assert.equal(combined.tokensPerSecond, 100); assert.equal(combined.apiCostUsd, 0.00296); assert.equal(combined.cacheHitPercent, 80);
});
