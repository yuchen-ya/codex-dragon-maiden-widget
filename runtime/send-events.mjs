import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';

const MAX_LINE = 8 * 1024 * 1024;
const normalize = text => text.replace(/\r\n/g, '\n').trim().normalize('NFC');

function submittedText(content, kinds) {
  if (content.length !== kinds.length) return null;
  const parts = [];
  for (let index = 0; index < content.length; index++) {
    const part = content[index];
    if (kinds[index] === 'user.image' && part.type === 'input_image') continue;
    if (kinds[index] !== 'user.text' || part.type !== 'input_text' || typeof part.text !== 'string') return null;
    let text = part.text.trim();
    // Codex wraps attached images in separate text/image/text blocks. Only
    // the user's request is eligible; attachment paths and image data are not.
    if (/^<image\s[^>]*>$/.test(text) || text === '</image>') continue;
    if (text.startsWith('# Files mentioned by the user:')) {
      const marker = '\n## My request:';
      const start = text.indexOf(marker);
      if (start < 0) return null;
      text = text.slice(start + marker.length).trim();
    }
    parts.push(text);
  }
  return normalize(parts.join('\n'));
}

// The rollout provides submitted messages, but no evidence that composer
// suggestions were actually displayed. Never infer suggestions from tool calls.
export class SendingSource {
  constructor({ codexHome, onSend, onContext = () => {}, onError = () => {}, onDiagnostic = () => {}, now = Date.now }) {
    Object.assign(this, { root: path.join(codexHome, 'sessions'), onSend, onContext, onError, onDiagnostic, now });
    this.files = new Map();
    this.seen = new Set();
    this.error = '';
  }

  status() {
    return { source: 'codex-session-rollout', suggestionSupport: false, error: this.error };
  }

  start() {
    if (this.watcher) return;
    this.enabledAt = this.now();
    this.files.clear();
    this.seen.clear();
    try {
      // Watch before taking the EOF snapshot, avoiding any history replay.
      this.watcher = fs.watch(this.root, { recursive: true }, (_event, name) => {
        if (!name || !String(name).endsWith('.jsonl')) return;
        const file = path.resolve(this.root, String(name));
        if (!file.startsWith(path.resolve(this.root) + path.sep)) return;
        this.read(file);
      });
      this.watcher.on('error', error => this.fail(error));
      this.snapshot(this.root);
      // The feature becomes ready only after the baseline is complete. Writes
      // included in that baseline belong to initialization, not live sends.
      this.enabledAt = this.now();
      this.onDiagnostic({ event: 'source-started', baselineFiles: this.files.size });
    } catch (error) {
      this.stop();
      this.fail(error);
    }
  }

  stop() {
    this.watcher?.close();
    this.watcher = null;
    this.files.clear();
    this.seen.clear();
  }

  fail(error) {
    this.error = '会话发送监听不可用';
    this.onError(error);
  }

