// Runs the real pinned dashboard against synthetic logs, with no account access.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT } from '../runtime/paths.mjs';
import { dashboardExecutable, createDashboardRuntime } from '../runtime/usage-dashboard-runtime.mjs';
import { createModelUsageService } from '../runtime/model-usage.mjs';

const root = path.join(ROOT, 'qa-output', 'dashboard-integration');
const dataDir = path.join(root, 'widget'), codexHome = path.join(root, 'codex');
await fs.mkdir(path.join(codexHome, 'sessions'), { recursive: true });
const executable = dashboardExecutable(dataDir);
await fs.mkdir(path.dirname(executable), { recursive: true });
if (process.argv[2]) await fs.copyFile(path.resolve(process.argv[2]), executable);
const timestamp = new Date(Date.now() - 60000).toISOString();
const base = Date.parse(timestamp);
const line = (type, payload, ms = 0) => ({ type, timestamp: new Date(base + ms).toISOString(), payload });
const usage = (input, output, cached = 0) => ({ input_tokens: input, output_tokens: output, cached_input_tokens: cached, reasoning_output_tokens: 0, total_tokens: input + output });
const logs = [line('session_meta', { id: 'dashboard-synthetic-main', timestamp, cwd: root, source: 'cli', cli_version: '0.144.0' })];
let input = 0, output = 0, cached = 0;
for (const [index, model, inTokens, outTokens, cacheTokens] of [[0, 'gpt-6.1-sol', 1000, 100, 800], [1, 'gpt-6-astra', 2000, 200, 300], [2, 'gpt-6.1-sol', 3000, 300, 2400]]) {
  const ms = index * 10000;
  logs.push(line('turn_context', { model }, ms));
  logs.push(line('event_msg', { type: 'task_started', turn_id: 'turn-' + index }, ms));
  if (index === 1) logs.push(line('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Synthetic output' }] }, ms + 1500));
  else logs.push(line('event_msg', { type: 'item_completed', item: { type: 'Reasoning' }, started_at_ms: base + ms + 1000 }, ms + 1500));
  input += inTokens; output += outTokens; cached += cacheTokens;
  const token = line('event_msg', { type: 'token_count', info: { total_token_usage: usage(input, output, cached), last_token_usage: usage(inTokens, outTokens, cacheTokens) } }, ms + 2000);
  logs.push(token, { ...token, timestamp: new Date(base + ms + 2500).toISOString() });
  logs.push(line('event_msg', { type: 'task_complete', turn_id: 'turn-' + index, duration_ms: 3000 }, ms + 3000));
}
await fs.writeFile(path.join(codexHome, 'sessions', 'rollout-synthetic-main.jsonl'), logs.map(JSON.stringify).join('\n') + '\n');
await fs.mkdir(path.join(codexHome, 'archived_sessions'), { recursive: true });
await fs.writeFile(path.join(codexHome, 'archived_sessions', 'rollout-synthetic-main.jsonl'), logs.map(JSON.stringify).join('\n') + '\n');
const historicalAt = new Date(base - 8 * 86400000).toISOString();
const historical = [
  { type: 'session_meta', timestamp: historicalAt, payload: { id: 'dashboard-synthetic-old', timestamp: historicalAt, cwd: root, source: 'cli' } },
  { type: 'turn_context', timestamp: historicalAt, payload: { model: 'unpriced-smoke-model' } },
  { type: 'event_msg', timestamp: historicalAt, payload: { type: 'token_count', info: { total_token_usage: usage(600, 100), last_token_usage: usage(600, 100) } } },
];
await fs.writeFile(path.join(codexHome, 'archived_sessions', 'rollout-synthetic-old.jsonl'), historical.map(JSON.stringify).join('\n') + '\n');
const config = { dataDir, codexHome, resolve: () => ({ setting: { monitorSessions: true } }) };
const runtime = createDashboardRuntime(config), service = createModelUsageService(config, { runtime });
let address;
try {
  address = await runtime.start();
  const result = await service.get({ period: 'today', force: true });
  await fs.writeFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
  assert.equal(result.available, true, JSON.stringify(result));
  assert.deepEqual(result.models.map(row => [row.model, row.tokens, row.requests]), [['gpt-6.1-sol', 4400, 2], ['gpt-6-astra', 2200, 1]]);
  assert.equal(result.models[0].cacheHitPercent, 80); assert.equal(result.models[1].cacheHitPercent, 15);
  assert.ok(result.models.every(row => row.estimatedCostUsd > 0 && row.costComplete));
  assert.equal(result.models[0].tokensPerSecond, 200); assert.equal(result.models[0].timedRequests, 2);
  assert.equal(result.models[1].tokensPerSecond, null); assert.equal(result.models[1].timedRequests, 0);
  const all = await service.get({ period: 'all' });
  assert.deepEqual(all.models.slice(0, 2), result.models);
  const old = all.models.find(row => row.model === 'unpriced-smoke-model');
  assert.equal(old.tokens, 700); assert.equal(old.requests, 1); assert.equal(old.estimatedCostUsd, null); assert.equal(old.costComplete, false);
  const week = await service.get({ period: '7d' }); assert.deepEqual(week.models, result.models);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally {
  await service.close();
}
await assert.rejects(fetch(address + '/api/health', { signal: AbortSignal.timeout(1000) }));
process.stdout.write('Real dashboard accounting, model switching, duplicate snapshots/archives, date ranges, unknown pricing, timing and owned process shutdown passed.\n');
