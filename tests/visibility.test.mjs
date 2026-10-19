import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createVisibilityController } = createRequire(import.meta.url)('../desktop/visibility.cjs');

function fixture() {
  let state = { ready: true, host: { hostAlive: true, hostPid: 1, window: '1', visible: true, attached: true, visibilityRevision: 0 } };
  let visible = false, destroyed = false, id = 0, time = 0;
  const calls = [], timers = new Map(), cancelled = [];
  const window = { isDestroyed: () => destroyed, isVisible: () => visible, hide() { visible = false; calls.push('hide'); }, showInactive() { visible = true; calls.push('show'); } };
  const controller = createVisibilityController({ getWindow: () => window, getState: () => state, now: () => time, schedule: fn => { timers.set(++id, fn); return id; }, cancel: n => { cancelled.push(timers.get(n)); timers.delete(n); } });
  return { controller, calls, timers, cancelled, advance: ms => { time += ms; }, set: value => { state = { ...state, ...value, host: { ...state.host, ...value.host } }; }, destroy: () => { destroyed = true; }, visible: () => visible, pretendVisible: () => { visible = true; }, flush: () => { const batch = [...timers.values()]; timers.clear(); batch.forEach(fn => fn()); } };
}

test('late native hidden samples from our remap cannot feed another recovery', () => {
  const f = fixture(); f.controller.update(); f.advance(2000);
  f.controller.requestRecovery(); f.set({ host: { widgetVisible: false } });
  assert.equal(f.controller.observeNativeVisibility(), false);
  f.flush();
  for (let i = 0; i < 14; i++) { f.advance(100); assert.equal(f.controller.observeNativeVisibility(), false); }
  f.set({ host: { widgetVisible: true } }); f.controller.observeNativeVisibility();
  f.advance(3000); f.controller.update();
  assert.deepEqual(f.calls, ['show', 'hide', 'show']);
});

test('persistent native hidden window recovers, but transient and guarded reports do not', () => {
  const f = fixture(); f.controller.update(); f.advance(2000);
  f.set({ host: { widgetVisible: false } }); assert.equal(f.controller.observeNativeVisibility(), false);
  f.advance(200); assert.equal(f.controller.observeNativeVisibility(), false);
  f.set({ host: { widgetVisible: true } }); f.controller.observeNativeVisibility();
  f.set({ host: { widgetVisible: false } }); f.advance(2000); assert.equal(f.controller.observeNativeVisibility(), false);
  f.advance(250); assert.equal(f.controller.observeNativeVisibility(), true); f.flush();
  f.advance(2000); f.set({ manuallyHidden: true }); f.controller.update();
  f.controller.observeNativeVisibility(); f.advance(2000); assert.equal(f.controller.observeNativeVisibility(), false);
  assert.equal(f.controller.snapshot().remaps, 1);
});

test('permanently hidden native surface has a bounded automatic retry budget', () => {
  const f = fixture(); f.controller.update(); f.set({ host: { widgetVisible: false } });
  for (let i = 0; i < 10; i++) {
    f.advance(2000); f.controller.observeNativeVisibility(); f.advance(250);
    f.controller.observeNativeVisibility(); f.flush();
  }
  assert.equal(f.controller.snapshot().remaps, 3);
  f.controller.requestRecovery(); f.flush(); assert.equal(f.controller.snapshot().remaps, 4);
});

test('owned-window restore remaps even when Chromium reports visible', () => {
  const f = fixture(); f.controller.update();
  f.set({ host: { visible: false } }); f.controller.update(); f.pretendVisible();
  f.set({ host: { visible: true } }); f.controller.update();
  assert.deepEqual(f.calls, ['show', 'hide', 'hide']); assert.equal(f.visible(), false);
  f.flush(); assert.equal(f.visible(), true); assert.equal(f.controller.snapshot().remaps, 1);
});

test('persistent event epoch recovers a complete minimize/restore missed by sampling', () => {
  const f = fixture(); f.controller.update();
  f.set({ host: { visibilityRevision: 2 } }); f.controller.update();
  for (let n = 0; n < 1000; n++) f.controller.update();
  assert.equal(f.timers.size, 1); f.flush(); assert.equal(f.controller.snapshot().remaps, 1);
  for (let n = 0; n < 1000; n++) f.controller.update();
  assert.deepEqual(f.calls, ['show', 'hide', 'show']);
});

