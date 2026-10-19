import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acceptInteractionHook, readInteractionNotices } from '../runtime/interaction-notices.mjs';
import { installInteractionHooks } from '../scripts/install-interaction-hooks.mjs';
import { interactionHooks } from '../scripts/install-interaction-hooks.mjs';
import { createDispatcher } from '../runtime/dispatcher.mjs';
import { SessionParser } from '../runtime/session-monitor.mjs';
import { WhaleService } from '../runtime/service.mjs';
import { approvalRequiresUser } from '../runtime/approval-context.mjs';

function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-interaction-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const question = event => ({ session_id: 'thread-a', turn_id: 'turn-a', tool_use_id: 'call-a', tool_name: 'request_user_input', hook_event_name: event, tool_input: { questions: [{ question: 'PRIVATE_QUESTION' }] } });
const approval = event => ({ session_id: 'thread-b', turn_id: 'turn-b', tool_name: 'Bash', hook_event_name: event, tool_input: { command: 'PRIVATE_COMMAND', description: 'reason' } });

test('question lifecycle uses call identity, deduplicates hooks and never stores question contents', t => {
  const root = directory(t);
  acceptInteractionHook(root, question('PreToolUse'), 100);
  const initial = readInteractionNotices(root);
  acceptInteractionHook(root, question('PreToolUse'), 200);
  assert.deepEqual(readInteractionNotices(root), initial);
  assert.equal(initial[0].kind, 'question'); assert.equal(initial[0].createdAt, 100);
  assert.ok(!JSON.stringify(initial).includes('PRIVATE'));
  acceptInteractionHook(root, { ...question('PostToolUse'), tool_use_id: 'different' });
  assert.equal(readInteractionNotices(root).length, 1);
  acceptInteractionHook(root, question('PostToolUse'));
  assert.deepEqual(readInteractionNotices(root), []);
  acceptInteractionHook(root, { ...question('PreToolUse'), tool_name: 'functions.request_user_input_async' });
  assert.equal(readInteractionNotices(root)[0].kind, 'question');
});

test('approval hook survives repeated polls and resolves after the corresponding tool result', t => {
  const root = directory(t);
  acceptInteractionHook(root, approval('PermissionRequest'));
  const id = readInteractionNotices(root)[0].id;
  acceptInteractionHook(root, approval('PermissionRequest'));
  assert.equal(readInteractionNotices(root)[0].id, id);
  acceptInteractionHook(root, { ...approval('PostToolUse'), tool_input: { description: 'reason', command: 'PRIVATE_COMMAND' } });
  assert.deepEqual(readInteractionNotices(root), []);
  acceptInteractionHook(root, approval('PermissionRequest'));
  assert.notEqual(readInteractionNotices(root)[0].id, id, 'a new request after resolution can notify again');
});

test('native async PostToolUse acceptance cannot erase a question created by the transcript reader', t => {
  const root = directory(t), input = { ...question('PreToolUse'), tool_name: 'functions.request_user_input_async' };
  for (const tool_response of [{ accepted: true }, '{"accepted":true}']) {
    acceptInteractionHook(root, input);
    const id = readInteractionNotices(root)[0].id;
    acceptInteractionHook(root, { ...input, hook_event_name: 'PostToolUse', tool_response });
    assert.equal(readInteractionNotices(root)[0].id, id);
    acceptInteractionHook(root, { ...input, hook_event_name: 'PostToolUse' });
    assert.deepEqual(readInteractionNotices(root), [], 'the transcript can still resolve the actual answer');
  }
});

test('turn cancellation clears only that turn, and session cleanup handles denied requests', t => {
  const root = directory(t);
  acceptInteractionHook(root, question('PreToolUse'));
  acceptInteractionHook(root, approval('PermissionRequest'));
  acceptInteractionHook(root, { hook_event_name: 'Interrupt', session_id: 'thread-a', turn_id: 'turn-a' });
  assert.deepEqual(readInteractionNotices(root).map(item => item.threadId), ['thread-b']);
  acceptInteractionHook(root, { hook_event_name: 'Stop', session_id: 'thread-b', turn_id: 'turn-b' });
  assert.deepEqual(readInteractionNotices(root), []);
  assert.throws(() => acceptInteractionHook(root, { hook_event_name: 'PermissionRequest', session_id: '../../bad' }), /Missing tool identity/);
});

