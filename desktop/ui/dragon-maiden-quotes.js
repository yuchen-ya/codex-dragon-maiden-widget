// Text and audit provenance: docs/quote-sources.json.
(() => {
  'use strict';
  const quotes = window.DragonDialogue.groups.quotes;
  function lines(subscription) {
    const windows = subscription?.available ? subscription.windows : [];
    const fresh = windows?.length && windows.every(item => !item.stale && typeof item.usedPercent === 'number' && Number.isFinite(item.usedPercent) && item.usedPercent >= 0 && item.usedPercent <= 100);
    const remaining = fresh ? Math.min(...windows.map(item => 100 - item.usedPercent)) : null;
    return quotes.filter(item => !item.minRemainingPercent || (remaining !== null && remaining >= item.minRemainingPercent))
      // Match the upstream short-quote size; BubbleRenderer fits longer lines
      // down to the safe area while short lines retain their larger lettering.
      .map(item => ({ t: window.DragonDialogue.format(item.text), w: 1, size: 22, bold: true }));
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { quotes, lines };
  if (typeof window !== 'undefined') window.DragonMaidenQuotes = { lines };
})();
