import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
const show = source.slice(source.indexOf('function show()'), source.indexOf('function toggle()'));
const recover = source.slice(source.indexOf('function recoverRenderer('), source.indexOf('function setMode('));
function fixture(overrides = {}) {
  const s = { manuallyHidden: true, rendererReady: false, readyTimer: 1, recoveryTimer: null, recoveryAttempts: 0,
    quitting: false, reloads: 0, shows: 0, loading: true, diagnose() {},
    setTimeout(fn) { s.pending = fn; return 2; },
    visibilityController: { requestRecovery() { s.shows++; } },
    window: { isDestroyed: () => false, webContents: { isLoading: () => s.loading, reload() { s.reloads++; } } }, ...overrides };
  vm.createContext(s); vm.runInContext(show + recover, s); return s;
}
test('repeated show during startup never schedules a page reload', () => {
  const s = fixture(); for (let i = 0; i < 20; i++) s.show();
  assert.equal(s.recoveryAttempts, 0); assert.equal(s.pending, undefined); assert.equal(s.manuallyHidden, false);
});
test('a pending recovery cannot reload a page that became ready', () => {
  const s = fixture({readyTimer: null, loading: false}); s.show();
  assert.equal(s.recoveryAttempts, 1); s.rendererReady = true; s.pending(); assert.equal(s.reloads, 0);
});
test('a genuinely unready idle renderer still permits one bounded manual recovery', () => {
  const s = fixture({readyTimer: null, loading: false}); s.show(); s.show();
  assert.equal(s.recoveryAttempts, 1); s.pending(); assert.equal(s.reloads, 1);
});
