(() => {
  'use strict';
  const root = { x: 470, y: 800 };
  // Reference points from the source artwork; deformation is one smooth field.
  const rest = [root, { x: 720, y: 730 }, { x: 960, y: 590 },
    { x: 1070, y: 410 }, { x: 1090, y: 240 }, { x: 1240, y: 200 }];
  const copy = points => points.map(p => ({ ...p }));
  const tip = rest.at(-1);
  const fixedRadius = 150;
  const bendSpan = Math.hypot(tip.x - root.x, tip.y - root.y) - fixedRadius;
  const maxPull = 160;

  function project(point) {
    const t = Math.max(0, Math.min(1, (Math.hypot(point.x - root.x, point.y - root.y) - fixedRadius) / bendSpan));
    return { ...point, weight: t * t * (3 - 2 * t) };
  }
  function mapPoint(p, points) {
    const end = points.at(-1);
    return { x: p.x + (end.x - tip.x) * p.weight, y: p.y + (end.y - tip.y) * p.weight };
  }
  function pose(dx, dy) {
    return rest.map(point => {
      const p = project(point);
      return { x: p.x + dx * p.weight, y: p.y + dy * p.weight };
    });
  }
  function solve(grab, dx, dy, start = rest) {
    const end = start.at(-1);
    const weight = Math.max(.15, grab.weight);
    const x = end.x - tip.x + dx / weight, y = end.y - tip.y + dy / weight;
    const distance = Math.hypot(x, y);
    const scale = distance > maxPull ? maxPull / distance : 1;
    // A single smooth displacement field keeps the root fixed and the outline
    // continuous. Its maximum spatial gradient is 1.5 * maxPull / bendSpan < 1,
    // so a pull cannot reverse the texture or fold neighbouring triangles.
    return pose(x * scale, y * scale);
  }
  function rebound(points, elapsed, duration, reduced = false) {
    if (elapsed >= duration) return copy(rest);
    const t = elapsed / duration;
    const fade = (1 - t) ** 2;
    const weight = reduced ? fade : Math.exp(-3 * t) * (Math.cos(11 * t) + .6 * Math.sin(11 * t)) * fade;
    const end = points.at(-1);
    return pose((end.x - tip.x) * weight, (end.y - tip.y) * weight);
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
