import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { MEDIA_POLICY, validateImage } from '../lib/media-validation.mjs';

const source = fs.readFileSync(new URL('../desktop/ui/media-guard.js', import.meta.url), 'utf8');
function load() {
  const box = { module: { exports: {} }, Uint8Array, ArrayBuffer, DataView };
  vm.runInNewContext(source, box); return box.module.exports;
}
const api = load();
function pngChunk(kind, value) { const b = Buffer.alloc(value.length + 12); b.writeUInt32BE(value.length); b.write(kind, 4); value.copy(b, 8); return b; }
function png(frames = 0, width = 1, height = 1) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const chunks = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr)];
  if (frames) { const actl = Buffer.alloc(8); actl.writeUInt32BE(frames); chunks.push(pngChunk('acTL', actl)); }
  let sequence = 0;
  for (let i = 0; i < (frames || 1); i++) {
    if (frames) { const fctl = Buffer.alloc(26); fctl.writeUInt32BE(sequence++); fctl.writeUInt32BE(width, 4); fctl.writeUInt32BE(height, 8); chunks.push(pngChunk('fcTL', fctl)); }
    if (!i) chunks.push(pngChunk('IDAT', Buffer.from([1])));
    else { const data = Buffer.alloc(5); data.writeUInt32BE(sequence++); chunks.push(pngChunk('fdAT', data)); }
  }
  chunks.push(pngChunk('IEND', Buffer.alloc(0))); return Buffer.concat(chunks);
}
function gif(frames) {
  return Buffer.concat([Buffer.from('47494638396101000100800000000000ffffff', 'hex'), ...Array.from({ length: frames }, () => Buffer.from('2c0000000001000100000202440100', 'hex')), Buffer.from([0x3b])]);
}

test('frontend defaults exactly match the single backend media policy', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(api.DEFAULT_POLICY)), MEDIA_POLICY);
  const guard = api.createMediaGuard({});
  for (const [kind, max] of [['role', MEDIA_POLICY.roleBytes], ['bubble', MEDIA_POLICY.bubbleBytes], ['audio', MEDIA_POLICY.audioSourceBytes], ['wav', MEDIA_POLICY.audioBytes]]) {
    assert.equal(guard.checkFile({ size: max }, kind), true);
    assert.throws(() => guard.checkFile({ size: max + 1 }, kind), /最多/);
  }
  assert.throws(() => guard.checkFile({ size: 0 }, 'role'), /为空/);
  assert.throws(() => guard.checkFile({ size: NaN }, 'audio'), /为空/);
});

test('policy refresh is deduplicated and malformed responses leave the previous policy intact', async () => {
  let calls = 0;
  const next = { ...MEDIA_POLICY, roleBytes: 1024 };
  const guard = api.createMediaGuard({ fetch: async () => { calls++; return { ok: true, json: async () => ({ ok: true, policy: next }) }; } });
  await Promise.all([guard.refreshPolicy(), guard.refreshPolicy()]); assert.equal(calls, 1);
  assert.equal(guard.getPolicy().roleBytes, 1024); assert.equal(guard.policy.roleBytes, 1024);
  assert.throws(() => guard.checkFile({ size: 1025 }, 'role'), /最多/);
  assert.throws(() => guard.setPolicy({ ...next, maxFrames: -1 }), /无效/);
  assert.equal(guard.policy.maxFrames, MEDIA_POLICY.maxFrames);
  const top = load(); top.setPolicy(next); assert.equal(top.policy.roleBytes, 1024);
});

test('installed PNG and GIF assets have matching frontend and backend metadata', () => {
  for (const name of ['dragon-maiden-bust-v1.png', 'dragon-maiden-petpet.gif', 'rua.gif', 'bubble-petpet.gif', 'bubble-yue-money.gif']) {
    const bytes = fs.readFileSync(new URL('../assets/' + name, import.meta.url));
    const front = api.inspectImage(bytes), back = validateImage(bytes);
    for (const key of ['width', 'height', 'format', 'mime', 'frames']) assert.equal(front[key], back[key], name + ' ' + key);
  }
});

test('APNG inspection handles typed-array offsets and detects only complete valid frame metadata', () => {
  const bytes = png(2), padded = Buffer.concat([Buffer.alloc(11), bytes, Buffer.alloc(7)]), slice = new Uint8Array(padded.buffer, padded.byteOffset + 11, bytes.length);
  assert.equal(api.inspectImage(slice).format, 'apng'); assert.equal(api.inspectImage(slice).frames, 2);
  assert.equal(api.isAnimatedPng(slice), true); assert.equal(api.isAnimatedPng(png()), false);
  assert.throws(() => api.isAnimatedPng(bytes.subarray(0, bytes.length - 3)), /不完整/);
});

