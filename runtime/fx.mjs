import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const FX_URL = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY';
const SOURCE = 'Frankfurter · 每日参考汇率';
export const FX_POLICY = Object.freeze({ ttlMs: 6 * 60 * 60 * 1000, manualCooldownMs: 15000,
  failureBackoffMs: 60000, timeoutMs: 8000, maxBytes: 64 * 1024, tickMs: 30000, wakeGapMs: 90000 });
const DAY = 86400000, BEIJING = 8 * 60 * 60 * 1000, DAILY_MINUTE = 15 * 60 * 1000;
const automaticReasons = new Set(['startup', 'timer', 'daily', 'wake', 'online', 'visibility']);

// A slot begins at 00:15 in Beijing, independent of the machine's timezone/DST.
export function dailySlot(at) { return new Date(at + BEIJING - DAILY_MINUTE).toISOString().slice(0, 10); }
export function nextDailyCheck(at) { return (Math.floor((at + BEIJING - DAILY_MINUTE) / DAY) + 1) * DAY - BEIJING + DAILY_MINUTE; }
export function validQuoteDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00.000Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
function validQuote(value) {
  return value && typeof value.usdCny === 'number' && Number.isFinite(value.usdCny) && value.usdCny > 0 &&
    value.usdCny < 1e6 && validQuoteDate(value.date) && validTime(value.retrievedAt);
}
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(new Error('FX request aborted'));
  let abort;
  const cancelled = new Promise((_, reject) => { abort = () => reject(new Error('FX request aborted')); signal.addEventListener('abort', abort, { once: true }); });
  return Promise.race([promise, cancelled]).finally(() => signal.removeEventListener('abort', abort));
}
async function boundedJson(response, signal) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > FX_POLICY.maxBytes) {
    response.body?.cancel?.().catch(() => {}); throw new Error('FX response too large');
  }
  if (!response.body?.getReader) {
    // In-process adapter/test responses may expose JSON without a byte stream.
    if (typeof response.json !== 'function') throw new Error('FX response has no body');
    const value = await abortable(Promise.resolve().then(() => response.json()), signal);
    if (Buffer.byteLength(JSON.stringify(value) || '') > FX_POLICY.maxBytes) throw new Error('FX response too large');
    return value;
  }
  const reader = response.body.getReader(), chunks = []; let length = 0, complete = false;
  try {
    while (true) {
      const item = await abortable(reader.read(), signal);
      if (item.done) { complete = true; break; }
      length += item.value.byteLength;
      if (length > FX_POLICY.maxBytes) throw new Error('FX response too large');
      chunks.push(Buffer.from(item.value));
    }
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8').replace(/^\uFEFF/, ''));
  } finally {
    if (!complete) reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// The fixed public endpoint never receives the API provider's credentials.
export function createFxService({ dataDir, fetchImpl = fetch, now = Date.now, timeoutMs = FX_POLICY.timeoutMs,
  timers = { setTimeout, clearTimeout }, tickMs = FX_POLICY.tickMs, wakeGapMs = FX_POLICY.wakeGapMs } = {}) {
  const file = path.join(dataDir, 'display-fx.json');
  let cached = null, pending = null, controller = null, periodic = null, started = false, closed = false;
  let checkedAt = null, lastManualAt = null, lastAttemptFailed = false, lastTickAt = null;
  const loaded = fs.readFile(file, 'utf8').then(text => {
    const value = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (validQuote(value)) {
      cached = { usdCny: value.usdCny, date: value.date, retrievedAt: value.retrievedAt };
      checkedAt = validTime(value.checkedAt) ? Date.parse(value.checkedAt) : Date.parse(value.retrievedAt);
      lastAttemptFailed = value.lastAttemptFailed === true;
      lastManualAt = Number.isFinite(value.lastManualAt) ? value.lastManualAt : null;
    }
  }).catch(() => {});
  const remaining = (at, period) => at === null || now() < at ? 0 : Math.max(0, period - (now() - at));
  const backoff = () => lastAttemptFailed ? remaining(checkedAt, FX_POLICY.failureBackoffMs) : 0;
  function isStale() {
    if (!cached || lastAttemptFailed) return true;
    const age = now() - Date.parse(cached.retrievedAt);
    return age < 0 || age >= FX_POLICY.ttlMs || dailySlot(now()) !== dailySlot(Date.parse(cached.retrievedAt));
  }
  const result = () => ({ ...cached, checkedAt: checkedAt === null ? null : new Date(checkedAt).toISOString(),
    base: 'USD', quote: 'CNY', source: SOURCE, sourceUrl: FX_URL, stale: isStale(),
    cooldownRemainingMs: remaining(lastManualAt, FX_POLICY.manualCooldownMs), retryAfterMs: backoff(),
    nextDailyCheckAt: new Date(nextDailyCheck(now())).toISOString() });
  function unavailable() {
    const error = new Error('暂时无法取得 USD/CNY 汇率，已保留原显示币种，请稍后重试。');
    error.cooldownRemainingMs = remaining(lastManualAt, FX_POLICY.manualCooldownMs); error.retryAfterMs = backoff();
    error.checkedAt = checkedAt === null ? null : new Date(checkedAt).toISOString(); return error;
  }
  async function persist() {
    if (!cached || closed) return;
    const temp = file + '.' + process.pid + '.' + randomUUID() + '.tmp';
    try {
      await fs.mkdir(dataDir, { recursive: true });
      if (closed) return;
      await fs.writeFile(temp, JSON.stringify({ ...cached, checkedAt: new Date(checkedAt).toISOString(), lastAttemptFailed, lastManualAt }, null, 2), { mode: 0o600 });
      for (let attempt = 0; ; attempt++) {
        if (closed) break;
        try { await fs.rename(temp, file); return; }
        catch (error) {
          if (attempt >= 3 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) break;
          await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
        }
      }
    } catch {} // A persistence failure must not discard a validated in-memory quote.
    finally { await fs.unlink(temp).catch(() => {}); }
  }
  async function get({ force = false, reason = 'request' } = {}) {
    await loaded;
    if (closed) throw new Error('汇率服务已停止。');
    const manual = force && !automaticReasons.has(reason);
    if (pending) {
      if (manual && remaining(lastManualAt, FX_POLICY.manualCooldownMs) === 0) lastManualAt = now();
      return pending;
    }
    if (manual && remaining(lastManualAt, FX_POLICY.manualCooldownMs) > 0) {
      if (cached) return result(); throw unavailable();
    }
    if (!manual && backoff() > 0) { if (cached) return result(); throw unavailable(); }
    if (!force && cached && !isStale()) return result();
    checkedAt = now(); if (manual) lastManualAt = checkedAt;
    controller = new AbortController();
    const activeController = controller;
    const timer = timers.setTimeout(() => activeController.abort(), timeoutMs);
    pending = (async () => {
      try {
        const response = await abortable(Promise.resolve().then(() => fetchImpl(FX_URL, {
          headers: { Accept: 'application/json' }, signal: activeController.signal, redirect: 'error',
        })), activeController.signal);
        if (!response.ok) { response.body?.cancel?.().catch(() => {}); throw new Error('FX request failed'); }
        const body = await boundedJson(response, activeController.signal);
        if (closed || activeController.signal.aborted) throw new Error('FX request aborted');
        const next = { usdCny: body?.rates?.CNY, date: body?.date, retrievedAt: new Date(now()).toISOString() };
        if (body?.base !== 'USD' || body?.amount !== 1 || !validQuote(next)) throw new Error('Invalid rate');
        cached = next; lastAttemptFailed = false; await persist();
        if (closed) throw new Error('FX request aborted');
        return result();
      } catch {
        if (closed) throw new Error('汇率服务已停止。');
        lastAttemptFailed = true; await persist();
        if (cached) return result(); throw unavailable();
      } finally { timers.clearTimeout(timer); if (controller === activeController) controller = null; }
    })();
    try { return await pending; } finally { pending = null; }
  }
  function check(options = {}) {
    const reason = typeof options === 'string' ? options : options.reason || 'timer';
    return get({ force: ['wake', 'daily', 'online'].includes(reason), reason });
  }
  function schedule() {
    if (!started || closed || periodic) return;
    periodic = timers.setTimeout(async () => {
      periodic = null;
      if (!started || closed) return;
      const at = now(), wake = lastTickAt !== null && (at < lastTickAt || at - lastTickAt > wakeGapMs);
      lastTickAt = at;
      try { await check({ reason: wake ? 'wake' : 'timer' }); } catch {}
      schedule();
    }, Math.max(1, Math.min(tickMs, nextDailyCheck(now()) - now())));
    periodic?.unref?.();
  }
  function start() {
    if (closed || started) return Promise.resolve();
    started = true; lastTickAt = now(); schedule();
    return check({ reason: 'startup' }).catch(() => null);
  }
  function close() {
    closed = true; started = false; if (periodic) timers.clearTimeout(periodic); periodic = null;
    controller?.abort(); return pending?.catch(() => {}) || Promise.resolve();
  }
  return { get, start, check, close };
}