test('the real hook executable leaves stdout empty and writes only an advisory notice', t => {
  const root = directory(t), script = fileURLToPath(new URL('../scripts/interaction-hook.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--data-dir', root], { input: JSON.stringify(approval('PermissionRequest')), encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  assert.equal(readInteractionNotices(root)[0].kind, 'approval');
});

test('automatic permission modes never create approval notices but still allow questions', t => {
  const root = directory(t);
  const script = fileURLToPath(new URL('../scripts/interaction-hook.mjs', import.meta.url));
  for (const permission_mode of ['dontAsk', 'bypassPermissions']) {
    for (const event of [approval('PermissionRequest'), question('PreToolUse')]) {
      const result = spawnSync(process.execPath, [script, '--data-dir', root], {
        input: JSON.stringify({ ...event, permission_mode }), encoding: 'utf8', windowsHide: true
      });
      assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '');
      assert.deepEqual(readInteractionNotices(root).map(item => item.kind), event.hook_event_name === 'PreToolUse' ? ['question'] : []);
    }
    acceptInteractionHook(root, question('PostToolUse'));
  }
});

test('approval reminders use this turn and thread rather than global or inherited approval settings', async t => {
  const root = directory(t), transcript_path = path.join(root, 'session.jsonl');
  const input = { ...approval('PermissionRequest'), transcript_path, permission_mode: 'default' };
  const meta = { type: 'session_meta', payload: { id: input.session_id } };
  const context = (turn_id, approval_policy, approvals_reviewer) => ({ type: 'turn_context', payload: { turn_id, approval_policy, approvals_reviewer } });
  const write = records => fs.writeFileSync(transcript_path, records.map(record => JSON.stringify(record)).join('\n') + '\n');
  write([meta, context('old-turn', 'on-request', 'user'), context(input.turn_id, 'on-request', 'auto_review')]);
  assert.equal(await approvalRequiresUser(input), false, 'automatic review is not a human prompt');
  write([meta, context('old-turn', 'on-request', 'auto_review'), context(input.turn_id, 'on-request', 'user')]);
  assert.equal(await approvalRequiresUser(input), true, 'manual review still notifies after an older automatic turn');
  write([meta, context(input.turn_id, 'never', 'user')]);
  assert.equal(await approvalRequiresUser(input), false, 'full access must not be confused with manual review');
  write([meta, context(input.turn_id, 'on-request', 'auto_review'), {
    type: 'event_msg', payload: { type: 'thread_settings_applied', thread_id: input.session_id,
      thread_settings: { approval_policy: 'on-request', approvals_reviewer: 'user' } }
  }]);
  fs.appendFileSync(transcript_path, '{"type":"turn_context","payload":');
  assert.equal(await approvalRequiresUser(input), true, 'applied settings take effect and a partial tail is retried later');
  write([{ type: 'session_meta', payload: { id: 'other-thread' } }, context(input.turn_id, 'never', 'user')]);
  assert.equal(await approvalRequiresUser(input), true, 'a different thread cannot suppress this approval');
});

test('real approval hook suppresses automatic review before any tool result and preserves manual reminders', t => {
  const root = directory(t), transcript_path = path.join(root, 'session.jsonl');
  const script = fileURLToPath(new URL('../scripts/interaction-hook.mjs', import.meta.url));
  const input = { ...approval('PermissionRequest'), transcript_path, permission_mode: 'default' };
  for (const approvals_reviewer of ['auto_review', 'user']) {
    fs.writeFileSync(transcript_path, [
      { type: 'session_meta', payload: { id: input.session_id } },
      { type: 'turn_context', payload: { turn_id: input.turn_id, approval_policy: 'on-request', approvals_reviewer } }
    ].map(record => JSON.stringify(record)).join('\n') + '\n');
    const result = spawnSync(process.execPath, [script, '--data-dir', root], { input: JSON.stringify(input), encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
    assert.equal(readInteractionNotices(root).length, approvals_reviewer === 'user' ? 1 : 0);
    assert.ok(!JSON.stringify(readInteractionNotices(root)).includes('PRIVATE'));
  }
});

test('unreadable approval context reports a hook error without emitting an unverified reminder or private path', t => {
  const root = directory(t), script = fileURLToPath(new URL('../scripts/interaction-hook.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--data-dir', root], {
    input: JSON.stringify({ ...approval('PermissionRequest'), transcript_path: path.join(root, 'PRIVATE_missing.jsonl') }), encoding: 'utf8', windowsHide: true
  });
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.match(result.stderr, /小龙娘提醒未能记录/); assert.ok(!result.stderr.includes('PRIVATE'));
  assert.deepEqual(readInteractionNotices(root), []);
});

test('hook installation is idempotent and uninstall preserves unrelated hooks', t => {
  const root = directory(t), file = path.join(root, 'hooks.json');
  fs.writeFileSync(file, JSON.stringify({ description: 'existing', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'existing-command' }] }] } }));
  installInteractionHooks({ codexHome: root, dataDir: root });
  const first = JSON.parse(fs.readFileSync(file));
  installInteractionHooks({ codexHome: root, dataDir: root });
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), first);
  assert.equal(first.hooks.Stop.length, 2);
  assert.equal(first.hooks.Stop[0].hooks[0].command, 'existing-command');
  assert.ok(first.hooks.PermissionRequest[0].hooks[0].command.includes('interaction-hook.mjs'));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/uninstall-interaction-hooks.mjs', import.meta.url))], {
    env: { ...process.env, CODEX_HOME: root }, encoding: 'utf8', windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { description: 'existing', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'existing-command' }] }] } });
});

