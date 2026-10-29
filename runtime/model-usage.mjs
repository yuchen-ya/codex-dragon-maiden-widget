import { DATA_HOME } from './paths.mjs';
import { createDashboardRuntime, DashboardError, DASHBOARD_VERSION } from './usage-dashboard-runtime.mjs';
import { generationDuration, SPEED_BASIS } from './generation-metrics.mjs';

const periods = new Set(['today', '7d', 'all']);
const count = value => Number.isSafeInteger(value) && value >= 0;
const validNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const invalid = () => { throw new DashboardError('统计组件返回了无效数据，请刷新重试'); };
function usage(value) {
  if (!value || !['input_tokens', 'cached_input_tokens', 'output_tokens', 'total_tokens'].every(key => count(value[key])) || value.cached_input_tokens > value.input_tokens) invalid();
  return value;
}

// The dashboard's period projection supplies normalized per-request deltas.
// Zero deltas (quota-only/repeated snapshots) are not counted as requests.
export function addRequest(row, event) {
  const delta = usage(event.last_token_usage);
  if (delta.total_tokens === 0) return;
  row.requests++;
  const duration = generationDuration(event);
  if (duration === null || delta.output_tokens === 0) return;
  row.timedRequests++; row.timedOutput += delta.output_tokens; row.durationMs += duration;
}

export function createModelUsageService(config, { dataDir = config.dataDir || DATA_HOME, runtime = createDashboardRuntime({ dataDir, codexHome: config.codexHome }), fetchImpl = fetch } = {}) {
  const cache = new Map(), pending = new Map();
  const controller = new AbortController();
  let closed = false;
  async function request(base, route, params, signal) {
    let response, data;
    try { response = await fetchImpl(base + route + '?' + new URLSearchParams(params), { signal, redirect: 'error' }); }
    catch { throw new DashboardError('无法连接本机统计服务，请刷新重试'); }
    if (response.status === 409) throw new DashboardError('统计记录已更新，请刷新重试');
    if (!response.ok) throw new DashboardError('本机统计尚未就绪，请稍后刷新');
    try {
      const body = await response.text();
      if (body.length > 32 * 1024 * 1024) invalid();
      data = JSON.parse(body);
    } catch { throw new DashboardError('统计组件返回了无效数据，请刷新重试'); }
    return data;
  }
  async function collect(period) {
    const base = await runtime.start();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]);
    const deadline = Date.now() + 60000;
    while (true) {
      const health = await request(base, '/api/health', {}, signal);
      if (health.app !== 'codex-usage-dashboard' || health.version !== DASHBOARD_VERSION) invalid();
      if (health.index?.phase === 'ready') break;
      if (health.index?.phase === 'error' || Date.now() >= deadline) throw new DashboardError('本机记录索引未完成，请稍后刷新');
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    // Even "all" uses a bounded period projection to receive normalized deltas,
    // instead of the raw cumulative snapshots returned by the upstream all view.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const params = { period: period === 'all' ? 'custom' : period, timezone: 'Asia/Shanghai', limit: '100', ...(period === 'all' ? { start: '1970-01-01', end: today } : {}) };
    const first = await request(base, '/api/v2/sessions', params, signal);
    const summary = first.page?.summary;
    if (!summary || !Array.isArray(summary.model_breakdown) || typeof first.page.revision !== 'string') invalid();
    const models = new Map();
    for (const item of summary.model_breakdown) {
      if (typeof item.model !== 'string' || item.model.length > 200 || models.has(item.model) || typeof item.cost_complete !== 'boolean' || item.estimated_cost_usd !== null && !validNumber(item.estimated_cost_usd)) invalid();
      const tokens = usage(item.usage);
      models.set(item.model, { model: item.model, tokens: tokens.total_tokens, input: tokens.input_tokens, cachedInput: tokens.cached_input_tokens, output: tokens.output_tokens,
        estimatedCostUsd: item.estimated_cost_usd, costComplete: item.cost_complete,
        cacheHitPercent: tokens.input_tokens ? tokens.cached_input_tokens / tokens.input_tokens * 100 : null,
        requests: 0, timedRequests: 0, timedOutput: 0, durationMs: 0 });
    }
    const revision = first.page.revision;
    let listing = first, offset = -1;
    while (true) {
      const page = listing.page;
      if (!Array.isArray(page?.items) || page.revision !== revision || !count(page.offset) || page.offset <= offset) invalid();
      offset = page.offset;
      for (const session of page.items) {
        if (typeof session.uid !== 'string') invalid();
        let cursor = '', eventOffset = -1;
        do {
          const events = await request(base, '/api/v2/events', { ...params, revision, id: session.uid, cursor }, signal);
          if (!Array.isArray(events.events) || events.revision !== revision || !count(events.offset) || events.offset <= eventOffset) invalid();
          eventOffset = events.offset;
          for (const event of events.events) {
            const row = models.get(event.model || 'unknown');
            if (!row) invalid();
            addRequest(row, event);
          }
          cursor = events.next_cursor;
          if (cursor != null && typeof cursor !== 'string') invalid();
        } while (cursor);
      }
      if (!page.next_cursor) break;
      if (typeof page.next_cursor !== 'string') invalid();
      listing = await request(base, '/api/v2/sessions', { ...params, revision, cursor: page.next_cursor }, signal);
    }
    return { available: true, source: 'codex-usage-dashboard', version: DASHBOARD_VERSION, speedBasis: SPEED_BASIS, period, observedAt: Date.now(),
      models: [...models.values()].sort((a, b) => b.tokens - a.tokens).map(({ timedOutput, durationMs, ...row }) => ({ ...row, tokensPerSecond: durationMs ? timedOutput * 1000 / durationMs : null })) };
  }
  async function get({ period = 'today', force = false } = {}) {
    if (!periods.has(period)) throw new DashboardError('统计范围无效');
    if (closed || config.resolve().setting.monitorSessions === false) return { available: false, models: [], period, reason: closed ? '统计服务已关闭' : '本机会话观测已关闭' };
    const existing = cache.get(period);
    if (!force && existing && Date.now() - existing.observedAt < 30000) return existing;
    if (!pending.has(period)) {
      const job = collect(period).then(result => { if (!closed && config.resolve().setting.monitorSessions !== false) cache.set(period, result); return result; })
        .catch(error => { if (!(error instanceof DashboardError)) throw error; return { available: false, models: [], period, reason: error.message }; })
        .finally(() => pending.delete(period));
      pending.set(period, job);
    }
    const result = await pending.get(period);
    if (closed || config.resolve().setting.monitorSessions === false) return { available: false, models: [], period, reason: '本机会话观测已关闭' };
    return result;
  }
  return { get, async close() { closed = true; controller.abort(); cache.clear(); await runtime.close(); } };
}
