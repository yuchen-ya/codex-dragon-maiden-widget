// Limits apply before importing files. Existing libraries are never deleted to
// satisfy a new limit; users can remove old entries themselves.
export const MEDIA_POLICY = Object.freeze({
  roleBytes: 20 * 1024 * 1024, bubbleBytes: 8 * 1024 * 1024,
  audioBytes: 8 * 1024 * 1024, audioSourceBytes: 20 * 1024 * 1024,
  maxImageDimension: 4096, maxImagePixels: 16777216,
  maxFrames: 600, maxAnimationPixels: 128000000,
  maxAudioSeconds: 120, maxAudioChannels: 8, maxAudioSampleRate: 192000,
  maxStorageBytes: 256 * 1024 * 1024, maxItemsPerLibrary: 256,
});

function invalid(message = '素材格式损坏或不受支持') { throw new Error(message); }
function dimensions(width, height, frames = 1) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) invalid('图片尺寸无效');
  if (width > MEDIA_POLICY.maxImageDimension || height > MEDIA_POLICY.maxImageDimension || width * height > MEDIA_POLICY.maxImagePixels) invalid('图片过大：单边最多 4096 像素，总像素最多 16777216');
  if (!Number.isSafeInteger(frames) || frames < 1 || frames > MEDIA_POLICY.maxFrames || (frames > 1 && width * height * frames > MEDIA_POLICY.maxAnimationPixels)) invalid('动图解码量过大：最多 600 帧，画布像素乘帧数最多 128000000');
}
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
function crc32(bytes, start, end) { let c = 0xffffffff; for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function png(bytes) {
  let pos = 8, width, height, announced = 0, frames = 0, sequence = 0, imageData = 0, ended = false;
  while (pos + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(pos), kind = bytes.toString('ascii', pos + 4, pos + 8), start = pos + 8;
    if (length > 0x7fffffff || length > bytes.length - pos - 12) invalid('PNG 数据块长度无效');
    const end = start + length;
    if (crc32(bytes, pos + 4, end) !== bytes.readUInt32BE(end)) invalid('PNG 校验失败，文件可能已损坏');
    if (pos === 8 && kind !== 'IHDR') invalid('PNG 缺少图片头');
    if (kind === 'IHDR') {
      if (pos !== 8 || length !== 13) invalid('PNG 图片头无效');
      width = bytes.readUInt32BE(start); height = bytes.readUInt32BE(start + 4); dimensions(width, height);
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[bytes[start + 9]]?.includes(bytes[start + 8]) || bytes[start + 10] !== 0 || bytes[start + 11] !== 0 || bytes[start + 12] > 1) invalid('PNG 编码无效');
    } else if (kind === 'acTL') {
      if (length !== 8 || announced || imageData) invalid('APNG 动画头无效');
      announced = bytes.readUInt32BE(start); dimensions(width, height, announced);
    } else if (kind === 'fcTL') {
      if (!announced || length !== 26 || bytes.readUInt32BE(start) !== sequence++) invalid('APNG 帧顺序无效');
      const w = bytes.readUInt32BE(start + 4), h = bytes.readUInt32BE(start + 8), x = bytes.readUInt32BE(start + 12), y = bytes.readUInt32BE(start + 16);
      if (!w || !h || x + w > width || y + h > height || bytes[start + 24] > 2 || bytes[start + 25] > 1) invalid('APNG 帧尺寸无效');
      dimensions(width, height, ++frames);
    } else if (kind === 'fdAT') {
      if (!announced || !frames || length <= 4 || bytes.readUInt32BE(start) !== sequence++) invalid('APNG 帧数据无效');
    } else if (kind === 'IDAT') imageData += length;
    else if (kind === 'IEND') { if (length !== 0) invalid('PNG 结束标记无效'); ended = true; pos = end + 4; break; }
    pos = end + 4;
  }
  if (!ended || !imageData || (announced && frames !== announced) || pos !== bytes.length) invalid('PNG 图片不完整');
  return { format: announced ? 'apng' : 'png', mime: 'image/png', extension: 'png', width, height, frames: announced || 1 };
}