test('Windows hook command runs through PowerShell rather than treating the executable as a string', { skip: process.platform !== 'win32' }, t => {
  const root = directory(t), command = interactionHooks({ dataDir: root }).PermissionRequest[0].hooks[0].command;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    input: JSON.stringify(approval('PermissionRequest')), encoding: 'utf8', windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '');
  assert.equal(readInteractionNotices(root)[0].kind, 'approval');
});

function transcript() {
  const events = [], parser = new SessionParser({ id: 'thread-a', onInteraction: item => events.push(structuredClone(item)) });
  parser.accept({ type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-a' } });
  const call = (name = 'request_user_input_async', count = 1) => ({ type: 'response_item', payload: { type: 'function_call', name, call_id: 'call-a', arguments: JSON.stringify({ questions: Array.from({ length: count }, () => ({ question: 'PRIVATE' })) }) } });
  const reply = index => ({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<send_user_message_question_reply>\n' + JSON.stringify([{ questionItemId: JSON.stringify(['request_user_input_async', 'call-a', index]), answer: 'PRIVATE' }]) + '\n</send_user_message_question_reply>' }] } });
  return { parser, events, call, reply };
}

test('real desktop async accepted output keeps the question pending until every structured answer arrives', () => {
  const h = transcript(); h.parser.accept(JSON.stringify(h.call('request_user_input_async', 2)));
  h.parser.accept({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-a', output: '{"accepted":true}' } });
  assert.equal(h.parser.questions.size, 1); assert.equal(h.events.length, 1);
  h.parser.accept(JSON.stringify(h.reply(0))); assert.equal(h.parser.questions.size, 1);
  h.parser.accept(JSON.stringify(h.reply(1))); assert.equal(h.parser.questions.size, 0);
  assert.deepEqual(h.events.map(item => item.hook_event_name), ['PreToolUse', 'PostToolUse']);
  assert.ok(!JSON.stringify(h.events).includes('PRIVATE'));
});

test('async question stays pending across assistant completion, Stop and reply-turn startup until answered', t => {
  const root = directory(t), h = transcript();
  h.parser.onInteraction = input => acceptInteractionHook(root, input);
  h.parser.accept(h.call('request_user_input_async', 2));
  h.parser.accept({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-a', output: '{"accepted":true}' } });
  const id = readInteractionNotices(root)[0].id;
  h.parser.accept({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-a' } });
  acceptInteractionHook(root, { hook_event_name: 'Stop', session_id: 'thread-a', turn_id: 'turn-a' });
  acceptInteractionHook(root, { hook_event_name: 'UserPromptSubmit', session_id: 'thread-a' });
  h.parser.accept({ type: 'event_msg', payload: { type: 'task_started', turn_id: 'reply-turn' } });
  assert.equal(readInteractionNotices(root)[0].id, id);
  h.parser.accept(h.reply(0));
  assert.equal(readInteractionNotices(root)[0].id, id);
  h.parser.accept(h.reply(1));
  assert.deepEqual(readInteractionNotices(root), []);
});

test('restart restores unanswered async questions after a completed turn but never replays answered ones', t => {
  const root = directory(t), h = transcript();
  const ended = { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-a' } };
  h.parser.onInteraction = input => acceptInteractionHook(root, input);
  h.parser.prime([h.call(), ended]);
  assert.equal(readInteractionNotices(root).length, 1);
  const replay = transcript();
  replay.parser.onInteraction = input => acceptInteractionHook(root, input);
  replay.parser.prime([replay.call(), ended, replay.reply(0)]);
  assert.deepEqual(readInteractionNotices(root), []);
  const cancelled = transcript();
  cancelled.parser.onInteraction = input => acceptInteractionHook(root, input);
  cancelled.parser.accept(cancelled.call());
  assert.equal(readInteractionNotices(root).length, 1);
  cancelled.parser.accept({ type: 'event_msg', payload: { type: 'task_aborted', turn_id: 'turn-a' } });
  assert.deepEqual(readInteractionNotices(root), []);
});

test('synchronous question completion resolves normally and replay emits only genuinely pending questions', () => {
  const h = transcript();
  h.parser.accept(h.call('request_user_input'));
  h.parser.accept({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-a', output: '{"answers":{}}' } });
  assert.equal(h.parser.questions.size, 0);
  const replay = transcript(); replay.events.length = 0;
  replay.parser.prime([replay.call(), { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-a', output: '{"accepted":true}' } }]);
  assert.deepEqual(replay.events.map(item => item.hook_event_name), ['PreToolUse']);
});

const frontend = fs.readFileSync(new URL('../desktop/ui/interaction-notices.js', import.meta.url), 'utf8');
function client(storage = new Map()) {
  let notices = [], fail = false, enabled = true;
  const shown = [], cleared = [], box = { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } };
  vm.runInNewContext(frontend, box);
  const api = box.WhaleInteractionNotices.create({ storage: box.localStorage, enabled: () => enabled,
    fetch: async () => ({ ok: !fail, json: async () => ({ ok: true, notices }) }),
    show(item, hooks) { shown.push({ item, hooks }); return true; }, clear: id => cleared.push(id) });
  return { api, shown, cleared, storage, set: value => { notices = value; }, fail: value => { fail = value; }, enabled: value => { enabled = value; } };
}

test('same pending request appears once, stays dismissed across polls and reloads, and new IDs still appear', async () => {
  const h = client(); h.set([{ id: 'question-1', kind: 'question' }]);
  await h.api.poll(); h.shown[0].hooks.shown();
  for (let i = 0; i < 5; i++) await h.api.poll();
  assert.equal(h.shown.length, 1);
  h.api.dismiss(); await h.api.poll();
  assert.equal(h.shown[0].hooks.valid(), false, 'a dismissed pending request cannot commit a late render');
  assert.deepEqual(h.cleared, ['question-1']); assert.equal(h.shown.length, 1);
  const restored = client(h.storage); restored.set([{ id: 'question-1', kind: 'question' }]); await restored.api.poll();
  assert.equal(restored.shown.length, 0);
  restored.set([{ id: 'approval-2', kind: 'approval' }]); await restored.api.poll();
  assert.equal(restored.shown.length, 1);
});

test('a resolved request invalidates pending renders and a failed poll never falsely clears a notice', async () => {
  const h = client(); h.set([{ id: 'approval-1', kind: 'approval' }]); await h.api.poll();
  assert.equal(h.shown[0].hooks.valid(), true);
  h.fail(true); await h.api.poll(); assert.equal(h.cleared.length, 0); assert.ok(h.api.error);
  h.fail(false); h.set([]); await h.api.poll();
  assert.equal(h.shown[0].hooks.valid(), false); assert.deepEqual(h.cleared, ['approval-1']);
});

test('invisible and failed-render notices are not marked as seen before a successful render', async () => {
  const h = client(); h.set([{ id: 'question-1', kind: 'question' }]); h.enabled(false); await h.api.poll();
  assert.equal(h.shown.length, 0);
  h.enabled(true); await h.api.poll(); h.shown[0].hooks.discarded(); await h.api.poll();
  assert.equal(h.shown.length, 2);
});

test('dispatcher serves hook state and reminder script without exposing tool arguments', async t => {
  const root = directory(t), service = new WhaleService({ dataDir: root, codexHome: root });
  const server = createDispatcher({ dataDir: root, service, monitor: false, autoRefresh: false });
  t.after(() => server.close());
  acceptInteractionHook(root, approval('PermissionRequest'));
  const reply = await server.dispatch('/api/interaction-notices');
  assert.equal(reply.status, 200); assert.equal(JSON.parse(reply.body).notices[0].kind, 'approval');
  assert.ok(!reply.body.toString().includes('PRIVATE_COMMAND'));
  const indexFile = path.join(root, 'session_index.jsonl');
  fs.writeFileSync(indexFile, [
    { id: 'thread-b', thread_name: '旧会话名称' },
    { id: 'unrelated', thread_name: 'PRIVATE_OTHER_THREAD' },
    { id: 'thread-b', thread_name: '修复提醒气泡' }
  ].map(item => JSON.stringify(item)).join('\n') + '\n{"id":');
  const namedReply = await server.dispatch('/api/interaction-notices');
  assert.equal(JSON.parse(namedReply.body).notices[0].threadTitle, '修复提醒气泡');
  assert.ok(!namedReply.body.toString().includes('PRIVATE_OTHER_THREAD'));
  assert.equal(readInteractionNotices(root)[0].threadTitle, undefined, 'titles are read for display, not persisted in hook notices');
  assert.equal((await server.dispatch('/api/interaction-notices', { method: 'POST' })).status, 405);
  assert.equal((await server.dispatch('/interaction-notices.js')).status, 200);
});
