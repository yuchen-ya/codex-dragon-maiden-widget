import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SendingSource } from '../runtime/send-events.mjs';

const time = Date.now();
const meta = (id, extra = {}) => ({ type: 'session_meta', payload: { id, ...extra } });
const message = (id, text, extra = {}) => ({ type: 'response_item', payload: { type: 'message', role: 'user', id,
  content: [{ type: 'input_text', text }], internal_chat_message_metadata_passthrough: { turn_id: 'turn', create_time: (time + 10) / 1000, content_item_kinds: ['user.text'], ...extra } } });
const write = (file, ...records) => fs.appendFileSync(file, records.map(record => JSON.stringify(record) + '\n').join(''));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'send-source-'));
  const root = path.join(dir, 'sessions'); fs.mkdirSync(root);
  const sent = [], context = [];
  const source = new SendingSource({ codexHome: dir, now: () => time, onSend: item => sent.push(item), onContext: item => context.push(item) });
  t.after(() => { source.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { root, source, sent, context };
}

test('only new submitted user text is delivered, once per stable identity', t => {
  const { root, source, sent, context } = fixture(t), file = path.join(root, 'one.jsonl');
  write(file, meta('thread'), message('old', 'historic'));
  source.start();
  write(file, message('new', '  e\u0301\r\n好  '), message('new', 'duplicate'), message('next', 'same'), message('last', 'same'));
  source.read(file);
  assert.deepEqual(sent.map(x => [x.id, x.threadId, x.text]), [['new', 'thread', 'é\n好'], ['next', 'thread', 'same'], ['last', 'thread', 'same']]);
  assert.equal(context.length, 3);
  assert.equal(source.status().suggestionSupport, false);
  source.stop();
  write(file, message('disabled', 'unseen'));
  source.start();
  source.read(file);
  assert.equal(sent.length, 3);
});

test('length, metadata and role boundaries exclude ineligible content', t => {
  const { root, source, sent, context } = fixture(t), file = path.join(root, 'one.jsonl');
  write(file, meta('thread')); source.start();
  write(file, message('300', '😀'.repeat(300)), message('301', '😀'.repeat(301)), message('empty', '  '),
    message('injected', 'private', { content_item_kinds: ['agents_md.instructions'] }),
    message('reply', '<send_user_message_question_reply>private</send_user_message_question_reply>'),
    message('old', 'old', { create_time: (time - 1) / 1000 }));
  source.read(file);
  assert.deepEqual(sent.map(x => x.id), ['300']);
  assert.deepEqual(context.map(x => x.id), ['300', '301', 'empty', 'reply']);
});

test('subagent and fork history do not emit', t => {
  const { root, source, sent } = fixture(t); source.start();
  const child = path.join(root, 'child.jsonl'); write(child, meta('child', { thread_source: 'subagent' }), message('x', 'private')); source.read(child);
  const fork = path.join(root, 'fork.jsonl'); write(fork, meta('fork', { forked_from_id: 'original' }), message('history', 'private')); source.read(fork);
  write(fork, message('fresh', 'hello')); source.read(fork);
  assert.deepEqual(sent.map(x => x.id), ['fresh']);
});


test('pairing requires a complete prior displayed snapshot in the same input round', async () => {
  const { RecommendationSnapshots } = await import('../runtime/send-events.mjs');
  const snapshots = new RecommendationSnapshots();
  const shown = { threadId: 'a', composerRevision: 'one', displaySequence: 1, texts: [' é\r\n好 ', 'other'] };
  const send = { threadId: 'a', composerRevision: 'one', submitSequence: 2, text: 'e\u0301\n好' };
  snapshots.display(shown);
  const paired = snapshots.pair(send);
  assert.deepEqual(paired, { recommendations: ['é\n好', 'other'], localComparison: 'exact' });
  snapshots.display({ ...shown, texts: ['new'] });
  assert.deepEqual(paired.recommendations, ['é\n好', 'other']);
  assert.equal(snapshots.pair({ ...send, composerRevision: 'two' }), null);
  snapshots.display(shown); assert.equal(snapshots.pair({ ...send, threadId: 'b' }), null);
  snapshots.display(shown); assert.equal(snapshots.pair({ ...send, submitSequence: 1 }), null);
  snapshots.display(shown); snapshots.clear(); assert.equal(snapshots.pair(send), null);
  snapshots.display(shown); assert.equal(snapshots.pair({ ...send, text: '不要 é\n好' }).localComparison, 'different');
  snapshots.display({ ...shown, texts: ['a'.repeat(301)] }); assert.equal(snapshots.pair(send), null);
  snapshots.display({ ...shown, texts: ['a'.repeat(300), 'b'.repeat(300), 'c'.repeat(300), 'd'] }); assert.equal(snapshots.pair(send), null);
});

test('filesystem watch delivers a newly appended message without polling', async t => {
  const { root, source, sent } = fixture(t), file = path.join(root, 'watched.jsonl');
  write(file, meta('thread')); source.start();
  write(file, message('live', 'hello'));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('watch did not deliver')), 2000);
    const check = setInterval(() => { if (sent.length) { clearInterval(check); clearTimeout(timer); resolve(); } }, 10);
    t.after(() => { clearInterval(check); clearTimeout(timer); });
  });
  assert.equal(sent[0].id, 'live');
});

test('an asynchronous send handler failure is reported', async t => {
  const { root, source } = fixture(t), file = path.join(root, 'error.jsonl');
  const failure = new Error('handler failed');
  let observed;
  source.onSend = async () => { throw failure; };
  source.onError = error => { observed = error; };
  write(file, meta('thread')); source.start();
  write(file, message('live', 'hello')); source.read(file);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(observed, failure);
});
