import test from 'node:test';
import assert from 'node:assert/strict';
import { SendReactions } from '../runtime/send-reactions.mjs';
import { REACTION_QUESTIONS, chooseReaction } from '../runtime/reaction-policy.mjs';
import { JevConnectionError } from '../runtime/jev-connection.mjs';

function result({ relation = 'unavailable', emotion = 'strong_positive', occasion = 'finished', holdBack = 0.01 } = {}) {
  const answers = { hold_back: { type: 'noul', noul: holdBack } };
  for (const [name, choice] of Object.entries({ relation, emotion, occasion })) {
    answers[name] = { type: 'choice', choice, probabilities: Object.fromEntries(Object.keys(REACTION_QUESTIONS[name].criteria).map(key => [key, key === choice ? 1 : 0])) };
  }
  return { answers };
}
function fixture(t, decide = async () => result()) {
  let time = 100000, enabled = false, sourceCallbacks, blocked = false;
  const calls = [], lifecycle = [];
  const service = new SendReactions({ now: () => time, isBlocked: () => blocked,
    connection: { store: { load: () => ({ enabled }) }, decide: async (...args) => { calls.push(args); return decide(...args); } },
    sourceFactory(callbacks) { sourceCallbacks = callbacks; return { start() { lifecycle.push('start'); }, stop() { lifecycle.push('stop'); }, status() { return { source: 'synthetic', suggestionSupport: false }; } }; },
  });
  t.after(() => service.close());
  const context = { visible: true, blocked: false };
  return { service, calls, lifecycle, context,
    enable(value = true) { enabled = value; service.configure(); service.poll(context); },
    advance(ms) { time += ms; }, block(value) { blocked = value; },
    send(id = 'm1', text = '终于全做好啦，太开心了，可以收工！', extra = {}) {
      sourceCallbacks.onContext({ type: 'send', id });
      return sourceCallbacks.onSend({ id, threadId: 'thread', at: time, text, ...extra });
    },
  };
}

test('off means no source start or model call; enabling and disabling start and stop content observation', async t => {
  const f = fixture(t); f.service.configure();
  await f.send(); assert.equal(f.calls.length, 0); assert.equal(f.lifecycle.includes('start'), false);
  f.enable(); await f.send('new'); assert.equal(f.calls.length, 1);
  f.enable(false); assert.equal(f.service.poll(f.context).notice, null);
  await f.send('disabled'); assert.equal(f.calls.length, 1);
});

test('user-only payload contains exactly this short message; long and stale messages are never uploaded', async t => {
  const f = fixture(t); f.enable();
  await f.send('short', ' 好开心！ ');
  assert.deepEqual(f.calls[0][0], { route: 'user_only', user_message: '好开心！' });
  await f.send('long', '😀'.repeat(301)); await f.send('empty', '  ');
  await f.send('stale', '开心', { at: 97999 });
  assert.equal(f.calls.length, 1);
  await f.send('boundary', '😀'.repeat(300)); assert.equal(f.calls.length, 2);
});

test('trusted paired snapshot preserves negation and drops oversized recommendations', async t => {
  const f = fixture(t); f.enable();
  await f.send('paired', '不要做 A', { recommendations: ['做 A'] });
  assert.deepEqual(f.calls[0][0], { route: 'paired', user_message: '不要做 A', recommendations: ['做 A'], local_comparison: 'different' });
  await f.send('invalid', '做 A', { recommendations: ['a'.repeat(301)] });
  assert.deepEqual(f.calls[1][0], { route: 'user_only', user_message: '做 A' });
});

test('new message, disable/re-enable and hiding prevent late model results from displaying', async t => {
  let resolve;
  const f = fixture(t, () => new Promise(done => { resolve = done; })); f.enable();
  let pending = f.send('old'); const signal = f.calls[0][2].signal;
  await f.send('long-new', 'a'.repeat(301)); resolve(result()); await pending;
  assert.equal(signal.aborted, true); assert.equal(f.service.poll(f.context).notice, null);
  pending = f.send('before-disable'); f.enable(false); f.enable(); resolve(result()); await pending;
  assert.equal(f.service.poll(f.context).notice, null);
  pending = f.send('before-hide'); f.service.poll({ visible: false, blocked: false }); resolve(result()); await pending;
  assert.equal(f.service.poll(f.context).notice, null);
});