test('the original signed PNG chunk regression terminates with a clear error', () => {
  const box = { module: { exports: {} }, Uint8Array, ArrayBuffer, DataView };
  vm.createContext(box); vm.runInContext(source, box);
  const attempt = 'module.exports.isAnimatedPng(new Uint8Array([137,80,78,71,13,10,26,10,255,255,255,244,116,69,88,116]))';
  assert.throws(() => vm.runInContext(attempt, box, { timeout: 200 }), /PNG/);
  assert.throws(() => api.inspectImage(Buffer.alloc(16, 65)), /有效/);
});

test('image inspection rejects oversized canvas, APNG/GIF frame budgets and truncated chunks', () => {
  assert.throws(() => api.inspectImage(png(0, 4097, 1)), /图片过大/);
  assert.throws(() => api.inspectImage(png(601)), /动图过大/);
  assert.throws(() => api.inspectImage(png(123, 1024, 1024)), /动图过大/);
  assert.throws(() => api.inspectImage(gif(601)), /动图过大/);
  assert.throws(() => api.inspectImage(gif(1).subarray(0, 25)), /GIF/);
});

test('JPEG and static WebP metadata are recognized before pixels are decoded', () => {
  const jpeg = Buffer.from('ffd8ffc00011080003000203011100021100031100ffda000c03010002110311003f0000ffd9', 'hex');
  assert.equal(api.inspectImage(jpeg).format, 'jpeg'); assert.equal(api.inspectImage(jpeg).width, 2);
  const webp = Buffer.from('UklGRjYAAABXRUJQVlA4ICoAAACQAQCdASoCAAMAAUAmJaACdLoAA5gA/vD6K/8Q50OdDmYz/uNbc/WIAAA=', 'base64');
  assert.equal(api.inspectImage(webp).format, 'webp'); assert.equal(api.inspectImage(webp).height, 3);
  assert.throws(() => api.inspectImage(webp, 'bubble'), /只支持/);
  assert.throws(() => api.inspectImage(webp.subarray(0, webp.length - 1)), /不完整/);
});

function audioEnvironment(mode, duration = 1) {
  const state = { created: 0, revoked: [], paused: 0, removed: 0 };
  const audio = {
    duration, pause() { state.paused++; }, removeAttribute(name) { assert.equal(name, 'src'); state.removed++; },
    load() { queueMicrotask(() => { if (mode === 'metadata') audio.onloadedmetadata?.(); if (mode === 'error') audio.onerror?.(); }); },
  };
  return { state, audio, environment: {
    setTimeout, clearTimeout,
    document: { createElement(tag) { assert.equal(tag, 'audio'); state.created++; return audio; } },
    URL: { createObjectURL() { return 'blob:only-this-test'; }, revokeObjectURL(value) { state.revoked.push(value); } },
  } };
}

test('audio metadata success precedes decode and releases its blob URL and handlers', async () => {
  const context = audioEnvironment('metadata', 12.5), guard = api.createMediaGuard(context.environment);
  const info = await guard.validateAudioFile({ size: 500 }); assert.equal(info.duration, 12.5);
  assert.deepEqual(context.state.revoked, ['blob:only-this-test']); assert.equal(context.audio.onerror, null); assert.equal(context.audio.onloadedmetadata, null);
  assert.equal(context.state.paused, 1); assert.equal(context.state.removed, 1);
});

test('audio too-long, indefinite, corrupt and timed-out metadata all clean their object URL', async () => {
  for (const [mode, duration, reason] of [['metadata', 121, /120 秒/], ['metadata', Infinity, /无法确定/], ['error', 1, /损坏/], ['stall', 1, /超时/]]) {
    const context = audioEnvironment(mode, duration), guard = api.createMediaGuard(context.environment, { metadataTimeoutMs: 10 });
    await assert.rejects(guard.validateAudioFile({ size: 500 }), reason);
    assert.deepEqual(context.state.revoked, ['blob:only-this-test']); assert.equal(context.audio.onloadedmetadata, null);
  }
});

test('audio size rejection happens before creating any media element or object URL', async () => {
  const context = audioEnvironment('metadata'), guard = api.createMediaGuard(context.environment);
  await assert.rejects(guard.validateAudioFile({ size: MEDIA_POLICY.audioSourceBytes + 1 }), /最多/);
  assert.equal(context.state.created, 0); assert.deepEqual(context.state.revoked, []);
});
