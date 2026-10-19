import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { syncNativeViewport } = createRequire(import.meta.url)('../desktop/native-viewport.cjs');
test('DPI resize cannot replay old coordinates and repeated heartbeats never resize again', () => {
 const sizes = [], current = { x: -1000, y: 31, width: 500, height: 400 };
 const window = { getBounds: () => current, setBounds: (rect, animate) => { assert.deepEqual(Object.keys(rect).sort(), ['height','width']); sizes.push([rect.width,rect.height,animate]); }, setPosition: () => assert.fail('must never write x/y') };
 const screen = { getDisplayMatching: () => ({ scaleFactor: 1.25 }) };
 let host = { nativeFollowing: true, visible: true, window: '10', dpi: 144, bounds: { x: 500, y: 200, width: 1200, height: 900 } };
 let key = syncNativeViewport(host, window, screen);
 assert.deepEqual(sizes, [[800, 600, false]]);
 for (let i = 0; i < 1000; i++) { current.x++; host.bounds.x--; key = syncNativeViewport(host, window, screen, key); }
 assert.equal(sizes.length, 1);
 host.dpi = 120; key = syncNativeViewport(host, window, screen, key);
 assert.deepEqual(sizes[1], [960, 720, false]);
 assert.equal(syncNativeViewport({ ...host, nativeFollowing: false }, window, screen, key), '');
});
test('invalid and hidden host packets never resize', () => {
 const window = { getBounds: () => assert.fail('hidden host'), setSize: () => assert.fail('invalid host') };
 assert.equal(syncNativeViewport({ nativeFollowing: true, visible: false }, window, {}, 'previous'), 'previous');
 assert.equal(syncNativeViewport({ nativeFollowing: true, visible: true, bounds: { width: NaN } }, window, {}, 'previous'), 'previous');
});
