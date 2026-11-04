(() => {
  'use strict';
  function duration(text) {
    return Math.max(8000, Math.min(15000, 2000 + Array.from(text).length * 180));
  }
  function create({ visible, blocked, show, clear }) {
    let pending = false;
    let epoch = 0;
    let enabled = false;
    let currentId = null;
    let serverRevision = null;
    let lastPoll = -Infinity;
    function invalidate() {
      epoch++;
      clear();
      lastPoll = -Infinity;
      fetch('/api/reaction-notices/invalidate', { method: 'POST' }).catch(() => {});
    }
    function acknowledge(id, shown) {
      return fetch('/api/reaction-notices/ack', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, shown })
      }).catch(() => {});
    }
    async function poll() {
      if (pending) return;
      if (!enabled && Date.now() - lastPoll < 1000) return;
      lastPoll = Date.now();
      pending = true;
      const generation = epoch;
      let response, result;
      try {
        response = await fetch(`/api/reaction-notices?visible=${visible() ? 1 : 0}&blocked=${blocked() ? 1 : 0}`, { cache: 'no-store' });
        result = await response.json();
      } catch {
        // The disconnected local host cannot supply a new reaction.
        return;
      } finally { pending = false; }
      if (!response.ok || !result.ok) return;
      if (Number.isSafeInteger(result.revision) && result.revision !== serverRevision) {
        if (serverRevision !== null) clear();
        serverRevision = result.revision;
      }
      const revision = serverRevision;
      enabled = result.enabled === true;
      if (!enabled) clear();
      const notice = result.notice;
      if (!notice || typeof notice.id !== 'string' || notice.id === currentId) return;
      currentId = notice.id;
      let finished = false;
      const finish = shown => {
        if (finished) return;
        finished = true;
        acknowledge(notice.id, shown);
      };
      const valid = () => generation === epoch && revision === serverRevision && notice.id === currentId && enabled && visible() && !blocked() &&
        typeof notice.text === 'string' && notice.text.length > 0 &&
        Number.isFinite(notice.expiresAt) && Date.now() < notice.expiresAt;
      if (!valid() || !show(notice, { valid, shown: () => finish(true), discarded: () => finish(false) })) finish(false);
    }
    return { poll, invalidate };
  }
  window.WhaleReactionNotices = Object.freeze({ create, duration });
})();