function gif(bytes) {
  if (bytes.length < 14) invalid('GIF 图片不完整');
  const width = bytes.readUInt16LE(6), height = bytes.readUInt16LE(8); dimensions(width, height);
  let pos = 13 + (bytes[10] & 128 ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0), frames = 0, ended = false;
  function blocks() {
    let size = 0;
    for (;;) { if (pos >= bytes.length) invalid('GIF 数据块不完整'); const n = bytes[pos++]; if (!n) return size; if (n > bytes.length - pos) invalid('GIF 数据块越界'); pos += n; size += n; }
  }
  while (pos < bytes.length) {
    const marker = bytes[pos++];
    if (marker === 0x3b) { ended = true; break; }
    if (marker === 0x21) { if (pos >= bytes.length) invalid(); pos++; blocks(); }
    else if (marker === 0x2c) {
      if (pos + 9 > bytes.length) invalid('GIF 帧不完整');
      const x = bytes.readUInt16LE(pos), y = bytes.readUInt16LE(pos + 2), w = bytes.readUInt16LE(pos + 4), h = bytes.readUInt16LE(pos + 6), flags = bytes[pos + 8];
      if (!w || !h || x + w > width || y + h > height) invalid('GIF 帧超出画布');
      dimensions(width, height, ++frames); pos += 9 + (flags & 128 ? 3 * (1 << ((flags & 7) + 1)) : 0);
      if (pos >= bytes.length || bytes[pos] < 2 || bytes[pos] > 8) invalid('GIF 压缩格式无效');
      pos++; if (!blocks()) invalid('GIF 缺少帧数据');
    } else invalid('GIF 数据标记无效');
  }
  if (!ended || !frames) invalid('GIF 图片不完整');
  return { format: 'gif', mime: 'image/gif', extension: 'gif', width, height, frames };
}

function jpeg(bytes) {
  let pos = 2, width, height, scan = false, ended = false;
  while (pos < bytes.length) {
    if (bytes[pos++] !== 255) invalid('JPEG 标记无效');
    while (bytes[pos] === 255) pos++;
    if (pos >= bytes.length) invalid('JPEG 图片不完整');
    const marker = bytes[pos++];
    if (marker === 0xd9) { ended = true; break; }
    if (marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) invalid('JPEG 标记顺序无效');
    if (pos + 2 > bytes.length) invalid();
    const length = bytes.readUInt16BE(pos);
    if (length < 2 || length > bytes.length - pos) invalid('JPEG 数据块越界');
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 8) invalid(); height = bytes.readUInt16BE(pos + 3); width = bytes.readUInt16BE(pos + 5); dimensions(width, height);
    }
    pos += length;
    if (marker === 0xda) {
      if (!width) invalid('JPEG 缺少尺寸'); scan = true;
      while (pos < bytes.length) {
        if (bytes[pos] !== 255) { pos++; continue; }
        if (bytes[pos + 1] === 0 || (bytes[pos + 1] >= 0xd0 && bytes[pos + 1] <= 0xd7)) { pos += 2; continue; }
        break;
      }
    }
  }
  if (!width || !scan || !ended) invalid('JPEG 图片不完整');
  return { format: 'jpeg', mime: 'image/jpeg', extension: 'jpg', width, height, frames: 1 };
}

function webp(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(4) + 8 !== bytes.length) invalid('WebP 容器不完整');
  let pos = 12, width, height, content = false;
  while (pos + 8 <= bytes.length) {
    const kind = bytes.toString('ascii', pos, pos + 4), size = bytes.readUInt32LE(pos + 4), start = pos + 8;
    if (size > bytes.length - start) invalid('WebP 数据块越界');
    if (kind === 'VP8X') {
      if (size !== 10 || bytes[start] & 2) invalid('动画 WebP 请转换为 GIF 或 APNG 后导入');
      width = bytes.readUIntLE(start + 4, 3) + 1; height = bytes.readUIntLE(start + 7, 3) + 1; dimensions(width, height);
    } else if (kind === 'VP8 ') {
      if (size < 10 || bytes[start] & 1 || bytes.toString('hex', start + 3, start + 6) !== '9d012a') invalid('WebP 帧无效');
      const w = bytes.readUInt16LE(start + 6) & 0x3fff, h = bytes.readUInt16LE(start + 8) & 0x3fff; dimensions(w, h);
      if (width && (width !== w || height !== h)) invalid('WebP 尺寸不一致'); width = w; height = h; content = true;
    } else if (kind === 'VP8L') {
      if (size < 5 || bytes[start] !== 0x2f || bytes[start + 4] >> 5) invalid('WebP 帧无效');
      const bits = bytes.readUInt32LE(start + 1), w = (bits & 0x3fff) + 1, h = ((bits >>> 14) & 0x3fff) + 1; dimensions(w, h);
      if (width && (width !== w || height !== h)) invalid('WebP 尺寸不一致'); width = w; height = h; content = true;
    }
    pos = start + size + (size & 1);
  }
  if (!content || pos !== bytes.length) invalid('WebP 图片不完整');
  return { format: 'webp', mime: 'image/webp', extension: 'webp', width, height, frames: 1 };
}

