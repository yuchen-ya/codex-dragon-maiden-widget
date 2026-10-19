import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

// Read the hook's own transcript, not global config: desktop chats can override
// both the approval policy and the reviewer. Never persist transcript contents.
export async function approvalRequiresUser(input) {
  // PermissionRequest runs before automatic decisions as well as human prompts.
  if (['dontAsk', 'bypassPermissions'].includes(input.permission_mode)) return false;
  if (!input.transcript_path) return true;
  if (typeof input.transcript_path !== 'string' || !path.isAbsolute(input.transcript_path)) throw new Error('Invalid transcript path');
  let context = null, sessionId = null;
  const stream = fs.createReadStream(input.transcript_path, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!/"(?:session_meta|turn_context|thread_settings_applied)"/.test(line)) continue;
      let record;
      // A live transcript can end with an unfinished JSON record.
      try { record = JSON.parse(line); }
      catch (error) { if (error instanceof SyntaxError) continue; throw error; }
      const payload = record.payload;
      if (record.type === 'session_meta' && sessionId === null) sessionId = payload?.id || payload?.session_id;
      if (sessionId !== input.session_id) continue;
      if (record.type === 'turn_context' && payload?.turn_id === input.turn_id) context = payload;
      if (context && record.type === 'event_msg' && payload?.type === 'thread_settings_applied' && payload.thread_id === input.session_id) {
        context = payload.thread_settings;
      }
    }
  } finally { lines.close(); stream.destroy(); }
  return context?.approval_policy !== 'never' && context?.approvals_reviewer !== 'auto_review';
}