test('expired results, menu conflicts and real interaction reminders never appear as reactions', async t => {
  let resolve;
  const f = fixture(t, () => new Promise(done => { resolve = done; })); f.enable();
  let pending = f.send(); f.advance(2000); resolve(result()); await pending;
  assert.equal(f.service.poll(f.context).notice, null);
  pending = f.send('blocked'); f.block(true); resolve(result()); await pending;
  assert.equal(f.service.poll(f.context).notice, null);
  f.block(false); f.service.poll({ visible: true, blocked: true });
  await f.send('menu'); assert.equal(f.calls.length, 2);
});

test('an observed transient business reminder permanently invalidates the old judgment', async t => {
  let resolve;
  const f = fixture(t, () => new Promise(done => { resolve = done; })); f.enable();
  const pending = f.send();
  f.block(true); f.service.poll(f.context);
  f.block(false); f.service.poll(f.context);
  resolve(result()); await pending;
  assert.equal(f.calls[0][2].signal.aborted, true);
  assert.equal(f.service.poll(f.context).notice, null);
});

test('only actual presentation starts cooldown; rejected notices are discarded and never queued', async t => {
  const f = fixture(t); f.enable(); await f.send();
  let notice = f.service.poll(f.context).notice; assert.ok(notice);
  f.service.acknowledge({ id: notice.id, shown: false });
  assert.equal(f.service.poll(f.context).notice, null);
  await f.send('retry'); notice = f.service.poll(f.context).notice; assert.ok(notice);
  f.service.acknowledge({ id: notice.id, shown: true });
  f.advance(100); await f.send('cooldown'); assert.equal(f.service.poll(f.context).notice, null);
  f.advance(10000); await f.send('same-line'); assert.equal(f.service.poll(f.context).notice, null);
});

test('request rate is bounded without delayed replay', async t => {
  const f = fixture(t, async () => result({ emotion: 'weak_or_none', occasion: 'none' })); f.enable();
  for (let i = 0; i < 31; i++) await f.send('m' + i);
  assert.equal(f.calls.length, 30); assert.equal(f.service.status().lastDecision, 'rate-limited');
  f.advance(60000); await f.send('later'); assert.equal(f.calls.length, 31);
});

test('authentication errors stop automatic attempts; network errors back off; re-enabling resets the error period', async t => {
  let code = 'HTTP_401';
  const f = fixture(t, async () => { throw new JevConnectionError(code, '测试失败'); }); f.enable();
  await f.send('bad-key'); await f.send('no-retry'); assert.equal(f.calls.length, 1);
  f.enable(); code = 'NETWORK'; await f.send('bad-proxy'); await f.send('backoff'); assert.equal(f.calls.length, 2);
  f.advance(30000); await f.send('new-attempt'); assert.equal(f.calls.length, 3);
  assert.equal(f.service.status().lastDecision, 'error');
});

test('policy uses content adoption and configured personality without a second arbitrary willingness score', () => {
  const matched = { route: 'paired', local_comparison: 'exact' };
  const adopted = result({ relation: 'adopted', emotion: 'weak_or_none', occasion: 'none' });
  assert.equal(chooseReaction(adopted, matched).id, 'proud_1');
  assert.equal(chooseReaction(adopted, matched, 'proud_1').id, 'proud_2');
  assert.equal(chooseReaction(adopted, { route: 'user_only' }), null);
});

test('strong emotion still requires suitable literal line conditions and cannot override a request for quiet', () => {
  assert.equal(chooseReaction(result({ holdBack: 0.9 }), { route: 'user_only' }), null);
  assert.equal(chooseReaction(result({ occasion: 'none' }), { route: 'user_only' }), null);
  assert.equal(chooseReaction(result({ occasion: 'hard_success' }), { route: 'user_only' }).id, 'celebrate_2');
  assert.equal(chooseReaction(result({ emotion: 'strong_distress', occasion: 'rest' }), { route: 'user_only' }).id, 'support_1');
});

test('malformed model answers are errors, not user intent or defaults', () => {
  assert.throws(() => chooseReaction({}, { route: 'user_only' }), error => error.code === 'RESPONSE');
  const malformed = result(); malformed.answers.hold_back.noul = 4;
  assert.throws(() => chooseReaction(malformed, { route: 'user_only' }), error => error.code === 'RESPONSE');
  const unknown = result(); unknown.answers.emotion.choice = 'surprise';
  assert.throws(() => chooseReaction(unknown, { route: 'user_only' }), error => error.code === 'RESPONSE');
});