test('explicit show recovers a cached-visible overlay once without heartbeat redraws', () => {
  const f = fixture(); f.controller.update(); f.pretendVisible();
  f.controller.requestRecovery();
  assert.deepEqual(f.calls, ['show', 'hide']); assert.equal(f.timers.size, 1);
  // Repeated show requests share the pending recovery instead of postponing it.
  for (let n = 0; n < 100; n++) f.controller.requestRecovery();
  assert.equal(f.timers.size, 1); f.flush();
  for (let n = 0; n < 1000; n++) f.controller.update();
  assert.deepEqual(f.calls, ['show', 'hide', 'show']);
  assert.equal(f.controller.snapshot().remaps, 1);
  // A later explicit request must still work without any host-state transition.
  f.controller.requestRecovery(); f.flush();
  assert.deepEqual(f.calls, ['show', 'hide', 'show', 'hide', 'show']);
});

test('return-to-host epoch recovers while host visibility never changes', () => {
  const f = fixture(); f.controller.update();
  for (let epoch = 1; epoch <= 3; epoch++) {
    f.pretendVisible(); f.set({ host: { visible: true, visibilityRevision: epoch } });
    f.controller.update(); assert.equal(f.visible(), false);
    for (let n = 0; n < 100; n++) f.controller.update();
    assert.equal(f.timers.size, 1); f.flush();
    assert.equal(f.visible(), true); assert.equal(f.controller.snapshot().remaps, epoch);
    for (let n = 0; n < 100; n++) f.controller.update();
    assert.equal(f.timers.size, 0);
  }
  assert.deepEqual(f.calls, ['show', 'hide', 'show', 'hide', 'show', 'hide', 'show']);
});

test('new lifecycle event replaces pending remap and stale callbacks cannot show', () => {
  const f = fixture(); f.controller.update();
  f.set({ host: { visibilityRevision: 1 } }); f.controller.update();
  f.set({ host: { visibilityRevision: 2 } }); f.controller.update();
  f.cancelled.forEach(fn => fn?.()); assert.equal(f.visible(), false); assert.equal(f.timers.size, 1);
  f.controller.update(); assert.equal(f.timers.size, 1); f.flush(); assert.equal(f.controller.snapshot().remaps, 1);
});

for (const [name, state] of Object.entries({ manual: { manuallyHidden: true }, minimize: { host: { visible: false } }, modal: { host: { modal: true } }, detached: { host: { attached: false } }, reload: { ready: false }, quit: { quitting: true }, deadHost: { host: { hostAlive: false } } })) {
  test(`${name} cancels remap and no stale timer resurrects overlay`, () => {
    const f = fixture(); f.controller.update(); f.set({ host: { visibilityRevision: 1 } }); f.controller.update();
    f.set(state); f.controller.update(); f.cancelled.forEach(fn => fn?.()); f.flush();
    assert.equal(f.visible(), false); assert.equal(f.controller.snapshot().remaps, 0);
  });
  test(`${name} blocks explicit recovery and return-to-host events`, () => {
    const f = fixture(); f.controller.update(); f.controller.requestRecovery();
    f.set(state); f.controller.requestRecovery();
    f.set({ host: { visibilityRevision: 1 } }); f.controller.update();
    f.cancelled.forEach(fn => fn?.()); f.flush();
    assert.equal(f.visible(), false); assert.equal(f.timers.size, 0);
    assert.equal(f.controller.snapshot().remaps, 0);
  });
}

test('modal close and host replacement each get one settled remap', () => {
  const f = fixture(); f.controller.update(); f.set({ host: { modal: true } }); f.controller.update();
  f.set({ host: { modal: false } }); f.controller.update(); f.flush();
  f.set({ host: { hostPid: 2, window: '2' } }); f.controller.update(); f.flush();
  assert.equal(f.controller.snapshot().remaps, 2);
});

test('destroy/dispose while remapping cannot call a dead window', () => {
  for (const dispose of [true, false]) {
    const f = fixture(); f.controller.update(); f.set({ host: { visibilityRevision: 1 } }); f.controller.update();
    if (dispose) f.controller.dispose(); else f.destroy();
    f.flush(); f.cancelled.forEach(fn => fn?.()); assert.equal(f.controller.snapshot().remaps, 0);
  }
});

test('1000 rapid lifecycle cycles settle without accumulated timers or heartbeat redraws', () => {
  const f = fixture(); f.controller.update();
  for (let n = 1; n <= 1000; n++) {
    f.set({ host: { visible: false, visibilityRevision: n * 2 } }); f.controller.update();
    f.set({ host: { visible: true, visibilityRevision: n * 2 + 1 } }); f.controller.update();
    assert.equal(f.timers.size, 1); f.flush();
  }
  assert.equal(f.controller.snapshot().remaps, 1000); assert.equal(f.timers.size, 0);
});