  snapshot(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) this.snapshot(file);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const stat = fs.statSync(file);
        this.files.set(file, { offset: stat.size, identity: null, pending: '', decoder: new StringDecoder('utf8'), skipLine: false });
      }
    }
  }

  readIdentity(file) {
    const fd = fs.openSync(file, 'r');
    try {
      const chunks = [];
      let position = 0, end = -1;
      while (position < 1024 * 1024) {
        const chunk = Buffer.alloc(Math.min(4096, 1024 * 1024 - position));
        const count = fs.readSync(fd, chunk, 0, chunk.length, position);
        if (!count) return null;
        const part = chunk.subarray(0, count);
        end = part.indexOf(10);
        chunks.push(end < 0 ? part : part.subarray(0, end));
        if (end >= 0) break;
        position += count;
      }
      if (end < 0) return null;
      const buffer = Buffer.concat(chunks);
      let record;
      try { record = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, '')); }
      catch (error) { if (error instanceof SyntaxError) return null; throw error; }
      const meta = record.payload;
      if (record.type !== 'session_meta' || !meta || typeof meta.id !== 'string' || !meta.id ||
          meta.thread_source === 'subagent' || meta.source?.subagent) return null;
      return { id: meta.id, forked: Boolean(meta.forked_from_id) };
    } finally { fs.closeSync(fd); }
  }

  read(file) {
    if (!this.watcher) return;
    let stat;
    try { stat = fs.statSync(file); }
    catch (error) { if (error.code === 'ENOENT') { this.files.delete(file); return; } this.fail(error); return; }
    if (!stat.isFile()) return;
    let state = this.files.get(file);
    if (!state) {
      // Newly discovered old files start at EOF; new rollout files must also
      // carry a fresh message timestamp before they can emit anything.
      const fresh = stat.birthtimeMs >= this.enabledAt - 1000;
      state = { offset: fresh ? 0 : stat.size, identity: null, pending: '', decoder: new StringDecoder('utf8'), skipLine: false };
      this.files.set(file, state);
    }
    if (stat.size < state.offset) {
      // A replaced/truncated file is treated as history, not a new stream.
      this.files.delete(file);
      this.files.set(file, { offset: stat.size, identity: this.readIdentity(file), pending: '', decoder: new StringDecoder('utf8'), skipLine: false });
      return;
    }
    try {
      if (!state.identity) {
        state.identity = this.readIdentity(file);
        if (state.identity?.forked && state.offset === 0) state.offset = stat.size;
      }
      if (!state.identity || stat.size === state.offset) return;
      const fd = fs.openSync(file, 'r');
      let buffer;
      try {
        buffer = Buffer.alloc(stat.size - state.offset);
        const count = fs.readSync(fd, buffer, 0, buffer.length, state.offset);
        state.offset += count;
        buffer = buffer.subarray(0, count);
      } finally { fs.closeSync(fd); }
      const lines = (state.pending + state.decoder.write(buffer)).split('\n');
      state.pending = lines.pop();
      for (const line of lines) {
        if (state.skipLine) { state.skipLine = false; continue; }
        this.accept(line, state.identity.id);
      }
      if (state.pending.length > MAX_LINE) { state.pending = ''; state.skipLine = true; }
    } catch (error) { if (error.code !== 'ENOENT') this.fail(error); }
  }

  accept(line, threadId) {
    let record;
    try { record = JSON.parse(line); }
    catch (error) { if (error instanceof SyntaxError) return; throw error; }
    const item = record.payload;
    const meta = item?.internal_chat_message_metadata_passthrough;
    if (record.type !== 'response_item' || item?.type !== 'message' || item.role !== 'user' ||
        typeof item.id !== 'string' || !item.id || !meta || typeof meta.turn_id !== 'string' || !meta.turn_id ||
        !Array.isArray(meta.content_item_kinds) || !meta.content_item_kinds.length ||
        meta.content_item_kinds.some(kind => typeof kind !== 'string' || !kind.startsWith('user.')) ||
        !Array.isArray(item.content)) return;
    const at = Number(meta.create_time) * 1000;
    if (!Number.isFinite(at) || at < this.enabledAt || at > this.now() + 1000) return;
    const id = item.id;
    const key = threadId + ':' + id;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 8192) this.seen.delete(this.seen.values().next().value);
    const trace = randomUUID();
    this.onContext({ type: 'send', id, threadId, at });
    const text = submittedText(item.content, meta.content_item_kinds);
    const characters = text === null ? 0 : Array.from(text).length;
    const images = meta.content_item_kinds.filter(kind => kind === 'user.image').length;
    this.onDiagnostic({ event: 'observed', trace, characters, images, ageMs: Math.max(0, this.now() - at) });
    const reason = text === null ? 'unsupported-content' : /^\s*<send_user_message_question_reply>/.test(text) ? 'question-form' :
      !text ? 'empty' : characters > 300 ? 'too-long' : '';
    if (reason) { this.onDiagnostic({ event: 'skipped', trace, reason }); return; }
    Promise.resolve(this.onSend({ id, threadId, at, text, trace })).catch(error => this.fail(error));
  }
}

// A caller may supply a snapshot only when it observed a complete rendered UI
// snapshot. Session records and tool options alone do not establish that fact.
export class RecommendationSnapshots {
  constructor() { this.snapshot = null; }
  clear() { this.snapshot = null; }
  display({ threadId, composerRevision, displaySequence, texts }) {
    this.clear();
    if (typeof threadId !== 'string' || !threadId || typeof composerRevision !== 'string' || !composerRevision ||
        !Number.isSafeInteger(displaySequence) || displaySequence < 0 || !Array.isArray(texts) || !texts.length ||
        texts.some(text => typeof text !== 'string')) return;
    const normalized = texts.map(normalize);
    if (normalized.some(text => !text || Array.from(text).length > 300) ||
        normalized.reduce((sum, text) => sum + Array.from(text).length, 0) > 900) return;
    this.snapshot = { threadId, composerRevision, displaySequence, texts: normalized };
  }
  pair({ threadId, composerRevision, submitSequence, text }) {
    const snapshot = this.snapshot;
    this.clear();
    if (!snapshot || snapshot.threadId !== threadId || snapshot.composerRevision !== composerRevision ||
        !Number.isSafeInteger(submitSequence) || snapshot.displaySequence >= submitSequence || typeof text !== 'string') return null;
    const normalized = normalize(text);
    if (!normalized || Array.from(normalized).length > 300) return null;
    return { recommendations: [...snapshot.texts], localComparison: snapshot.texts.includes(normalized) ? 'exact' : 'different' };
  }
}