export function validateImage(bytes, { maxBytes = MEDIA_POLICY.roleBytes, mime } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 8 || bytes.length > maxBytes) invalid('图片文件过大或为空');
  let result;
  if (bytes.subarray(0, 8).equals(signature)) result = png(bytes);
  else if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) result = gif(bytes);
  else if (bytes[0] === 255 && bytes[1] === 216) result = jpeg(bytes);
  else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') result = webp(bytes);
  else invalid('只接受有效的 PNG、JPEG、WebP 或 GIF 图片');
  if (mime && result.mime !== mime) invalid('图片声明格式与实际文件不一致');
  return result;
}

export function validateWav(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 || bytes.length > MEDIA_POLICY.audioBytes) invalid('WAV 文件须不超过 8 MiB');
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) invalid('WAV 容器无效');
  let pos = 12, format, channels, sampleRate, byteRate, block, bits, dataBytes = 0;
  while (pos + 8 <= bytes.length) {
    const kind = bytes.toString('ascii', pos, pos + 4), size = bytes.readUInt32LE(pos + 4), start = pos + 8;
    if (size > bytes.length - start) invalid('WAV 数据块越界');
    if (kind === 'fmt ') {
      if (size < 16 || format !== undefined) invalid('WAV 格式头无效');
      format = bytes.readUInt16LE(start); channels = bytes.readUInt16LE(start + 2); sampleRate = bytes.readUInt32LE(start + 4); byteRate = bytes.readUInt32LE(start + 8); block = bytes.readUInt16LE(start + 12); bits = bytes.readUInt16LE(start + 14);
      if (![1, 3].includes(format) || !(format === 1 ? [8, 16, 24, 32] : [32, 64]).includes(bits)) invalid('请使用 PCM 或浮点 WAV 音频');
      if (!channels || channels > MEDIA_POLICY.maxAudioChannels || !sampleRate || sampleRate > MEDIA_POLICY.maxAudioSampleRate || block !== channels * bits / 8 || byteRate !== sampleRate * block) invalid('WAV 声道、采样率或数据速率无效');
    } else if (kind === 'data') dataBytes += size;
    pos = start + size + (size & 1);
  }
  if (!format || !dataBytes || pos !== bytes.length || dataBytes % block) invalid('WAV 数据不完整');
  const duration = dataBytes / byteRate;
  if (duration > MEDIA_POLICY.maxAudioSeconds) invalid('音频片段最多 120 秒');
  return { format: 'wav', mime: 'audio/wav', channels, sampleRate, duration };
}

export function decodeMediaDataUrl(value, allowed, maxBytes) {
  if (typeof value !== 'string') invalid('素材数据无效');
  const comma = value.indexOf(',');
  if (comma < 0 || comma > 40) invalid('素材声明无效');
  const header = value.slice(0, comma), mime = header.slice(5, -7);
  if (!header.startsWith('data:') || !header.endsWith(';base64') || !allowed.includes(mime)) invalid('不支持的素材类型');
  const encoded = value.slice(comma + 1);
  if (encoded.length > Math.ceil(maxBytes / 3) * 4 || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) invalid('素材文件过大或编码无效');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > maxBytes) invalid('素材文件过大或为空');
  return { bytes, mime };
}
