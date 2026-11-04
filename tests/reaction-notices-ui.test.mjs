import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../desktop/ui/reaction-notices.js', import.meta.url), 'utf8');
function harness() {
  const state = { visible: true, blocked: false, enabled: true, revision: 1, notice: null, shown: [], acknowledgements: [], cleared: 0 };
  const context = vm.createContext({ window: {}, Date, fetch: async (url, options) => {
    if (url.includes('/ack')) {
      state.acknowledgements.push(JSON.parse(options.body));
      return { ok: true };
    }
    return { ok: true, json: async () => ({ ok: true, enabled: state.enabled, revision: state.revision, notice: state.notice }) };
  } });
  vm.runInContext(source, context);
  const client = context.window.WhaleReactionNotices.create({
    visible: () => state.visible, blocked: () => state.blocked,
    show: (notice, hooks) => { state.shown.push({ notice, hooks }); return true; },
    clear: () => state.cleared++
  });
  return { state, client };
}
const notice = id => ({ id, text: '做得好！', expiresAt: Date.now() + 2000 });

test('reaction is acknowledged only after presentation, and repeated deliveries do not reopen it', async () => {
  const { state, client } = harness(); state.notice = notice('one');
  await client.poll(); await client.poll();
  assert.equal(state.shown.length, 1); assert.equal(state.acknowledgements.length, 0);
  state.shown[0].hooks.shown(); state.shown[0].hooks.discarded();
  assert.deepEqual(state.acknowledgements, [{ id: 'one', shown: true }]);
});

test('blocked, hidden and expired reactions are rejected without presentation', async () => {
  const { state, client } = harness();
  state.notice = notice('blocked'); state.blocked = true; await client.poll();
  state.notice = notice('hidden'); state.blocked = false; state.visible = false; await client.poll();
  state.notice = { ...notice('expired'), expiresAt: Date.now() - 1 }; state.visible = true; await client.poll();
  assert.equal(state.shown.length, 0);
  assert.deepEqual(state.acknowledgements.map(item => item.shown), [false, false, false]);
});

test('hiding and disabling invalidate pending presentation and clear only the reaction', async () => {
  const { state, client } = harness(); state.notice = notice('one'); await client.poll();
  assert.equal(state.shown[0].hooks.valid(), true);
  client.invalidate(); assert.equal(state.shown[0].hooks.valid(), false); assert.equal(state.cleared, 1);
  state.enabled = false; state.notice = null; await client.poll(); assert.equal(state.cleared, 2);
});

test('a newer server context invalidates an already prepared frame even without a replacement notice', async () => {
  const { state, client } = harness(); state.notice = notice('one'); await client.poll();
  assert.equal(state.shown[0].hooks.valid(), true);
  state.revision++; state.notice = null; await client.poll();
  assert.equal(state.shown[0].hooks.valid(), false); assert.equal(state.cleared, 1);
});

test('native hide invalidation reaches the host even while a poll is pending', async () => {
  let resolvePoll, invalidations = 0, presentations = 0;
  const context = vm.createContext({ window: {}, Date, fetch: (url) => {
    if (url.endsWith('/invalidate')) { invalidations++; return Promise.resolve({ ok: true }); }
    if (url.includes('/ack')) return Promise.resolve({ ok: true });
    return new Promise(resolve => { resolvePoll = resolve; });
  } });
  vm.runInContext(source, context);
  const client = context.window.WhaleReactionNotices.create({ visible: () => true, blocked: () => false,
    show: () => { presentations++; return true; }, clear() {} });
  const pending = client.poll(); client.invalidate();
  assert.equal(invalidations, 1);
  resolvePoll({ ok: true, json: async () => ({ ok: true, enabled: true, revision: 1, notice: notice('old') }) });
  await pending; assert.equal(presentations, 0);
});
