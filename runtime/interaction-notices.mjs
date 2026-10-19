import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readJson } from './paths.mjs';

const questionTools = /(?:^|[.:/])request_user_input(?:_async)?$/;
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f]/.test(value);
const digest = value => createHash('sha256').update(value).digest('hex');
function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function files(directory) {
  try { return fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

export function interactionDirectory(dataDir) { return path.join(dataDir, 'interaction-notices'); }

export function readInteractionNotices(dataDir, codexHome) {
  const directory = interactionDirectory(dataDir);
  const notices = files(directory).map(name => readJson(path.join(directory, name), null)).filter(Boolean)
    .sort((a, b) => a.createdAt - b.createdAt);
  if (!notices.length || !codexHome) return notices;
  let index;
  try { index = fs.readFileSync(path.join(codexHome, 'session_index.jsonl'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return notices; throw error; }
  const titles = new Map(), pendingThreads = new Set(notices.map(item => item.threadId));
  for (const line of index.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    // The live index can end with a partially written line; retry it on the next poll.
    try { entry = JSON.parse(line); }
    catch (error) { if (error instanceof SyntaxError) continue; throw error; }
    if (entry && pendingThreads.has(entry.id) && typeof entry.thread_name === 'string') {
      titles.set(entry.id, entry.thread_name.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 160));
    }
  }
  return notices.map(item => ({ ...item, threadTitle: titles.get(item.threadId) || '' }));
}

// Hook input is a trust boundary. Persist identifiers and event kind only;
// questions, shell commands, tool arguments and answers never enter this store.
export function acceptInteractionHook(dataDir, input, now = Date.now()) {
  if (!input || !identifier(input.session_id) || !identifier(input.hook_event_name)) throw new Error('Invalid hook identity');
  const directory = interactionDirectory(dataDir), threadId = input.session_id, turnId = input.turn_id || '';
  if (turnId && !identifier(turnId)) throw new Error('Invalid turn identity');
  const event = input.hook_event_name;
  if (['Stop', 'Interrupt', 'SessionEnd', 'UserPromptSubmit'].includes(event)) {
    for (const name of files(directory)) {
      const file = path.join(directory, name), item = readJson(file, null);
      const waitingForAnswer = item?.asyncQuestion === true && ['Stop', 'UserPromptSubmit'].includes(event);
      if (!waitingForAnswer && item?.threadId === threadId && (!turnId || item.turnId === turnId || event === 'UserPromptSubmit' || event === 'SessionEnd')) fs.unlinkSync(file);
    }
    return;
  }
  if (!['PreToolUse', 'PermissionRequest', 'PostToolUse'].includes(event)) return;
  if (!identifier(input.tool_name) || !turnId) throw new Error('Missing tool identity');
  const question = questionTools.test(input.tool_name);
  if (event === 'PreToolUse' && !question) return;
  // PermissionRequest currently has no documented tool_use_id. Its fingerprint
  // also lets PostToolUse resolve the matching request without saving arguments.
  const fingerprint = digest(stableJson([threadId, turnId, input.tool_name, input.tool_input || {}]));
  const kind = event === 'PermissionRequest' ? 'approval' : question ? 'question' : 'approval';
  const callId = question && identifier(input.tool_use_id) ? input.tool_use_id : fingerprint;
  const file = path.join(directory, digest(stableJson([threadId, turnId, kind, callId])) + '.json');
  if (event === 'PostToolUse') {
    if (question && input.tool_name.endsWith('_async')) {
      let response = input.tool_response;
      if (typeof response === 'string') {
        try { response = JSON.parse(response); }
        catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      }
      // Creating an async question returns immediately, before the user answers.
      // The transcript's actual answer/cancellation resolves the notice later.
      if (response?.accepted === true) return;
    }
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return;
  }
  fs.mkdirSync(directory, { recursive: true });
  const lifecycle = question && input.tool_name.endsWith('_async') ? { asyncQuestion: true } : {};
  try { fs.writeFileSync(file, JSON.stringify({ id: randomUUID(), threadId, turnId, kind, createdAt: now, ...lifecycle }), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}

