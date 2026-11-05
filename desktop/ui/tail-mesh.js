(() => {
  'use strict';
  const root = { x: 470, y: 800 };
  const controls = [root, { x: 720, y: 730 }, { x: 960, y: 590 },
    { x: 1070, y: 410 }, { x: 1090, y: 240 }, { x: 1240, y: 200 }];
  const rest = [];
  // The same smooth source spine used to author the collapse animation.
  for (let i = 0; i < controls.length - 1; i++) {
    const a = controls[i - 1] || { x: 2 * controls[i].x - controls[i + 1].x, y: 2 * controls[i].y - controls[i + 1].y };
    const b = controls[i], c = controls[i + 1];
    const d = controls[i + 2] || { x: 2 * c.x - b.x, y: 2 * c.y - b.y };
    for (let j = 0; j < 8; j++) {
      const u = j / 8, point = {};
      for (const axis of ['x', 'y']) point[axis] = .5 * (2 * b[axis] + (-a[axis] + c[axis]) * u +
        (2 * a[axis] - 5 * b[axis] + 4 * c[axis] - d[axis]) * u * u + (-a[axis] + 3 * b[axis] - 3 * c[axis] + d[axis]) * u * u * u);
      rest.push(point);
    }
  }
  rest.push(controls.at(-1));
  const lengths = rest.slice(1).map((p, i) => Math.hypot(p.x - rest[i].x, p.y - rest[i].y));
  const angles = rest.slice(1).map((p, i) => Math.atan2(p.y - rest[i].y, p.x - rest[i].x));
  const copy = points => points.map(p => ({ ...p }));
  const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

  function project(point) {
    let best = Infinity, result;
    for (let i = 0; i < lengths.length; i++) {
      const a = rest[i], b = rest[i + 1], dx = b.x - a.x, dy = b.y - a.y;
      const u = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengths[i] ** 2));
      const x = point.x - a.x - dx * u, y = point.y - a.y - dy * u;
      const distance = x * x + y * y;
      if (distance < best) { best = distance; result = { ...point, joint: i, u, dx: x, dy: y }; }
    }
    return result;
  }
  function mapPoint(p, points) {
    const a = points[p.joint], b = points[p.joint + 1];
    const angle = Math.atan2(b.y - a.y, b.x - a.x) - angles[p.joint];
    return { x: a.x + (b.x - a.x) * p.u + p.dx * Math.cos(angle) - p.dy * Math.sin(angle),
      y: a.y + (b.y - a.y) * p.u + p.dx * Math.sin(angle) + p.dy * Math.cos(angle) };
  }
  function solve(grab, dx, dy, start = rest) {
    const points = copy(start);
    const material = mapPoint(grab, start), goal = { x: material.x + dx, y: material.y + dy };
    const anchor = start[4], reach = lengths.slice(4, grab.joint + 1).reduce((sum, length) => sum + length, 0);
    const currentReach = Math.hypot(material.x - anchor.x, material.y - anchor.y);
    const extension = Math.hypot(goal.x - anchor.x, goal.y - anchor.y) - currentReach;
    const tension = Math.max(0, Math.min(.95, extension / Math.max(80, reach - currentReach)));
    const direction = Math.atan2(goal.y - anchor.y, goal.x - anchor.x);
    let distalTurn = 0;
    // Seed a smooth uncoiling under tension. Otherwise a centre-seeking joint
    // solver can satisfy the cursor using several small zigzags near the tip.
    for (let i = 4; i < lengths.length; i++) {
      const angle = Math.atan2(start[i + 1].y - start[i].y, start[i + 1].x - start[i].x);
      if (i <= grab.joint) distalTurn = wrap(direction - angle) * tension * Math.min(1, (i - 3) / 6);
      points[i + 1] = { x: points[i].x + Math.cos(angle + distalTurn) * lengths[i],
        y: points[i].y + Math.sin(angle + distalTurn) * lengths[i] };
    }
    const reference = points.slice(1).map((point, i) => Math.atan2(point.y - points[i].y, point.x - points[i].x));
    // Fixed-length links unfold under outward tension, rather than stretching
    // the picture. Rotate the real held material point (including fin/outline
    // offsets), not a rounded centreline joint. The first four links stay fixed.
    for (let iteration = 0; iteration < 16; iteration++) {
      for (let i = grab.joint; i >= 4; i--) {
        const held = mapPoint(grab, points), pivot = points[i];
        const ax = held.x - pivot.x, ay = held.y - pivot.y;
        const bx = goal.x - pivot.x, by = goal.y - pivot.y;
        const angle = Math.max(-.18, Math.min(.18, Math.atan2(ax * by - ay * bx, ax * bx + ay * by)));
        const cos = Math.cos(angle), sin = Math.sin(angle);
        for (let j = i + 1; j < points.length; j++) {
          const x = points[j].x - pivot.x, y = points[j].y - pivot.y;
          points[j] = { x: pivot.x + x * cos - y * sin, y: pivot.y + x * sin + y * cos };
        }
      }
      // Spread a joint correction through its neighbours, retaining the smooth
      // seeded curve instead of leaving a sharp elbow or a sawtooth at the tip.
      const offsets = points.slice(1).map((point, i) => wrap(Math.atan2(point.y - points[i].y, point.x - points[i].x) - reference[i]));
      for (let i = 4; i < lengths.length; i++) {
        const previous = i === 4 ? 0 : offsets[i - 1], next = offsets[i + 1] ?? offsets[i];
        const angle = reference[i] + offsets[i] * .3 + (previous + next) * .35;
        points[i + 1] = { x: points[i].x + Math.cos(angle) * lengths[i], y: points[i].y + Math.sin(angle) * lengths[i] };
      }
    }
    return points;
  }
  function rebound(points, elapsed, duration, reduced = false) {
    if (elapsed >= duration) return copy(rest);
    const result = [{ ...root }];
    for (let i = 0; i < lengths.length; i++) {
      const offset = wrap(Math.atan2(points[i + 1].y - points[i].y, points[i + 1].x - points[i].x) - angles[i]);
      const t = Math.max(0, elapsed - 35 * i / lengths.length) / duration;
      const fade = (1 - t) ** 2;
      const weight = reduced ? fade : Math.exp(-3 * t) * (Math.cos(11 * t) + .6 * Math.sin(11 * t)) * fade;
      const angle = angles[i] + offset * weight;
      result.push({ x: result[i].x + Math.cos(angle) * lengths[i], y: result[i].y + Math.sin(angle) * lengths[i] });
    }
    return result;
  }
  function triangle(context, image, source, target) {
    const [p, q, r] = source, [a, b, c] = target;
    const det = (q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y);
    const aa = ((b.x - a.x) * (r.y - p.y) - (c.x - a.x) * (q.y - p.y)) / det;
    const cc = ((c.x - a.x) * (q.x - p.x) - (b.x - a.x) * (r.x - p.x)) / det;
    const bb = ((b.y - a.y) * (r.y - p.y) - (c.y - a.y) * (q.y - p.y)) / det;
    const dd = ((c.y - a.y) * (q.x - p.x) - (b.y - a.y) * (r.x - p.x)) / det;
    const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3;
    context.save(); context.beginPath();
    for (const [i, point] of target.entries()) {
      // Subpixel overlap closes canvas triangle antialiasing seams.
      const radius = Math.hypot(point.x - cx, point.y - cy);
      const scale = 1 + 1.5 / context.getTransform().a / Math.max(1, radius);
      const x = cx + (point.x - cx) * scale, y = cy + (point.y - cy) * scale;
      if (i) context.lineTo(x, y); else context.moveTo(x, y);
    }
    context.closePath(); context.clip();
    context.transform(aa, bb, cc, dd, a.x - aa * p.x - cc * p.y, a.y - bb * p.x - dd * p.y);
    context.drawImage(image, 0, 0); context.restore();
  }

  class TailMesh {
    constructor(image, canvas) {
      this.image = image; this.canvas = canvas;
      this.context = canvas.getContext('2d');
      this.points = copy(rest); this.active = false; this.releaseState = null;
      this.triangles = null; this.targets = []; this.units = 1; this.frames = 0;
    }
    prepare() {
      if (this.triangles) return;
      const mask = document.createElement('canvas'); mask.width = 768; mask.height = 512;
      const context = mask.getContext('2d', { willReadFrequently: true });
      context.drawImage(this.image, 0, 0, 768, 512);
      this.alpha = context.getImageData(0, 0, 768, 512).data;
      this.triangles = [];
      const step = 32, vertices = new Map();
      const vertex = (x, y) => {
        const key = x + ',' + y;
        if (!vertices.has(key)) vertices.set(key, project({ x, y }));
        return vertices.get(key);
      };
      for (let y = 0; y < 1024; y += step) for (let x = 0; x < 1536; x += step) {
        let opaque = false;
        for (let py = y / 2; py < (y + step) / 2 && !opaque; py++)
          for (let px = x / 2; px < (x + step) / 2; px++)
            if (this.alpha[(py * 768 + px) * 4 + 3] > 10) { opaque = true; break; }
        if (!opaque) continue;
        const a = vertex(x, y), b = vertex(x + step, y), c = vertex(x, y + step), d = vertex(x + step, y + step);
        this.triangles.push([a, b, c], [b, d, c]);
      }
    }
    layout(units, hinge, matrix) {
      const key = [units, hinge.x, hinge.y, matrix.toString()].join(',');
      if (key === this.layoutKey) return;
      this.layoutKey = key;
      this.stop(); this.units = units;
      const size = 2560 * units;
      // Keep the full original source under the same fixed attachment transform.
      Object.assign(this.canvas.style, { width: size + 'px', height: size + 'px', left: hinge.x - size / 2 + 'px',
        top: hinge.y - size / 2 + 'px', transformOrigin: '50% 50%', transform: matrix.toString() });
      const resolution = Math.ceil(size * Math.min(2, devicePixelRatio));
      if (this.canvas.width !== resolution) this.canvas.width = this.canvas.height = resolution;
    }
    pull(grab, dx, dy) {
      this.prepare(); this.releaseState = null; this.active = true;
      this.points = solve(project(grab), dx, dy, this.grabPoints); this.draw();
    }
    begin() { this.grabPoints = copy(this.points); this.releaseState = null; }
    release(duration = 700, onRest = null) {
      if (!this.active) { onRest?.(); return; }
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) duration = Math.min(duration, 180);
      this.releaseState = { points: copy(this.points), at: performance.now(), duration, onRest, reduced };
      window.WhaleRendering.presentFor(duration + 40);
    }
    tick() {
      const state = this.releaseState;
      if (!state) return;
      const elapsed = performance.now() - state.at;
      if (elapsed >= state.duration) {
        const callback = state.onRest; this.stop(); callback?.(); return;
      }
      this.points = rebound(state.points, elapsed, state.duration, state.reduced); this.draw();
    }
    stop() {
      this.active = false; this.releaseState = null; this.points = copy(rest);
      this.image.style.opacity = ''; this.canvas.hidden = true;
    }
    draw() {
      const c = this.context, scale = this.canvas.width / 2560;
      c.resetTransform(); c.clearRect(0, 0, this.canvas.width, this.canvas.height);
      c.scale(scale, scale); c.translate(1280 - root.x, 1280 - root.y);
      this.targets = this.triangles.map(tri => tri.map(p => mapPoint(p, this.points)));
      for (let i = 0; i < this.triangles.length; i++) triangle(c, this.image, this.triangles[i], this.targets[i]);
      this.canvas.hidden = false; this.image.style.opacity = '0'; this.frames++;
    }
    map(source) { return this.active ? mapPoint(project(source), this.points) : { ...source }; }
    sourceAt(point) {
      if (!this.active) return point;
      for (let i = this.targets.length - 1; i >= 0; i--) {
        const [a, b, c] = this.targets[i], [p, q, r] = this.triangles[i];
        const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
        if (Math.abs(det) < .001) continue;
        const u = ((point.x - a.x) * (c.y - a.y) - (point.y - a.y) * (c.x - a.x)) / det;
        const v = ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) / det;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const x = Math.floor((p.x + (q.x - p.x) * u + (r.x - p.x) * v) / 2);
        const y = Math.floor((p.y + (q.y - p.y) * u + (r.y - p.y) * v) / 2);
        if (x >= 0 && x < 768 && y >= 0 && y < 512 && this.alpha[(y * 768 + x) * 4 + 3] > 10)
          return { x: p.x + (q.x - p.x) * u + (r.x - p.x) * v, y: p.y + (q.y - p.y) * u + (r.y - p.y) * v };
      }
      return null;
    }
    hit(point) { return !!this.sourceAt(point); }
  }
  window.WhaleTailMesh = Object.freeze({ TailMesh, root, rest, project, mapPoint, solve, rebound });
})();
