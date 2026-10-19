import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { validateWindowShape, EMPTY_SHAPE, MAX_RECTS } = require('../desktop/window-shape.cjs');
const viewport = { width: 1200, height: 800 };
const rect = { x: 100, y: 200, width: 160, height: 140 };

test('shape limits native drawing and input to separate UI islands', () => {
  const shape = validateWindowShape([rect, { x: 700, y: 40, width: 220, height: 300 }], viewport);
  assert.deepEqual(shape, [rect, { x: 700, y: 40, width: 220, height: 300 }]);
  assert.equal(shape.some(r => 500 >= r.x && 500 < r.x + r.width && 400 >= r.y && 400 < r.y + r.height), false);
});

test('rounds fractional DIP outward and clips UI crossing viewport edges', () => {
  assert.deepEqual(validateWindowShape([{ x: -2.4, y: 799.1, width: 20.6, height: 30 }], viewport), [{ x: 0, y: 799, width: 19, height: 1 }]);
  assert.deepEqual(validateWindowShape([{ x: 1199.3, y: 2.2, width: 10, height: 2.2 }], viewport), [{ x: 1199, y: 2, width: 1, height: 3 }]);
});

test('empty or wholly offscreen UI never resets the native region to full window', () => {
  assert.deepEqual(validateWindowShape([], viewport), EMPTY_SHAPE);
  assert.deepEqual(validateWindowShape([{ ...rect, x: -500 }], viewport), EMPTY_SHAPE);
  const shape = validateWindowShape([], viewport); shape[0].width = 999;
  assert.equal(validateWindowShape([], viewport)[0].width, 1);
});

test('rejects malformed, nonfinite, oversized and excessive rectangles atomically', () => {
  for (const input of [null, {}, 'rect', [null], [[]], [{ ...rect, width: 0 }], [{ ...rect, height: -1 }], [{ ...rect, x: Infinity }], [{ ...rect, y: NaN }], [{ ...rect, width: '1' }], [{ ...rect, x: 32769 }], [{ ...rect, width: 32769 }], [rect, {}], Array(MAX_RECTS + 1).fill(rect)]) {
    assert.equal(validateWindowShape(input, viewport), null);
  }
  assert.equal(validateWindowShape(Array(MAX_RECTS).fill(rect), viewport).length, MAX_RECTS);
});

test('rejects invalid viewport dimensions', () => {
  for (const value of [null, {}, { width: 0, height: 100 }, { width: 1200.5, height: 800 }, { width: 40000, height: 800 }]) assert.equal(validateWindowShape([rect], value), null);
});
