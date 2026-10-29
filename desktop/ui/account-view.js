(() => {
  'use strict';
  const validMode = value => value === 'subscription';
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  function quotaLabel(item) { return item.windowDurationMins === 300 ? '5 小时额度' : item.windowDurationMins === 10080 ? '每周额度' : item.label || '额度窗口'; }
  function speedText(value) { return number(value) === null ? '— tok/s' : `${Number(value.toFixed(1))} tok/s`; }
  function turnBubbleModules(notice) {
    if (notice.failureKind === 'high-demand') return [{ type: 'text', text: '挤不进去...', size: 18, bold: true, rgb: 'indigo' }];
    const tokens = number(notice.tokens);
    const usage = tokens === null ? '—' : tokens >= 1000000 ? Number((tokens / 1000000).toFixed(2)) + 'M' : tokens >= 1000 ? Number((tokens / 1000).toFixed(1)) + 'K' : String(tokens);
    const label = notice.completionKind === 'cancelled' ? '本轮用量 · 取消' : notice.completionKind === 'failed' ? '本轮用量 · 未完成' : '本轮用量';
    const metrics = notice.modelMetrics || [];
    const sum = key => metrics.reduce((total, row) => total + row[key], 0);
    const duration = sum('generationMs'), input = sum('input');
    const speed = duration ? sum('timedOutput') * 1000 / duration : null;
    const cache = input ? sum('cachedInput') * 100 / input : null;
    const cost = metrics.length && metrics.every(row => number(row.apiCostUsd) !== null) && notice.metricsComplete ? sum('apiCostUsd') : null;
    const price = cost === null ? '—$' : `${Number(cost.toFixed(cost < 0.01 && cost > 0 ? 4 : 2))}$`;
    const rate = number(speed) === null ? '—t/s' : `${Number(speed.toFixed(1))}t/s`;
    return [
      { type: 'text', text: label, size: 4, bold: true, rgb: 'indigo' },
      { type: 'text', text: `${usage} tok`, size: 16, bold: true, rgb: 'indigo' },
      { type: 'text', text: `${rate} · ${price} · ${number(cache) === null ? '—' : Math.round(cache)}%命中`, size: 3, rgb: 'indigo' }
    ];
  }
  function quotaBubbleModules(subscription, recent = null) {
    const row = (text, size, rgb) => ({ type: 'text', text, size, bold: true, rgb: rgb || '' });
    if (!subscription) return [row('读取中…', 11, 'indigo')];
    const windows = subscription.available ? subscription.windows : [];
    const remaining = item => number(item.usedPercent) === null ? '—' : `${Number(Math.max(0, 100 - item.usedPercent).toFixed(1))}%`;
    const label = windows.length ? windows.map(item => item.windowDurationMins === 10080 ? '本周' : item.windowDurationMins === 300 ? '5小时' : quotaLabel(item)).join(' / ') : '额度';
    const quota = windows.length ? windows.map(item => remaining(item) + (item.stale ? '*' : '')).join(' / ') : '—';
    return [row(label, 4, 'indigo'), row('剩余 ' + quota, windows.length > 1 ? 12 : 16, 'indigo'), row(speedText(recent?.tokensPerSecond), 5, 'indigo')];
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { validMode, turnBubbleModules, quotaLabel, quotaBubbleModules };
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const key = 'dshw-account-view';
  let switching = false, modeRevision = 0, subscription = null, pending = null, recent = null, recentPending = null;
  function acceptRecent(value) {
    if (value && (!recent || value.timestamp >= recent.timestamp)) recent = value;
  }
  function refreshRecent() {
    if (recentPending) return recentPending;
    recentPending = (async () => {
      try { const response = await fetch('/api/recent-generation', { cache: 'no-store' }); if (!response.ok) throw Error('速度暂不可读'); const value = (await response.json()).recent; if (value) acceptRecent(value); else recent = null; }
      catch { recent = null; }
      window.dispatchEvent(new CustomEvent('whale-quota'));
    })().finally(() => { recentPending = null; });
    return recentPending;
  }
  function updateVisibility() {
    for (const el of document.querySelectorAll('[data-account-api]')) el.hidden = true;
    document.documentElement.dataset.accountMode = 'subscription';
  }
  function commit() {
    try { localStorage.setItem(key, 'subscription'); } catch {}
    updateVisibility();
    window.dispatchEvent(new CustomEvent('whale-account-view', { detail: { mode: 'subscription' } }));
  }
  async function setMode(next) {
    if (!validMode(next) || switching) return false;
    modeRevision++; switching = true;
    try {
      const response = await fetch('/api/display-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: next }) });
      if (!response.ok) return false;
      const result = await response.json();
      if (result.ok === false || (result.mode || result.displayMode) !== next) return false;
      commit(); return true;
    } catch { return false; }
    finally { switching = false; }
  }
  function refresh(force = false) {
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetch('/api/insights' + (force ? '?refresh=1' : ''), { cache: 'no-store' });
        if (!response.ok) throw Error('暂时无法读取额度');
        const data = await response.json();
        subscription = data.subscription || { available: false, windows: [] };
      } catch (error) {
        subscription = { available: false, windows: [], reason: error.message };
      }
      window.dispatchEvent(new CustomEvent('whale-quota'));
      return subscription;
    })().finally(() => { pending = null; });
    return pending;
  }
  function text(parent, tag, value) { const el = document.createElement(tag); el.textContent = value; parent.append(el); return el; }
  function init() {
    const menu = document.querySelector('.dshwv-menu');
    if (menu) {
      const heading = document.createElement('section'); heading.className = 'whale-account-menu';
      text(heading, 'strong', '小龙娘'); menu.prepend(heading);
      const view = menu.querySelector('.dshwv-menuview');
      if (view) {
        const rows = [...view.children];
        const groups = ['外观与位置', '声音与气泡', '用量与资源'].map(label => {
          const group = document.createElement('details'); group.className = 'whale-menu-group';
          text(group, 'summary', label); view.append(group); return group;
        });
        groups[0].open = true;
        for (const child of rows) {
          if (child.classList.contains('dshwv-menu-sep')) { child.remove(); continue; }
          const label = child.textContent;
          const index = /音效|音量|气泡|消耗提示|声音/.test(label) ? 1 : /币种|汇率|资源|工坊|API|额度|峰谷|用量/.test(label) ? 2 : 0;
          groups[index].append(child);
        }
      }
    }
    updateVisibility();
    refreshRecent(); setInterval(refreshRecent, 5000);
    window.addEventListener('whale-turn-notice', event => { if (event.detail.recentGeneration) { acceptRecent(event.detail.recentGeneration); window.dispatchEvent(new CustomEvent('whale-quota')); } });
    const initialRevision = modeRevision;
    fetch('/api/display-mode', { cache: 'no-store' }).then(async response => {
      if (!response.ok) return;
      const data = await response.json();
      if (validMode(data.mode || data.displayMode) && !switching && modeRevision === initialRevision) commit();
    }).catch(() => {});
  }
  window.WhaleAccountView = {
    get mode() { return 'subscription'; }, get subscription() { return subscription; },
    bubbleModules: () => quotaBubbleModules(subscription, recent), turnBubbleModules, refresh, refreshRecent, setMode, quotaLabel
  };
  if (document.readyState !== 'complete') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
