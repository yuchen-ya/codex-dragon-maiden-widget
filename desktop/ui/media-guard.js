(function (host, factory) {
  'use strict';
  const api = factory(host);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { host.WhaleMediaGuard = api; api.refreshPolicy().catch(() => {}); }
})(typeof globalThis === 'object' ? globalThis : this, function (host) {
  'use strict';
  // First-file checks do not wait for a network request. The local policy
  // endpoint replaces these defaults; tests keep them equal to MEDIA_POLICY.
  const DEFAULT_POLICY = Object.freeze({
    roleBytes: 20 * 1024 * 1024, bubbleBytes: 8 * 1024 * 1024,
    audioBytes: 8 * 1024 * 1024, audioSourceBytes: 20 * 1024 * 1024,
    maxImageDimension: 4096, maxImagePixels: 16777216,
    maxFrames: 600, maxAnimationPixels: 128000000,
    maxAudioSeconds: 120, maxAudioChannels: 8, maxAudioSampleRate: 192000,
    maxStorageBytes: 256 * 1024 * 1024, maxItemsPerLibrary: 256,
  });
  const error = message => { throw new Error(message); };
  function bytesOf(value) {
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') return new Uint8Array(value);
    return error('图片数据无效，请重新选择文件');
  }
  function createMediaGuard(environment = host, { metadataTimeoutMs = 8000 } = {}) {
    let policy = DEFAULT_POLICY, policyJob = null;
    const getPolicy = () => policy;
    function setPolicy(value) {
      const next = {};
      for (const key of Object.keys(DEFAULT_POLICY)) {
        if (!value || !Number.isSafeInteger(value[key]) || value[key] < 1) error('本地素材限制数据无效');
        next[key] = value[key];
      }
      policy = Object.freeze(next); return policy;
    }
    async function refreshPolicy() {
      if (!environment.fetch) return false;
      if (!policyJob) policyJob = Promise.resolve().then(async () => {
        const response = await environment.fetch('/api/media-policy', { cache: 'no-store', ...(environment.AbortSignal?.timeout ? { signal: environment.AbortSignal.timeout(3000) } : {}) });
        if (!response.ok) error('素材规则暂时无法读取');
        const payload = await response.json();
        if (payload.ok === false) error('素材规则暂时无法读取');
        setPolicy(payload.policy || payload); return true;
      }).finally(() => { policyJob = null; });
      return policyJob;
    }
    function byteLimit(kind) {
      if (kind === 'role') return policy.roleBytes;
      if (kind === 'bubble') return policy.bubbleBytes;
      if (kind === 'audio') return policy.audioSourceBytes;
      if (kind === 'wav') return policy.audioBytes;
      return error('未知素材类型');
    }
    function checkFile(file, kind) {
      const limit = byteLimit(kind);
      if (!file || !Number.isSafeInteger(file.size) || file.size <= 0) error('文件为空或不可读取');
      if (file.size > limit) error((kind === 'audio' ? '音频源文件' : kind === 'wav' ? '音频片段' : '图片') + '最多 ' + (limit / 1024 / 1024).toFixed(0) + ' MiB，请先缩小后导入');
      return true;
    }
    function dimensions(width, height, frames = 1) {
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) error('图片尺寸无效');
      if (width > policy.maxImageDimension || height > policy.maxImageDimension || width * height > policy.maxImagePixels) error('图片过大：单边最多 ' + policy.maxImageDimension + ' 像素');
      if (!Number.isSafeInteger(frames) || frames < 1 || frames > policy.maxFrames || (frames > 1 && width * height * frames > policy.maxAnimationPixels)) error('动图过大：帧数或总解码像素超出限制');
    }
    function reader(value) {
      const bytes = bytesOf(value), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const ascii = (pos, count) => { let out = ''; for (let i = pos; i < pos + count; i++) out += String.fromCharCode(bytes[i]); return out; };
      return { bytes, view, ascii, u24: pos => bytes[pos] + bytes[pos + 1] * 256 + bytes[pos + 2] * 65536 };
    }
    function isPng(bytes) { return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value); }
    function png(input) {
      const { bytes, view, ascii } = reader(input);
      if (!isPng(bytes)) error('PNG 文件头无效');
      let pos = 8, width, height, announced = 0, frames = 0, sequence = 0, imageData = 0, ended = false, steps = 0;
      while (pos + 12 <= bytes.length) {
        if (++steps > 131072) error('PNG 数据块过多');
        const length = view.getUint32(pos, false), kind = ascii(pos + 4, 4), start = pos + 8;
        if (length > 0x7fffffff || length > bytes.length - pos - 12) error('PNG 数据块长度无效，文件可能已损坏');
        if (pos === 8 && kind !== 'IHDR') error('PNG 缺少图片头');
        if (kind === 'IHDR') {
          if (pos !== 8 || length !== 13) error('PNG 图片头无效');
          width = view.getUint32(start, false); height = view.getUint32(start + 4, false); dimensions(width, height);
        } else if (kind === 'acTL') {
          if (length !== 8 || announced || imageData) error('APNG 动画头无效');
          announced = view.getUint32(start, false); dimensions(width, height, announced);
        } else if (kind === 'fcTL') {
          if (!announced || length !== 26 || view.getUint32(start, false) !== sequence++) error('APNG 帧顺序无效');
          const w = view.getUint32(start + 4, false), h = view.getUint32(start + 8, false), x = view.getUint32(start + 12, false), y = view.getUint32(start + 16, false);
          if (!w || !h || x + w > width || y + h > height || bytes[start + 24] > 2 || bytes[start + 25] > 1) error('APNG 帧超出画布');
          dimensions(width, height, ++frames);
        } else if (kind === 'fdAT') {
          if (!announced || !frames || length <= 4 || view.getUint32(start, false) !== sequence++) error('APNG 帧数据无效');
        } else if (kind === 'IDAT') imageData += length;
        else if (kind === 'IEND') { if (length !== 0) error('PNG 结束标记无效'); ended = true; pos = start + length + 4; break; }
        pos = start + length + 4;
      }
      if (!ended || !imageData || (announced && frames !== announced) || pos !== bytes.length) error('PNG 图片不完整');
      return { format: announced ? 'apng' : 'png', mime: 'image/png', width, height, frames: announced || 1, animated: !!announced };
    }
    function gif(input) {
      const { bytes, view } = reader(input);
      if (bytes.length < 14) error('GIF 图片不完整');
      const width = view.getUint16(6, true), height = view.getUint16(8, true); dimensions(width, height);
      let pos = 13 + (bytes[10] & 128 ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0), frames = 0, ended = false, steps = 0;
      function blocks() {
        let size = 0;
        for (;;) { if (++steps > 131072 || pos >= bytes.length) error('GIF 数据块过多或不完整'); const count = bytes[pos++]; if (!count) return size; if (count > bytes.length - pos) error('GIF 数据块越界'); pos += count; size += count; }
      }
      while (pos < bytes.length) {
        if (++steps > 131072) error('GIF 数据块过多');
        const marker = bytes[pos++];
        if (marker === 0x3b) { ended = true; break; }
        if (marker === 0x21) { if (pos >= bytes.length) error('GIF 扩展块不完整'); pos++; blocks(); }
        else if (marker === 0x2c) {
          if (pos + 9 > bytes.length) error('GIF 帧不完整');
          const x = view.getUint16(pos, true), y = view.getUint16(pos + 2, true), w = view.getUint16(pos + 4, true), h = view.getUint16(pos + 6, true), flags = bytes[pos + 8];
          if (!w || !h || x + w > width || y + h > height) error('GIF 帧超出画布');
          dimensions(width, height, ++frames); pos += 9 + (flags & 128 ? 3 * (1 << ((flags & 7) + 1)) : 0);
          if (pos >= bytes.length || bytes[pos] < 2 || bytes[pos] > 8) error('GIF 压缩格式无效');
          pos++; if (!blocks()) error('GIF 缺少帧数据');
        } else error('GIF 数据标记无效');
      }
      if (!ended || !frames) error('GIF 图片不完整');
      return { format: 'gif', mime: 'image/gif', width, height, frames, animated: frames > 1 };
    }
    function jpeg(input) {
      const { bytes, view } = reader(input);
      let pos = 2, width, height, scan = false, ended = false, steps = 0;
      while (pos < bytes.length) {
        if (++steps > 131072 || bytes[pos++] !== 255) error('JPEG 标记无效');
        while (bytes[pos] === 255) pos++;
        if (pos >= bytes.length) error('JPEG 图片不完整');
        const marker = bytes[pos++];
        if (marker === 0xd9) { ended = true; break; }
        if (!marker || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || pos + 2 > bytes.length) error('JPEG 标记顺序无效');
        const length = view.getUint16(pos, false);
        if (length < 2 || length > bytes.length - pos) error('JPEG 数据块越界');
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          if (length < 8) error('JPEG 图片头无效'); height = view.getUint16(pos + 3, false); width = view.getUint16(pos + 5, false); dimensions(width, height);
        }
        pos += length;
        if (marker === 0xda) {
          if (!width) error('JPEG 缺少尺寸'); scan = true;
          while (pos < bytes.length) {
            if (bytes[pos] !== 255) { pos++; continue; }
            if (bytes[pos + 1] === 0 || (bytes[pos + 1] >= 0xd0 && bytes[pos + 1] <= 0xd7)) { pos += 2; continue; }
            break;
          }
        }
      }
      if (!width || !scan || !ended) error('JPEG 图片不完整');
      return { format: 'jpeg', mime: 'image/jpeg', width, height, frames: 1, animated: false };
    }
    function webp(input) {
      const { bytes, view, ascii, u24 } = reader(input);
      if (bytes.length < 20 || view.getUint32(4, true) + 8 !== bytes.length) error('WebP 容器不完整');
      let pos = 12, width, height, content = false, steps = 0;
      while (pos + 8 <= bytes.length) {
        if (++steps > 131072) error('WebP 数据块过多');
        const kind = ascii(pos, 4), size = view.getUint32(pos + 4, true), start = pos + 8;
        if (size > bytes.length - start) error('WebP 数据块越界');
        if (kind === 'VP8X') {
          if (size !== 10 || bytes[start] & 2) error('动画 WebP 请转换为 GIF 或 APNG 后导入');
          width = u24(start + 4) + 1; height = u24(start + 7) + 1; dimensions(width, height);
        } else if (kind === 'VP8 ') {
          if (size < 10 || bytes[start] & 1 || ascii(start + 3, 3) !== '\u009d\u0001\u002a') error('WebP 帧无效');
          const w = view.getUint16(start + 6, true) & 0x3fff, h = view.getUint16(start + 8, true) & 0x3fff; dimensions(w, h);
          if (width && (width !== w || height !== h)) error('WebP 尺寸不一致'); width = w; height = h; content = true;
        } else if (kind === 'VP8L') {
          if (size < 5 || bytes[start] !== 0x2f || bytes[start + 4] >> 5) error('WebP 帧无效');
          const bits = view.getUint32(start + 1, true), w = (bits & 0x3fff) + 1, h = ((bits >>> 14) & 0x3fff) + 1; dimensions(w, h);
          if (width && (width !== w || height !== h)) error('WebP 尺寸不一致'); width = w; height = h; content = true;
        }
        pos = start + size + (size & 1);
      }
      if (!content || pos !== bytes.length) error('WebP 图片不完整');
      return { format: 'webp', mime: 'image/webp', width, height, frames: 1, animated: false };
    }
    function inspectImage(input, kind = 'role') {
      if (kind !== 'role' && kind !== 'bubble') error('未知图片类型');
      const bytes = bytesOf(input); checkFile({ size: bytes.byteLength }, kind);
      let result;
      if (isPng(bytes)) result = png(bytes);
      else if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(reader(bytes).ascii(0, 6))) result = gif(bytes);
      else if (bytes[0] === 255 && bytes[1] === 216) result = jpeg(bytes);
      else if (bytes.length >= 12 && reader(bytes).ascii(0, 4) === 'RIFF' && reader(bytes).ascii(8, 4) === 'WEBP') result = webp(bytes);
      else error('只接受有效的 PNG、JPEG、WebP 或 GIF 图片');
      if (kind === 'bubble' && !['png', 'apng', 'gif'].includes(result.format)) error('泡泡图片只支持 PNG 或 GIF');
      return Object.freeze(result);
    }
    function isAnimatedPng(input) {
      const bytes = bytesOf(input); checkFile({ size: bytes.byteLength }, 'role');
      return isPng(bytes) ? png(bytes).format === 'apng' : false;
    }
    async function validateAudioFile(file) {
      checkFile(file, 'audio');
      return new Promise((resolve, reject) => {
        let audio = null, objectUrl = null, timer = null, settled = false;
        const cleanup = () => {
          if (timer !== null) environment.clearTimeout(timer);
          if (audio) {
            audio.onloadedmetadata = null; audio.onerror = null;
            try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch {}
          }
          if (objectUrl !== null) { try { environment.URL.revokeObjectURL(objectUrl); } catch {} }
        };
        const finish = (failure, result) => { if (settled) return; settled = true; cleanup(); failure ? reject(new Error(failure)) : resolve(result); };
        try {
          if (!environment.document?.createElement || !environment.URL?.createObjectURL) { finish('当前环境无法读取音频元数据'); return; }
          audio = environment.document.createElement('audio'); audio.preload = 'metadata'; audio.muted = true;
          audio.onloadedmetadata = () => {
            const duration = audio.duration;
            if (!Number.isFinite(duration) || duration <= 0) { finish('无法确定音频时长，请先转换为普通 MP3 或 WAV'); return; }
            if (duration > policy.maxAudioSeconds) { finish('音频源文件最多 ' + policy.maxAudioSeconds + ' 秒，请先裁剪'); return; }
            finish(null, Object.freeze({ duration, bytes: file.size }));
          };
          audio.onerror = () => finish('音频格式无法识别或文件已经损坏');
          timer = environment.setTimeout(() => finish('读取音频时长超时，请换一个文件重试'), metadataTimeoutMs);
          objectUrl = environment.URL.createObjectURL(file); audio.src = objectUrl; audio.load();
        } catch { finish('音频元数据读取失败，请重新选择文件'); }
      });
    }
    return Object.freeze({ checkFile, inspectImage, isAnimatedPng, validateAudioFile, getPolicy, setPolicy, refreshPolicy, get policy() { return policy; } });
  }
  const guard = createMediaGuard(host);
  return Object.freeze({ ...guard, get policy() { return guard.getPolicy(); }, createMediaGuard, DEFAULT_POLICY });
});
