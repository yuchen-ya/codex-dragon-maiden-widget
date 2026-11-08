import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('../desktop/ui/tail-mesh.js', import.meta.url), 'utf8'), context);
const { rest, project, mapPoint, solve, rebound } = context.window.WhaleTailMesh;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const grab = project(rest.at(-1));
const attachment = [rest[0], { x: 570, y: 800 }, { x: 470, y: 700 }, { x: 400, y: 880 }];
const curvature = points => points.slice(1, -1).reduce((sum, p, i) => {
  const a = points[i], b = points[i + 2];
  const turn = Math.atan2(b.y - p.y, b.x - p.x) - Math.atan2(p.y - a.y, p.x - a.x);
  return sum + Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)));
}, 0);

test('outward tension follows the pull while the attachment stays fixed and local strain stays bounded', () => {
  const pulled = solve(grab, 180, -170);
  assert.ok(curvature(pulled) < curvature(rest));
  for (const point of attachment) assert.equal(distance(mapPoint(project(point), pulled), point), 0);
  for (let i = 1; i < rest.length; i++) {
    const ratio = distance(pulled[i], pulled[i - 1]) / distance(rest[i], rest[i - 1]);
    assert.ok(ratio > .7 && ratio < 1.3);
  }
  assert.ok(distance(pulled.at(-1), pulled[0]) > distance(rest.at(-1), rest[0]));
});

test('all four force directions move the held centre in the force direction', () => {
  for (const [dx, dy] of [[150, 0], [-150, 0], [0, 150], [0, -150]]) {
    const pulled = solve(grab, dx, dy);
    const end = pulled.at(-1), start = rest.at(-1);
    assert.ok((end.x - start.x) * dx + (end.y - start.y) * dy > 0);
  }
});

test('release returns the whole curve through a gentle swing and finishes at rest', () => {
  const pulled = solve(grab, 180, -170);
  const released = [0, 80, 180, 300, 500, 700].map(ms => rebound(pulled, ms, 700));
  assert.ok(distance(released[0].at(-1), pulled.at(-1)) < 1e-8);
  assert.ok(curvature(released[2]) > curvature(pulled));
  assert.ok(distance(released[3].at(-1), rest.at(-1)) > .1);
  assert.deepEqual(released.at(-1), rest);
  for (const pose of released) for (const point of attachment) assert.equal(distance(mapPoint(project(point), pose), point), 0);
});

test('inward, sideways and extreme pulls never fold the texture during dragging or rebound', () => {
  const triangles = [];
  for (let y = 0; y < 1024; y += 32) for (let x = 0; x < 1536; x += 32) {
    const a = project({ x, y }), b = project({ x: x + 32, y }), c = project({ x, y: y + 32 }), d = project({ x: x + 32, y: y + 32 });
    triangles.push([a, b, c], [b, d, c]);
  }
  const area = ([a, b, c]) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (const point of [{ x: 1110, y: 220 }, { x: 1080, y: 300 }, rest.at(-1)]) {
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
      const pulled = solve(project(point), Math.cos(angle) * 2000, Math.sin(angle) * 2000);
      for (const pose of [pulled, rebound(pulled, 100, 700), rebound(pulled, 300, 700)]) {
        for (const triangle of triangles) {
          const ratio = area(triangle.map(p => mapPoint(p, pose))) / area(triangle);
          assert.ok(ratio > .7 && ratio < 1.3, 'texture must keep its winding and bounded area: ' + ratio);
        }
      }
    }
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
