// Electron coordinates are DIP. Never pass []: Electron restores the full window
// for an empty shape, which would put the transparent surface over Codex again.
const EMPTY_SHAPE = Object.freeze([{ x: 0, y: 0, width: 1, height: 1 }]);
const MAX_RECTS = 64;
const MAX_COORDINATE = 32768;
function validateWindowShape(rects, viewport) {
  if (!Array.isArray(rects) || rects.length > MAX_RECTS || !viewport ||
      !Number.isSafeInteger(viewport.width) || !Number.isSafeInteger(viewport.height) ||
      viewport.width < 1 || viewport.height < 1 ||
      viewport.width > MAX_COORDINATE || viewport.height > MAX_COORDINATE) return null;
  const result = [];
  for (const rect of rects) {
    if (!rect || typeof rect !== 'object' || Array.isArray(rect) ||
        !['x', 'y', 'width', 'height'].every(key => typeof rect[key] === 'number' && Number.isFinite(rect[key])) ||
        Math.abs(rect.x) > MAX_COORDINATE || Math.abs(rect.y) > MAX_COORDINATE ||
        rect.width <= 0 || rect.height <= 0 || rect.width > MAX_COORDINATE || rect.height > MAX_COORDINATE) return null;
    const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y));
    const right = Math.min(viewport.width, Math.ceil(rect.x + rect.width));
    const bottom = Math.min(viewport.height, Math.ceil(rect.y + rect.height));
    if (right > x && bottom > y) result.push({ x, y, width: right - x, height: bottom - y });
  }
  return result.length ? result : EMPTY_SHAPE.map(rect => ({ ...rect }));
}
module.exports = { validateWindowShape, EMPTY_SHAPE, MAX_RECTS };
