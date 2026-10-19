'use strict';

// One reusable surface in a worker. Its alpha bytes never become window regions.
const canvas = new OffscreenCanvas(1, 1);
const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
let queue = Promise.resolve();
const MAX_MASK_FRAMES = 120, MAX_MASK_PIXELS = 48 * 1024 * 1024, MASK_TIME_MS = 1800;

async function decode(src) {
  const response = await fetch(src);
  if (!response.ok) throw new Error('Image fetch failed');
  const blob = await response.blob();
  let bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply' });
  const size = Math.min(1024, Math.max(bitmap.width, bitmap.height));
  canvas.width = canvas.height = size;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  const alpha = new Uint8Array(size * size);
  function accumulate(frame) {
    const sourceWidth = frame.displayWidth || frame.width, sourceHeight = frame.displayHeight || frame.height;
    const scale = Math.min(size / sourceWidth, size / sourceHeight);
    const width = sourceWidth * scale, height = sourceHeight * scale;
    context.clearRect(0, 0, size, size);
    context.drawImage(frame, size - width, size - height, width, height);
    const rgba = context.getImageData(0, 0, size, size).data;
    for (let i = 0; i < alpha.length; i++) alpha[i] = Math.max(alpha[i], rgba[i * 4 + 3]);
  }
  accumulate(bitmap); bitmap.close(); bitmap = null;
  // MIME image/png may be APNG. Inspect the animation track for every supported
  // animation container, rather than limiting the envelope to GIF.
  if (['image/gif', 'image/png', 'image/webp'].includes(blob.type)) {
    let decoder;
    try {
      if (typeof ImageDecoder === 'undefined') throw new Error('Animation decoder unavailable');
      decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type: blob.type });
      await decoder.tracks.ready;
      const count = decoder.tracks.selectedTrack?.frameCount || 1;
      const startedAt = performance.now();
      if (count > MAX_MASK_FRAMES || count * size * size > MAX_MASK_PIXELS) {
        alpha.fill(255);
      } else {
        for (let index = 1; index < count; index++) {
          if (performance.now() - startedAt > MASK_TIME_MS) { alpha.fill(255); break; }
          const { image } = await decoder.decode({ frameIndex: index });
          try { accumulate(image); } finally { image.close(); }
        }
      }
    } catch {
      // Falling back to the image rectangle keeps every visible frame clickable;
      // an incomplete first-frame mask would silently pass clicks through fins.
      alpha.fill(255);
    } finally { decoder?.close(); }
  }
  return { width: size, height: size, alpha: alpha.buffer };
}

self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const result = await decode(data.src);
      self.postMessage({ id: data.id, ...result }, [result.alpha]);
    } catch { self.postMessage({ id: data.id, error: 'Alpha decode failed' }); }
  });
};
