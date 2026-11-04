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
  const calls = [], lifecycle = [], diagnostics = [];
  const service = new SendReactions({ now: () => time, isBlocked: () => blocked, diagnostics: record => diagnostics.push(record),
    connection: { store: { load: () => ({ enabled }) }, decide: async (...args) => { calls.push(args); return decide(...args); } },
    sourceFactory(callbacks) { sourceCallbacks = callbacks; return { start() { lifecycle.push('start'); }, stop() { lifecycle.push('stop'); }, status() { return { source: 'synthetic', suggestionSupport: false }; } }; },
  });
  t.after(() => service.close());
  const context = { visible: true, blocked: false };
  return { service, calls, lifecycle, context, diagnostics,
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
  await f.send('stale', '开心', { at: 94999 });
  assert.equal(f.calls.length, 1);
  await f.send('boundary', '😀好'.repeat(150)); assert.equal(f.calls.length, 2);
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
  let pending = f.send(); f.advance(5000); resolve(result()); await pending;
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

test('actual presentation starts cooldown before spending money; later sends rotate lines', async t => {
  const f = fixture(t); f.enable(); await f.send();
  let notice = f.service.poll(f.context).notice; assert.ok(notice);
  f.service.acknowledge({ id: notice.id, shown: false });
  assert.equal(f.service.poll(f.context).notice, null);
  await f.send('retry'); notice = f.service.poll(f.context).notice; assert.ok(notice);
  f.service.acknowledge({ id: notice.id, shown: true });
  const paidCalls = f.calls.length;
  f.advance(100); await f.send('cooldown'); assert.equal(f.service.poll(f.context).notice, null);
  assert.equal(f.calls.length, paidCalls);
  assert.ok(f.diagnostics.some(item => item.reason === 'cooldown'));
  f.advance(10000); await f.send('same-occasion');
  notice = f.service.poll(f.context).notice;
  assert.ok(notice); assert.notEqual(notice.text, '搞定收工，本龙已经把摇尾巴模式开满啦！');
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

test('ordinary work occasions respond without strong emotions and rotate factual lines', () => {
  for (const occasion of ['revision', 'problem', 'accepted', 'frustration', 'task', 'discussion', 'finished', 'rest']) {
    const judgment = result({ emotion: 'weak_or_none', occasion });
    const first = chooseReaction(judgment, { route: 'user_only' });
    assert.ok(first, occasion);
    const second = chooseReaction(judgment, { route: 'user_only' }, first.id);
    assert.ok(second); assert.notEqual(second.id, first.id);
    assert.equal(chooseReaction(result({ emotion: 'weak_or_none', occasion, holdBack: 0.8 }), { route: 'user_only' }), null);
  }
  const uncertain = result({ occasion: 'task', emotion: 'weak_or_none' });
  const labels = Object.keys(REACTION_QUESTIONS.occasion.criteria);
  uncertain.answers.occasion.probabilities = Object.fromEntries(labels.map(label => [label, label === 'task' ? 0.54 : 0.46 / (labels.length - 1)]));
  assert.equal(chooseReaction(uncertain, { route: 'user_only' }), null);
});

test('a 3-second judgment is usable; diagnostics distinguish decision, shown and expiry without text', async t => {
  const f = fixture(t, async () => { f.advance(3000); return result({ occasion: 'revision', emotion: 'weak_or_none' }); });
  f.enable();
  const privateText = 'PRIVATE_MESSAGE_DO_NOT_LOG';
  await f.send('private-id', privateText);
  const notice = f.service.poll(f.context).notice;
  assert.ok(notice);
  assert.equal(f.calls[0][2].timeoutMs, 4750);
  f.service.acknowledge({ id: notice.id, shown: true });
  assert.ok(f.diagnostics.some(item => item.event === 'decision' && item.elapsedMs === 3000));
  assert.ok(f.diagnostics.some(item => item.event === 'shown'));
  const trace = f.diagnostics.find(item => item.event === 'shown').trace;
  assert.ok(f.diagnostics.some(item => item.event === 'request-started' && item.trace === trace));
  assert.ok(!JSON.stringify(f.diagnostics).includes(privateText));
  assert.ok(!JSON.stringify(f.diagnostics).includes('private-id'));
  f.advance(10000); await f.send('expiry'); f.advance(2000);
  assert.equal(f.service.poll(f.context).notice, null);
  assert.ok(f.diagnostics.some(item => item.reason === 'display-expired'));
});

test('diagnostics distinguish policy silence, provider error and cancellation', async t => {
  const f = fixture(t, async () => result({ occasion: 'none', emotion: 'weak_or_none' }));
  f.enable(); await f.send();
  assert.ok(f.diagnostics.some(item => item.event === 'decision' && item.reason === 'no-matching-occasion'));
  let finish;
  f.service.connection.decide = () => new Promise(resolve => { finish = resolve; });
  const pending = f.send('waiting');
  f.service.poll({ visible: false, blocked: false }); finish(result()); await pending;
  assert.ok(f.diagnostics.some(item => item.event === 'cancelled' && item.reason === 'hidden'));
  f.service.poll(f.context);
  f.service.connection.decide = async () => { throw new JevConnectionError('NETWORK', 'PRIVATE_ERROR_BODY'); };
  await f.send('failed');
  assert.ok(f.diagnostics.some(item => item.event === 'request-error' && item.code === 'NETWORK'));
  assert.ok(!JSON.stringify(f.diagnostics).includes('PRIVATE_ERROR_BODY'));
});

test('numbers and secrets are filtered before payment, upload and recommendation comparison', async t => {
  const f = fixture(t); f.enable();
  const secret = 'sk-' + 'FAKEsecret123'.repeat(3);
  for (const [index, value] of ['123456789012345', '1234', secret, 'api_key="short-secret"'].entries()) {
    await f.send('sensitive-only-' + index, value);
  }
  assert.equal(f.calls.length, 0);
  assert.ok(f.diagnostics.filter(item => item.reason === 'no-analyzable-text').length >= 4);
  await f.send('mixed', '请配置 ' + secret + '，编号 123456789，端口 7897。', { recommendations: ['请配置别的'] });
  const state = f.calls[0][0];
  assert.equal(state.route, 'user_only');
  assert.equal(state.user_message, '请配置 [已过滤]，编号 [已过滤]，端口 7897。');
  await f.send('recommendation-secret', '继续配置', { recommendations: [secret] });
  assert.equal(f.calls[1][0].route, 'user_only');
  assert.ok(!JSON.stringify(f.diagnostics).includes(secret));
  assert.ok(!JSON.stringify(f.diagnostics).includes('123456789'));
  assert.ok(f.diagnostics.some(item => item.event === 'input-filtered' && item.numbers === 1 && item.secrets === 1));
});
