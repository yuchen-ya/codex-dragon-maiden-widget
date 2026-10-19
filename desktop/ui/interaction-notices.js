(function (host) {
  'use strict';
  function create({ fetch: request = host.fetch.bind(host), storage = host.localStorage, enabled, show, clear }) {
    const key = 'dshw-interaction-notified';
    let remembered = [];
    try { remembered = JSON.parse(storage.getItem(key) || '[]'); }
    catch (error) { if (!(error instanceof SyntaxError) && error.name !== 'SecurityError') throw error; }
    const seen = new Set(Array.isArray(remembered) ? remembered.filter(id => typeof id === 'string') : []);
    let pending = new Set(), current = null, busy = false, lastError = null;
    function remember(id) {
      seen.add(id);
      for (const old of seen) { if (seen.size <= 256) break; if (!pending.has(old)) seen.delete(old); }
      try { storage.setItem(key, JSON.stringify([...seen])); }
      catch (error) { if (!['SecurityError', 'QuotaExceededError'].includes(error.name)) throw error; }
    }
    function dismiss() {
      if (!current) return;
      const id = current; remember(id); current = null; clear(id);
    }
    async function poll() {
      if (busy) return;
      busy = true;
      try {
        let data;
        try {
          const response = await request('/api/interaction-notices', { cache: 'no-store' });
          if (!response.ok) throw Error('无法读取交互提醒');
          data = await response.json();
          if (!data.ok || !Array.isArray(data.notices)) throw Error('交互提醒格式错误');
        } catch (error) { lastError = error; return; }
        const notices = data.notices.filter(item => item && typeof item.id === 'string' && ['question', 'approval'].includes(item.kind));
        pending = new Set(notices.map(item => item.id)); lastError = null;
        if (current && !pending.has(current)) { const id = current; current = null; clear(id); }
        if (!enabled()) return;
        const item = notices.find(notice => !seen.has(notice.id) && notice.id !== current);
        if (!item) return;
        current = item.id;
        host.console?.debug('[小龙娘提醒] received', item.kind, item.id);
        const accepted = show(item, {
          valid: () => current === item.id && pending.has(item.id) && enabled(),
          shown: () => { remember(item.id); host.console?.debug('[小龙娘提醒] shown', item.kind, item.id); },
          discarded: () => { if (current === item.id) current = null; }
        });
        if (!accepted && current === item.id) current = null;
      } finally { busy = false; }
    }
    return Object.freeze({ poll, dismiss, get error() { return lastError; } });
  }
  host.WhaleInteractionNotices = Object.freeze({ create });
})(typeof globalThis === 'object' ? globalThis : this);
