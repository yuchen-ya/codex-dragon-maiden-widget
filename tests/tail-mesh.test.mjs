import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('../desktop/ui/tail-mesh.js', import.meta.url), 'utf8'), context);
const { rest, project, mapPoint, solve, rebound } = context.window.WhaleTailMesh;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const grab = project(rest.at(-1));
const curvature = points => points.slice(1, -1).reduce((sum, p, i) => {
  const a = points[i], b = points[i + 2];
  const turn = Math.atan2(b.y - p.y, b.x - p.x) - Math.atan2(p.y - a.y, p.x - a.x);
  return sum + Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)));
}, 0);

test('outward tension unfolds the curved tail without moving its root or stretching its links', () => {
  const pulled = solve(grab, 180, -170);
  assert.ok(curvature(pulled) < curvature(rest) * .8);
  for (let i = 0; i <= 4; i++) assert.deepEqual(pulled[i], rest[i]);
  for (let i = 1; i < rest.length; i++) assert.ok(Math.abs(distance(pulled[i], pulled[i - 1]) - distance(rest[i], rest[i - 1])) < 1e-8);
  assert.ok(distance(pulled.at(-1), pulled[0]) > distance(rest.at(-1), rest[0]));
});

test('all four force directions move the held centre in the force direction', () => {
  for (const [dx, dy] of [[150, 0], [-150, 0], [0, 150], [0, -150]]) {
    const pulled = solve(grab, dx, dy);
    const end = pulled.at(-1), start = rest.at(-1);
    assert.ok((end.x - start.x) * dx + (end.y - start.y) * dy > 0);
  }
});

test('release changes joint angles through a return swing and finishes exactly at the rest curve', () => {
  const pulled = solve(grab, 180, -170);
  const released = [0, 80, 180, 300, 500, 700].map(ms => rebound(pulled, ms, 700));
  assert.ok(distance(released[0].at(-1), pulled.at(-1)) < 1e-8);
  assert.ok(curvature(released[2]) > curvature(pulled));
  assert.ok(distance(released[3].at(-1), rest.at(-1)) > .1);
  assert.deepEqual(released.at(-1), rest);
  for (const pose of released) for (let i = 1; i < rest.length; i++) {
    assert.ok(Math.abs(distance(pose[i], pose[i - 1]) - distance(rest[i], rest[i - 1])) < 1e-8);
  }
});

test('regrabbing during a rebound starts from the painted curve instead of snapping back to rest', () => {
  const pulled = solve(grab, 180, -170), returning = rebound(pulled, 110, 700);
  const regrabbed = solve(grab, 0, 0, returning);
  for (let i = 0; i < rest.length; i++) assert.ok(distance(regrabbed[i], returning[i]) < 1e-7);
});

test('small pulls on a fin or curved outline follow the actual held material point', () => {
  for (const point of [{ x: 1110, y: 220 }, { x: 1080, y: 300 }, { x: 1240, y: 170 }]) {
    const material = project(point);
    for (const [dx, dy] of [[8, 8], [-8, -8], [8, -8], [-8, 8]]) {
      const result = mapPoint(material, solve(material, dx, dy));
      assert.ok((result.x - point.x) * dx + (result.y - point.y) * dy > 0, JSON.stringify({ point, dx, dy, result }));
    }
  }
});
