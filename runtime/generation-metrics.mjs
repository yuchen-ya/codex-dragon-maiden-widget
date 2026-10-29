import { estimateApiRequest } from './api-pricing.mjs';

export const SPEED_BASIS = 'first-token-generation';
export function generationDuration(event) {
  const ms = event.generation_duration_ms;
  return Number.isFinite(ms) && ms >= 100 && ms <= 3600000 ? ms : null;
}
export function metricRow() {
  return { input: 0, cachedInput: 0, output: 0, requests: 0, timedRequests: 0, timedOutput: 0, generationMs: 0, apiCostUsd: 0 };
}
export function addMetricRequest(rows, model, counts, duration, at, tier) {
  const row = rows[model] ||= metricRow();
  row.input += counts.input_tokens; row.cachedInput += counts.cached_input_tokens; row.output += counts.output_tokens; row.requests++;
  const cost = estimateApiRequest(model, counts, at, tier);
  row.apiCostUsd = cost === null || row.apiCostUsd === null ? null : row.apiCostUsd + cost;
  if (duration !== null && counts.output_tokens > 0) {
    row.timedRequests++; row.timedOutput += counts.output_tokens; row.generationMs += duration;
  }
}
export function safeMetrics(value = {}) {
  const rows = {};
  for (const [model, row] of Object.entries(value)) {
    if (!model || model.length > 150 || ['__proto__', 'prototype', 'constructor'].includes(model)) continue;
    const keys = Object.keys(metricRow()).filter(key => key !== 'apiCostUsd');
    if (!row || !keys.every(key => Number.isFinite(row[key]) && row[key] >= 0) || row.cachedInput > row.input || row.timedOutput > row.output || row.timedRequests > row.requests) continue;
    rows[model] = Object.fromEntries(keys.map(key => [key, row[key]]));
    rows[model].apiCostUsd = Number.isFinite(row.apiCostUsd) && row.apiCostUsd >= 0 ? row.apiCostUsd : null;
  }
  return rows;
}
export function summarizeMetrics(parts) {
  const models = new Map();
  for (const part of parts) for (const [model, item] of Object.entries(part || {})) {
    const row = models.get(model) || metricRow();
    for (const key of Object.keys(row)) row[key] = key === 'apiCostUsd' && (row[key] === null || item[key] === null) ? null : row[key] + item[key];
    models.set(model, row);
  }
  return [...models].map(([model, row]) => ({ model, tokens: row.input + row.output, requests: row.requests,
    tokensPerSecond: row.generationMs ? row.timedOutput * 1000 / row.generationMs : null,
    generationMs: row.generationMs, timedOutput: row.timedOutput, input: row.input, cachedInput: row.cachedInput,
    timedRequests: row.timedRequests, cacheHitPercent: row.input ? row.cachedInput * 100 / row.input : null,
    apiCostUsd: row.apiCostUsd, speedBasis: SPEED_BASIS }));
}

// First-token timing follows the pinned dashboard's RequestTimer. No request
// duration fallback: tool execution, first-token wait and user idle are excluded.
export class GenerationTimer {
  constructor() { this.reset(); this.boundary = null; this.previousCount = null; }
  reset() { this.first = null; this.outputEnd = null; this.toolEnd = null; this.usageEnd = null; }
  observe(d) {
    const at = Date.parse(d.timestamp), p = d.payload || {};
    if (!Number.isFinite(at)) return;
    if (d.type === 'turn_context') this.boundary = this.boundary === null ? at : Math.max(this.boundary, at);
    else if (d.type === 'event_msg' && ['task_started', 'turn_started', 'task_complete', 'turn_completed', 'turn_aborted', 'task_aborted'].includes(p.type)) {
      this.boundary = at; this.reset();
    } else if (d.type === 'token_usage_record' && p.usage) this.usageEnd = { at, usage: p.usage };
    else if (d.type === 'event_msg' && p.type === 'item_completed' && ['Reasoning', 'AgentMessage'].includes(p.item?.type)) {
      if (this.previousCount !== null && at >= this.previousCount && at - this.previousCount <= 100 && this.outputEnd === null) return;
      this.outputEnd = at; this.toolEnd = null;
      if (Number.isFinite(p.started_at_ms) && p.started_at_ms >= this.boundary && p.started_at_ms <= at && at - p.started_at_ms <= 3600000) this.first = this.first === null ? p.started_at_ms : Math.min(this.first, p.started_at_ms);
    } else if (d.type === 'response_item') {
      if (p.type?.endsWith('_output')) { this.boundary = at; if (this.outputEnd !== null) this.toolEnd = at; }
      else if (p.type === 'message' && p.role !== 'assistant') this.boundary = at;
      else if (p.type === 'reasoning' || p.type?.endsWith('_call') || p.type === 'message' && p.role === 'assistant') { this.outputEnd = at; this.toolEnd = null; }
    }
  }
  finish(at, counts) {
    const recorded = this.usageEnd && ['input_tokens', 'cached_input_tokens', 'output_tokens'].every(key => (this.usageEnd.usage[key] || 0) === counts[key]);
    const end = recorded ? this.usageEnd.at : this.toolEnd !== null && at - this.toolEnd >= 0 && at - this.toolEnd <= 100 ? this.outputEnd : at;
    const duration = this.first !== null ? generationDuration({ generation_duration_ms: end - this.first }) : null;
    this.reset(); this.boundary = at; this.previousCount = at;
    return duration;
  }
}
