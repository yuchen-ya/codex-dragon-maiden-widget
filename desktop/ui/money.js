(function (host) {
  'use strict';
  const DECIMALS = new Intl.NumberFormat('en-US', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const supported = value => value === 'USD' || value === 'CNY';
  const normalized = value => String(value || 'USD').toUpperCase();
  const time = value => typeof value === 'string' ? Date.parse(value) : NaN;
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(time(value + 'T00:00:00.000Z')) && new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) === value;

  function createMoneyState({ loadQuote, readPreference = () => null, savePreference = () => {}, now = Date.now } = {}) {
    let saved;
    try { saved = readPreference(); } catch {}
    let preferredCurrency = supported(saved) ? saved : null, nativeCurrency = 'USD', displayCurrency = 'USD';
    let quote = null, latestQuote = null, quoteJob = null, forceUpgrade = null, selection = 0, requestSerial = 0, error = '';
    let checkedAt = null, cooldownUntil = 0, retryUntil = 0;
    const listeners = new Set(), bindings = new Map();
    const snapshot = value => value && Object.freeze({ ...value });
    const pendingQuote = () => !!latestQuote && (!quote || latestQuote.usdCny !== quote.usdCny || latestQuote.date !== quote.date);
    function state() {
      return Object.freeze({ nativeCurrency, displayCurrency, preferredCurrency, quote: snapshot(quote), latestQuote: snapshot(latestQuote),
        hasPendingQuote: pendingQuote(), checkedAt, cooldownRemainingMs: Math.max(0, cooldownUntil - now()),
        retryAfterMs: Math.max(0, retryUntil - now()), refreshing: !!quoteJob || !!forceUpgrade,
        stale: !!latestQuote?.stale || !!error, error });
    }
    function refreshBindings(scope) {
      for (const [element, binding] of bindings) {
        if (!scope || element === scope || scope.contains(element)) binding.write(binding.read());
      }
    }
    function emit(updateBindings = true) {
      if (updateBindings) refreshBindings();
      const current = state();
      for (const listener of listeners) { try { listener(current); } catch {} }
    }
    function setResponseMetadata(value, failed = false) {
      checkedAt = Number.isFinite(time(value?.checkedAt)) ? value.checkedAt :
        !failed && Number.isFinite(time(value?.retrievedAt)) ? value.retrievedAt : new Date(now()).toISOString();
      cooldownUntil = now() + Math.max(0, Number(value?.cooldownRemainingMs) || 0);
      retryUntil = now() + Math.max(0, Number(value?.retryAfterMs) || 0);
    }
    function acceptQuote(value) {
      if (!value || !Number.isFinite(value.usdCny) || value.usdCny <= 0 || value.usdCny >= 1e6 ||
        !validDate(value.date) || !Number.isFinite(time(value.retrievedAt))) throw new Error('汇率数据无效');
      latestQuote = Object.freeze({ ...value });
      setResponseMetadata(value);
      error = value.stale ? '本次未取得更新报价，保留已验证的缓存汇率。' : '';
      emit(false);
      return latestQuote;
    }
    function startQuoteRequest({ force, reason }) {
      const job = { force, serial: ++requestSerial, promise: null };
      quoteJob = job;
      job.promise = Promise.resolve().then(() => loadQuote({ force, reason })).then(acceptQuote).catch(failure => {
        error = failure?.message || '汇率暂不可用，已保留当前显示。';
        setResponseMetadata(failure, true);
        if (latestQuote) latestQuote = Object.freeze({ ...latestQuote, stale: true, checkedAt });
        emit(false); throw failure;
      }).finally(() => {
        if (quoteJob === job) quoteJob = null;
        emit(false);
      });
      emit(false); return job.promise;
    }
    function getQuote({ force = false, reason = 'request' } = {}) {
      if (forceUpgrade) return forceUpgrade.promise;
      if (quoteJob) {
        if (!force || quoteJob.force) return quoteJob.promise;
        // A force click behind a normal read must still make one real forced read.
        const previous = quoteJob.promise, upgrade = { promise: null };
        forceUpgrade = upgrade;
        upgrade.promise = previous.catch(() => null).then(() => startQuoteRequest({ force: true, reason })).finally(() => {
          if (forceUpgrade === upgrade) forceUpgrade = null;
          emit(false);
        });
        emit(false); return upgrade.promise;
      }
      return startQuoteRequest({ force, reason });
    }
    function chosenDisplay() {
      if (!supported(nativeCurrency) || !supported(preferredCurrency)) return nativeCurrency;
      return preferredCurrency === nativeCurrency || quote ? preferredCurrency : nativeCurrency;
    }
    function applyLatestQuote({ refreshBindings: updateBindings = true } = {}) {
      if (latestQuote) quote = latestQuote;
      displayCurrency = chosenDisplay();
      emit(updateBindings);
      return !!quote;
    }
    async function refreshQuote({ force = false, apply = false, reason = 'request' } = {}) {
      try {
        const value = await getQuote({ force, reason });
        if (apply) applyLatestQuote();
        else emit(false);
        return !value.stale;
      } catch {
        // A failed background/manual check never erases an already displayed rate.
        if (!quote && apply) { displayCurrency = nativeCurrency; emit(); }
        else emit(false);
        return false;
      }
    }
    function convert(amount, from = nativeCurrency, to = displayCurrency) {
      from = normalized(from); to = normalized(to);
      const value = Number(amount);
      if (amount == null || !Number.isFinite(value)) return null;
      if (from === to) return value;
      if (!supported(from) || !supported(to) || !quote) return null;
      return from === 'USD' ? value * quote.usdCny : value / quote.usdCny;
    }
    function symbol() { return displayCurrency === 'USD' ? '$' : displayCurrency === 'CNY' ? '¥' : displayCurrency + ' '; }
    function unit() { return displayCurrency === 'USD' ? '美元' : displayCurrency === 'CNY' ? '人民币' : displayCurrency; }
    function formatNumber(amount, from) {
      const value = convert(amount, from);
      return value === null ? '--' : DECIMALS.format(Object.is(value, -0) ? 0 : value);
    }
    function formatMoney(amount, from, space = false) {
      if (amount === Infinity) return '不限额';
      if (amount == null) return '--';
      return symbol() + (space ? ' ' : '') + formatNumber(amount, from);
    }
    function fromDisplay(amount, to = nativeCurrency) {
      const value = convert(amount, displayCurrency, to);
      if (value === null) throw new Error('汇率尚未就绪，无法保存换算金额');
      return value;
    }
    function fresh(value) {
      const age = value ? now() - time(value.retrievedAt) : Infinity;
      return !!value && !value.stale && age >= 0 && age < 6 * 60 * 60 * 1000;
    }
    async function setDisplayCurrency(currency) {
      currency = normalized(currency);
      if (!supported(currency) || !supported(nativeCurrency)) throw new Error('显示换算目前支持 USD 和 CNY');
      const id = ++selection;
      preferredCurrency = currency;
      try { savePreference(currency); } catch {}
      const available = latestQuote || quote;
      if (currency === nativeCurrency || available) {
        applyLatestQuote();
        if (currency !== nativeCurrency && !fresh(available)) getQuote({ reason: 'currency' }).catch(() => {});
        return true;
      }
      try {
        await getQuote({ reason: 'currency' });
        if (id !== selection) return false;
        applyLatestQuote(); return true;
      } catch (failure) {
        if (id !== selection) return false;
        displayCurrency = nativeCurrency; emit(); throw failure;
      }
    }
    function setNativeCurrency(currency) {
      const next = normalized(currency);
      if (next === nativeCurrency) return;
      selection++; nativeCurrency = next; displayCurrency = chosenDisplay(); emit();
    }
    async function ready() {
      const id = selection;
      try {
        await getQuote({ reason: 'startup' });
        if (id === selection) applyLatestQuote();
        else emit(false);
        return true;
      } catch {
        if (!quote && id === selection) { displayCurrency = nativeCurrency; emit(); }
        else emit(false);
        return false;
      }
    }
    function bind(element, read, write = value => { element.textContent = value; }) {
      bindings.set(element, { read, write }); write(read()); return () => bindings.delete(element);
    }
    function clearBindings(root) {
      for (const element of bindings.keys()) if (element === root || root.contains(element)) bindings.delete(element);
    }
    function pruneBindings() { for (const element of bindings.keys()) if (!element.isConnected) bindings.delete(element); }
    function onChange(listener) { listeners.add(listener); listener(state()); return () => listeners.delete(listener); }
    return Object.freeze({ state, convert, formatNumber, formatMoney, symbol, unit, fromDisplay, setDisplayCurrency, setNativeCurrency,
      ready, refreshQuote, applyLatestQuote, bind, clearBindings, pruneBindings, refreshBindings, onChange });
  }

  if (typeof module === 'object' && module.exports) module.exports = { createMoneyState };
  else {
    const money = createMoneyState({
      readPreference: () => { try { return localStorage.getItem('dshw-display-currency'); } catch { return null; } },
      savePreference: value => { try { localStorage.setItem('dshw-display-currency', value); } catch {} },
      loadQuote: async ({ force = false, reason = 'request' } = {}) => {
        const query = [];
        if (force) query.push('refresh=1');
        const cause = force && reason === 'request' ? 'manual' : reason;
        if (cause !== 'request') query.push('reason=' + encodeURIComponent(cause));
        const response = await fetch('/api/fx/usd-cny' + (query.length ? '?' + query.join('&') : ''), { cache: 'no-store' });
        const value = await response.json();
        if (!response.ok || !value.ok) {
          const error = new Error(value.error || '汇率暂不可用，已保留原显示币种');
          for (const key of ['checkedAt', 'cooldownRemainingMs', 'retryAfterMs']) if (value[key] !== undefined) error[key] = value[key];
          throw error;
        }
        return value;
      },
    });
    host.WhaleMoney = money;
    const observer = new MutationObserver(() => money.pruneBindings());
    observer.observe(document.body, { childList: true, subtree: true });
    const periodic = setInterval(() => money.refreshQuote({ apply: false, reason: 'timer' }), 60000);
    const online = () => money.refreshQuote({ apply: false, reason: 'online' });
    const visible = () => { if (!document.hidden) money.refreshQuote({ apply: false, reason: 'visibility' }); };
    host.addEventListener?.('online', online);
    document.addEventListener('visibilitychange', visible);
    host.addEventListener?.('pagehide', () => {
      clearInterval(periodic); observer.disconnect();
      host.removeEventListener?.('online', online); document.removeEventListener('visibilitychange', visible);
    }, { once: true });
    money.ready();
  }
})(globalThis);
