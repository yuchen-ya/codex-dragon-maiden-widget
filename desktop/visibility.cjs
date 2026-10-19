// Windows can hide/remap an owned HWND without changing Chromium's cached
// visibility. Recover only for explicit show requests or lifecycle boundaries,
// never on a normal heartbeat or move. Injected timers make cancellation testable.
function createVisibilityController({ getWindow, getState, onShown = () => {}, schedule = setTimeout, cancel = clearTimeout, delayMs = 40, now = Date.now }) {
  let pending = null, generation = 0, disposed = false, desired = null;
  let shown = false, recover = false, hostKey = null, revision = null, remaps = 0;
  let shownAt = -Infinity, hiddenSince = null, nativeAttempts = 0;
  const wants = state => !state.quitting && state.ready && !state.manuallyHidden && (state.standalone || (state.host?.hostAlive !== false && state.host?.visible &&
    (state.fixture || state.host?.attached) && !state.host?.modal));
  const key = state => state.standalone ? 'standalone' : String(state.host?.hostPid ?? '') + ':' + String(state.host?.window ?? '');
  const epoch = state => !state.standalone && Number.isSafeInteger(state.host?.visibilityRevision) ? state.host.visibilityRevision : null;
  function clear() { generation++; if (pending !== null) cancel(pending); pending = null; }
  function update() {
    if (disposed) return;
    const window = getWindow(), state = getState();
    if (!window || window.isDestroyed()) { clear(); return; }
    const next = !!wants(state), nextKey = key(state), nextRevision = epoch(state);
    const changed = (hostKey !== null && hostKey !== nextKey) ||
      (revision !== null && nextRevision !== null && revision !== nextRevision);
    if (hostKey !== nextKey) { hiddenSince = null; nativeAttempts = 0; }
    hostKey = nextKey; revision = nextRevision;
    if (changed && shown) { recover = true; clear(); }
    if (!next) {
      clear();
      if (desired !== false || window.isVisible()) window.hide();
      if (shown) recover = true;
      desired = false;
      return;
    }
    if (desired === false && shown) recover = true;
    desired = true;
    if (pending !== null) return;
    if (shown && !window.isVisible()) recover = true;
    if (recover) {
      window.hide();
      const ticket = ++generation, targetKey = hostKey, targetRevision = revision;
      pending = schedule(() => {
        if (disposed || ticket !== generation) return;
        pending = null;
        if (window !== getWindow() || window.isDestroyed()) return;
        const current = getState();
        if (!wants(current) || key(current) !== targetKey || epoch(current) !== targetRevision) { update(); return; }
        // Clear before show: its synchronous show event can request an update.
        recover = false; shown = true; remaps++;
        shownAt = now(); hiddenSince = null;
        window.showInactive(); onShown();
      }, delayMs);
    } else if (!shown || !window.isVisible()) {
      shown = true; shownAt = now(); hiddenSince = null; window.showInactive(); onShown();
    }
  }
  function requestRecovery() {
    if (disposed) return;
    // isVisible() may still be true while the owned HWND has lost its surface.
    // Coalesce requests while settling; update still enforces every hide guard.
    recover = true;
    update();
  }
  function observeNativeVisibility() {
    const state = getState(), time = now();
    // Samples can arrive after our own hide/show. Require a settled,
    // persistently hidden HWND before treating a sample as a new failure.
    if (disposed || pending !== null || !shown || !desired || !wants(state) || state.standalone ||
        time - shownAt < 1500 || state.host?.widgetVisible !== false) {
      hiddenSince = null;
      if (state.host?.widgetVisible === true) nativeAttempts = 0;
      return false;
    }
    if (hiddenSince === null) { hiddenSince = time; return false; }
    if (time - hiddenSince < 250 || nativeAttempts >= 3) return false;
    nativeAttempts++; hiddenSince = null;
    requestRecovery();
    return true;
  }
  return { update, requestRecovery, observeNativeVisibility, dispose() { disposed = true; clear(); }, snapshot: () => ({ desired, pending: pending !== null, remaps }) };
}
module.exports = { createVisibilityController };
