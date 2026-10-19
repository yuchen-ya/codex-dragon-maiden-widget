(() => {
  'use strict';
  const validMode = value => value === 'subscription';
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  function windowText(item) {
    const used = number(item.usedPercent);
    return used === null ? '额度比例未知' : `已用 ${used.toFixed(1)}% · 剩余 ${Math.max(0, 100 - used).toFixed(1)}%${item.stale ? '（快照已过期）' : ''}`;
  }
  function tokenText(value) { const n = number(value); return n === null ? '暂无记录' : n.toLocaleString() + ' token'; }
  function quotaLabel(item) { return item.windowDurationMins === 300 ? '5 小时额度' : item.windowDurationMins === 10080 ? '每周额度' : item.label || '额度窗口'; }
  function noticeText(value) {
    if (!value || value.notify === false) return '';
    if (value.failureKind === 'high-demand') return '挤不进去...';
    return number(value.tokens) === null ? '本轮 token 暂无记录' : '本轮本机已观测：' + tokenText(value.tokens);
  }
  function quotaBubbleModules(subscription) {
    const row = (text, size, rgb) => ({ type: 'text', text, size, bold: true, rgb: rgb || '' });
    if (!subscription) return [row('Codex 额度', 8), row('读取中…', 16, 'indigo')];
    const windows = subscription.available ? subscription.windows : [];
    if (!windows?.length) return [row('Codex 额度', 8), row('暂时读不到', 14, 'indigo'), row('点角色重试', 4)];
    const remaining = item => number(item.usedPercent) === null ? '比例未知' : `剩余 ${Math.max(0, 100 - item.usedPercent).toFixed(1)}%`;
    if (windows.length > 1) return [row('Codex 额度', 7), ...windows.map(item => row(`${quotaLabel(item)} ${remaining(item)}${item.stale ? '（已过期）' : ''}`, 10, 'indigo'))];
    const item = windows[0];
    const reset = new Date(item.resetsAt);
    const resetText = item.resetsAt && Number.isFinite(reset.getTime())
      ? '重置 ' + new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(reset)
      : '重置时间未知';
    return [row(quotaLabel(item), 8), row(remaining(item), 18, 'indigo'), row(item.stale ? '快照已过期，点角色刷新' : resetText, 4)];
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { validMode, windowText, tokenText, noticeText, quotaLabel, quotaBubbleModules };
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const key = 'dshw-account-view';
  let switching = false, modeRevision = 0, subscription = null, pending = null;
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
  function notice(value) {
    const message = noticeText(value);
    if (message) window.whaleToast?.(message);
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
    const initialRevision = modeRevision;
    fetch('/api/display-mode', { cache: 'no-store' }).then(async response => {
      if (!response.ok) return;
      const data = await response.json();
      if (validMode(data.mode || data.displayMode) && !switching && modeRevision === initialRevision) commit();
    }).catch(() => {});
  }
  window.WhaleAccountView = {
    get mode() { return 'subscription'; }, get subscription() { return subscription; },
    bubbleModules: () => quotaBubbleModules(subscription), refresh, notice, setMode, quotaLabel
  };
  if (document.readyState !== 'complete') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
