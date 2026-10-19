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

export function readInteractionNotices(dataDir) {
  const directory = interactionDirectory(dataDir);
  return files(directory).map(name => readJson(path.join(directory, name), null)).filter(Boolean)
    .sort((a, b) => a.createdAt - b.createdAt);
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
      if (item?.threadId === threadId && (!turnId || item.turnId === turnId || event === 'UserPromptSubmit' || event === 'SessionEnd')) fs.unlinkSync(file);
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
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return;
  }
  fs.mkdirSync(directory, { recursive: true });
  try { fs.writeFileSync(file, JSON.stringify({ id: randomUUID(), threadId, turnId, kind, createdAt: now }), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}

