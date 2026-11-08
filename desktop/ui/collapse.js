(() => {
  'use strict';
  const root = document.querySelector('.dshwv-root');
  if (!root) return;
  const body = root.querySelector('.dshwv-body');
  const rendering = window.WhaleRendering;
  const key = 'dshw-collapsed';
  const edgeKey = 'dshw-collapse-edge';
  const sourceWidth = 1536, sourceHeight = 1024, sourceScale = 465.08 / sourceWidth;
  const tipOffset = { x: -61.2833348, y: -289.1468160 };
  let collapsed = localStorage.getItem(key) === 'true';
  let edge = collapsed ? localStorage.getItem(edgeKey) : null;
  if (!['left', 'right', 'bottom'].includes(edge)) edge = null;
  let wag = null, wagUntil = 0, tailClicks = [], gesture = null;
  let busy = false, motionTimer = null, motionEpoch = 0, pendingTarget = null;
  let pendingResponse = null;
  let motionNodes = [], motionAnimations = [], baseMatrix = new DOMMatrix();
  const stage = document.createElement('div');
  stage.className = 'dshwv-collapse-stage';
  document.body.appendChild(stage);
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'dshwv-tail';
  const image = document.createElement('img');
  image.src = '/assets/dragon-maiden-tail-v1.png';
  image.alt = ''; image.draggable = false;
  button.appendChild(image); body.insertBefore(button, body.firstChild);
  const canvas = document.createElement('canvas');
  canvas.className = 'dshwv-tail-mesh'; canvas.hidden = true;
  button.appendChild(canvas);
  const mesh = new window.WhaleTailMesh.TailMesh(image, canvas);
  rendering.onFrame(() => mesh.tick());

  function geometry() {
    const r = root.getBoundingClientRect();
    const pet = root.querySelector('.dshwv-img').getBoundingClientRect();
    const k = r.width * .792666667 / 768;
    const mirror = rendering.mirrorScale(root) < 0 ? -1 : 1;
    const startRoot = { x: mirror < 0 ? r.right - r.width * .207333333 - 318 * k : r.left + r.width * .207333333 + 318 * k,
      y: r.top + r.height * .207333333 + 726 * k };
    return { r, pet, k, mirror, startRoot };
  }
  function nearestEdge(g) {
    return Object.entries({ bottom: innerHeight - g.pet.bottom, left: g.pet.left, right: innerWidth - g.pet.right })
      .reduce((best, item) => item[1] < best[1] ? item : best)[0];
  }
  function dock(g) {
    const angle = edge === 'left' ? 90 : edge === 'right' ? -90 : 0;
    const radians = angle * Math.PI / 180;
    const tangent = { x: Math.cos(radians), y: Math.sin(radians) };
    const outward = { x: -tangent.y, y: tangent.x };
    const max = edge === 'bottom' ? innerWidth : innerHeight;
    const along = Math.max(80 * g.k, Math.min(max - 80 * g.k,
      edge === 'bottom' ? g.r.left + (g.mirror < 0 ? 1 - .207333333 - 478.7166652 * .792666667 / 768 : .207333333 + 478.7166652 * .792666667 / 768) * g.r.width
        : (g.pet.top + g.pet.bottom) / 2));
    const boundary = edge === 'bottom' ? { x: along, y: innerHeight } : { x: edge === 'left' ? 0 : innerWidth, y: along };
    const endRoot = { x: boundary.x + outward.x * 232 * g.k - tangent.x * tipOffset.x * g.mirror * g.k,
      y: boundary.y + outward.y * 232 * g.k - tangent.y * tipOffset.x * g.mirror * g.k };
    const rotation = new DOMMatrix().rotate(angle).scale(g.mirror, 1);
    const corners = [[-67, -311], [12, -311], [-67, -232], [12, -232]].map(([x, y]) => {
      const p = new DOMPoint(x * g.k, y * g.k).matrixTransform(rotation);
      return { x: endRoot.x + p.x, y: endRoot.y + p.y };
    });
    return { angle, outward, endRoot, rect: { left: Math.min(...corners.map(p => p.x)), top: Math.min(...corners.map(p => p.y)), size: 79 * g.k } };
  }
  function layout() {
    if (gesture) return;
    const g = geometry();
    if (!g.r.width) return;
    let hinge;
    if (collapsed) {
      if (!edge) edge = nearestEdge(g);
      const d = dock(g);
      if (button.parentElement !== stage) stage.appendChild(button);
      button.classList.add('dshwv-tail-docked');
      Object.assign(button.style, { left: d.rect.left + 'px', top: d.rect.top + 'px', width: d.rect.size + 'px', height: d.rect.size + 'px' });
      hinge = { x: d.endRoot.x - d.rect.left, y: d.endRoot.y - d.rect.top };
      baseMatrix = new DOMMatrix().rotate(d.angle).scale(-g.mirror, 1).rotate(-.7 * 180 / Math.PI);
    } else {
      if (button.parentElement !== body) body.insertBefore(button, body.firstChild);
      button.classList.remove('dshwv-tail-docked');
      button.removeAttribute('style');
      hinge = { x: (318 - 86) * g.k, y: (726 - 487) * g.k };
      baseMatrix = new DOMMatrix().scale(-1, 1);
    }
    const ox = 470 * sourceScale * g.k, oy = 800 * sourceScale * g.k;
    Object.assign(image.style, { width: sourceWidth * sourceScale * g.k + 'px', height: sourceHeight * sourceScale * g.k + 'px',
      left: hinge.x - ox + 'px', top: hinge.y - oy + 'px', transformOrigin: ox + 'px ' + oy + 'px', transform: baseMatrix.toString() });
    mesh.layout(sourceScale * g.k, hinge, baseMatrix);
    button.hidden = busy;
    rendering.presentFor(200);
  }
  function tailImageHit(x, y, stableMatrix) {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
    const s = getComputedStyle(image);
    const width = parseFloat(s.width), height = parseFloat(s.height);
    if (!button.getBoundingClientRect().width || !width) return false;
    const grab = grabVector(x, y);
    const matrix = stableMatrix || new DOMMatrix(s.transform);
    const p = new DOMPoint(grab.x, grab.y).matrixTransform(matrix.inverse());
    if (mesh.active && !stableMatrix) return mesh.hit({ x: p.x / mesh.units + 470, y: p.y / mesh.units + 800 });
    // The shared alpha worker packs nonsquare art bottom-right in a square.
    const size = Math.max(width, height);
    const [ox, oy] = s.transformOrigin.split(' ').map(Number.parseFloat);
    return rendering.hitCache.hit(image, p.x + ox, p.y + oy, false,
      { left: width - size, top: height - size, width: size, height: size });
  }
  function hit(x, y) {
    if (busy) return false;
    if (!collapsed && rendering.hitCache.hit(root.querySelector('.dshwv-img'), x, y, rendering.mirrorScale(root) < 0)) return false;
    return tailImageHit(x, y) || collapsed && performance.now() < wagUntil && tailImageHit(x, y, baseMatrix);
  }
  function update() {
    root.classList.toggle('dshwv-collapsed', collapsed);
    body.inert = collapsed || busy;
    button.removeAttribute('title');
    button.setAttribute('aria-label', collapsed ? '单击摇尾巴，拖动或在1.2秒内点击4次展开小龙娘' : '点击尾尖收起，按住可轻拉尾巴');
    button.setAttribute('aria-expanded', String(!collapsed));
    layout();
    window.dispatchEvent(new CustomEvent('whale-collapse-changed', { detail: { collapsed } }));
  }
  function applyState(value) {
    collapsed = value; tailClicks = [];
    wag?.cancel(); wag = null; wagUntil = 0;
    mesh.stop();
    localStorage.setItem(key, String(value));
    if (value) localStorage.setItem(edgeKey, edge);
    update();
    window.dispatchEvent(new Event('whale-position-committed'));
  }
  function finishMotion(announce = false) {
    ++motionEpoch;
    clearTimeout(motionTimer); motionTimer = null;
    for (const a of motionAnimations) a.cancel();
    motionAnimations = [];
    for (const node of motionNodes) node.remove();
    motionNodes = [];
    busy = false; button.disabled = false;
    root.classList.remove('dshwv-animating');
    const response = pendingResponse; pendingResponse = null;
    if (pendingTarget !== null) { const value = pendingTarget; pendingTarget = null; applyState(value); }
    else update();
    if (announce && !collapsed && response && !document.hidden) window.dispatchEvent(new CustomEvent('whale-tail-response', { detail: response }));
  }
  function actor(src, rect) {
    const el = document.createElement('img');
    el.className = 'dshwv-collapse-actor'; el.alt = ''; el.draggable = false; el.src = src;
    Object.assign(el.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
    motionNodes.push(el);
    return el;
  }
  function edgeActors(value, g, d, epoch) {
    const body = actor(root.querySelector('.dshwv-img').currentSrc, g.pet);
    body.style.transformOrigin = '50% 80%';
    const tailWidth = 768 * g.k / 1.3;
    const tail = actor('/assets/dragon-maiden-tail-' + (value ? 'hide' : 'appear') + '-v8.webp?play=' + epoch,
      { left: g.startRoot.x - tailWidth * 640 / 768, top: g.startRoot.y - tailWidth * 640 / 768, width: tailWidth, height: tailWidth });
    tail.style.transformOrigin = '83.333333% 83.333333%';
    const delta = { x: d.endRoot.x - g.startRoot.x, y: d.endRoot.y - g.startRoot.y };
    const bodyDelta = { x: edge === 'bottom' ? 0 : delta.x, y: edge === 'bottom' ? delta.y : 0 };
    const distance = edge === 'left' ? g.pet.right + g.pet.width * .3 : edge === 'right' ? innerWidth - g.pet.left + g.pet.width * .3 : innerHeight - g.pet.top + g.pet.height * .3;
    const off = { x: d.outward.x * distance, y: d.outward.y * distance };
    const lean = edge === 'left' ? -14 : edge === 'right' ? 14 : 0;
    const bodyPose = (x, y, angle) => 'translate(' + x + 'px,' + y + 'px) rotate(' + angle + 'deg) scaleX(' + g.mirror + ')';
    const tailPose = (x, y, angle) => 'translate(' + x + 'px,' + y + 'px) rotate(' + angle + 'deg) scaleX(' + g.mirror + ')';
    const smooth = x => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); };
    const path = value ? [[0, 0, 0, 0], [.5, bodyDelta.x, bodyDelta.y, lean], [.85, off.x, off.y, lean], [1, off.x, off.y, lean]]
      : [[0, off.x, off.y, lean], [.3, off.x, off.y, lean], [.65, bodyDelta.x, bodyDelta.y, lean], [1, 0, 0, 0]];
    function bodyAt(t) {
      let i = 0;
      while (i < path.length - 2 && path[i + 1][0] < t) i++;
      const a = path[i], b = path[i + 1], u = smooth((t - a[0]) / (b[0] - a[0]));
      return { x: a[1] + (b[1] - a[1]) * u, y: a[2] + (b[2] - a[2]) * u, angle: a[3] + (b[3] - a[3]) * u };
    }
    const origin = { x: g.pet.left + g.pet.width / 2, y: g.pet.top + g.pet.height * .8 };
    function attachedRoot(pose) {
      const point = new DOMPoint(g.startRoot.x - origin.x, g.startRoot.y - origin.y).matrixTransform(new DOMMatrix().rotate(pose.angle));
      return { x: origin.x + point.x + pose.x, y: origin.y + point.y + pose.y };
    }
    const tangent = { x: d.outward.y, y: -d.outward.x };
    const boundary = { x: d.endRoot.x - d.outward.x * 232 * g.k + tangent.x * tipOffset.x * g.mirror * g.k,
      y: d.endRoot.y - d.outward.y * 232 * g.k + tangent.y * tipOffset.x * g.mirror * g.k };
    const outsideDistance = point => (point.x - boundary.x) * d.outward.x + (point.y - boundary.y) * d.outward.y;
    const track = value ? fetch('/assets/dragon-maiden-tail-motion-v8.json').then(response => {
      if (!response.ok) throw Error('Tail motion track unavailable');
      return response.json();
    }) : Promise.resolve(null);
    return { nodes: [tail, body], track, start(tracks) {
      const poses = Array.from({ length: 56 }, (_, i) => bodyAt(i / 55));
      const roots = poses.map(attachedRoot);
      // Do not release the attachment while its base can still be seen.
      const release = value ? roots.findIndex(point => outsideDistance(point) >= 85 * g.k) / 55 : 0;
      const bodyFrames = poses.map((pose, i) => ({ offset: i / 55, transform: bodyPose(pose.x, pose.y, pose.angle) }));
      const tailFrames = poses.map((pose, i) => {
        const t = i / 55;
        let point = roots[i], angle = pose.angle, opacity = 1;
        if (value) {
          const weight = smooth((t - release) / .22);
          angle += (d.angle - angle) * weight;
          const [vx, vy] = tracks.hide[i];
          const v = new DOMPoint(vx * g.k, vy * g.k).matrixTransform(new DOMMatrix().rotate(angle).scale(g.mirror, 1));
          const inwardReach = -v.x * d.outward.x - v.y * d.outward.y;
          const distance = Math.max(85 * g.k, inwardReach - 57.146816 * g.k);
          const along = v.x * tangent.x + v.y * tangent.y;
          const docked = { x: boundary.x + d.outward.x * distance - tangent.x * along,
            y: boundary.y + d.outward.y * distance - tangent.y * along };
          point = { x: point.x + (docked.x - point.x) * weight, y: point.y + (docked.y - point.y) * weight };
        } else if (t < .3) {
          const u = smooth(t / .22);
          point = { x: d.endRoot.x + d.outward.x * 130 * g.k * u, y: d.endRoot.y + d.outward.y * 130 * g.k * u };
          angle = d.angle; opacity = 1 - u;
        } else opacity = smooth((t - .65) / .17);
        return { offset: t, transform: tailPose(point.x - g.startRoot.x, point.y - g.startRoot.y, angle), opacity };
      });
      const start = document.timeline.currentTime;
      for (const [node, frames] of [[body, bodyFrames], [tail, tailFrames]]) {
        const animation = node.animate(frames, { duration: 1170, easing: 'linear', fill: 'both' });
        animation.startTime = start;
        motionAnimations.push(animation);
      }
    } };
  }
  function setCollapsed(value, response = null) {
    if (busy || value === collapsed) return;
    cancelGesture();
    const g = geometry();
    if (value) edge = nearestEdge(g);
    const d = dock(g), epoch = ++motionEpoch;
    pendingTarget = value; pendingResponse = response; busy = true; button.disabled = true;
    // Keep the accepted head-first movie at the bottom edge. At a side or
    // floating position, upright actors move behind the real window boundary.
    const original = new URL(root.querySelector('.dshwv-img').currentSrc, location.href).pathname === '/dsh-whale/image.png';
    let ready;
    if (edge === 'bottom' && Math.abs(g.pet.bottom - innerHeight) < 2 && original) {
      const rect = { left: g.r.right - g.r.width * .792666667, top: g.r.bottom - g.r.height * .792666667,
        width: g.r.width * .792666667, height: g.r.height * .792666667 };
      if (g.mirror < 0) rect.left = g.r.left;
      const movie = actor('/assets/dragon-maiden-' + (value ? 'hide' : 'appear') + '-v7.webp?play=' + epoch, rect);
      movie.classList.add('dshwv-collapse-motion');
      movie.style.transform = 'scaleX(' + g.mirror + ')';
      ready = { nodes: [movie], start() {} };
    } else ready = edgeActors(value, g, d, epoch);
    Promise.all([...ready.nodes.map(el => el.decode()), ready.track]).then(results => {
      if (epoch !== motionEpoch) return;
      root.classList.add('dshwv-animating');
      applyState(value);
      for (const el of ready.nodes) stage.appendChild(el);
      ready.start(results.at(-1));
      rendering.presentFor(1250);
      motionTimer = setTimeout(() => finishMotion(true), 1170);
    }, () => {
      if (epoch !== motionEpoch) return;
      finishMotion();
      window.whaleToast?.('收起动画读取失败，请修复安装素材。');
    });
  }
  function bend(angle, stretch = 1) {
    // The hinge never translates: the complete tail continues through the
    // body or the real window edge instead of exposing a cropped flat end.
    return baseMatrix.rotate(angle).skewX(angle * .25).scale(1, stretch).toString();
  }
  function sway(initialTransform) {
    wag?.cancel();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    wagUntil = performance.now() + (reduced ? 180 : 420);
    wag = image.animate([{ transform: initialTransform || baseMatrix.toString() }, { transform: bend(reduced ? -2 : -6) },
      { transform: bend(reduced ? 1 : 4) }, { transform: baseMatrix.toString() }],
      { duration: reduced ? 180 : 420, easing: 'ease-in-out' });
    rendering.presentFor(450);
  }
  function grabVector(x, y) {
    const rect = button.getBoundingClientRect(), style = getComputedStyle(image);
    const [ox, oy] = style.transformOrigin.split(' ').map(Number.parseFloat);
    const mirror = !collapsed && rendering.mirrorScale(root) < 0 ? -1 : 1;
    const size = getComputedStyle(button);
    const scaleX = rect.width / parseFloat(size.width), scaleY = rect.height / parseFloat(size.height);
    return { x: (mirror < 0 ? rect.right - x : x - rect.left) / scaleX - parseFloat(style.left) - ox,
      y: (y - rect.top) / scaleY - parseFloat(style.top) - oy, mirror, scaleX, scaleY };
  }
  function pull(dx, dy) {
    // Convert the actual screen force through both mirrors and edge rotation.
    // A docked tip has only a few visible pixels: keep its elastic travel
    // proportional to character scale so pulling cannot bury it offscreen.
    const limit = collapsed ? 10 * mesh.units / sourceScale : 160 * mesh.units;
    const distance = Math.hypot(dx, dy), weight = 1 / (1 + distance / limit);
    const delta = new DOMPoint(dx * gesture.grab.mirror * weight / gesture.grab.scaleX,
      dy * weight / gesture.grab.scaleY).matrixTransform(baseMatrix.inverse());
    mesh.pull(gesture.source, delta.x / mesh.units, delta.y / mesh.units);
  }
  function cancelGesture(preserveMesh = false) {
    if (!preserveMesh) mesh.stop();
    if (!gesture) return;
    const id = gesture.pointerId; gesture = null;
    image.style.transform = baseMatrix.toString(); button.classList.remove('dshwv-tail-held');
    if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
    rendering.presentFor(200);
  }
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0 || gesture || !hit(event.clientX, event.clientY)) return;
    event.preventDefault(); event.stopPropagation();
    wag?.cancel(); wag = null;
    image.style.transform = baseMatrix.toString();
    const grab = grabVector(event.clientX, event.clientY);
    const point = new DOMPoint(grab.x, grab.y).matrixTransform(baseMatrix.inverse());
    const source = mesh.sourceAt({ x: point.x / mesh.units + 470, y: point.y / mesh.units + 800 });
    if (!source) return;
    mesh.begin();
    gesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      grab, source, at: performance.now(), moved: false };
    button.setPointerCapture(event.pointerId); button.classList.add('dshwv-tail-held');
  });
  document.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    const distance = Math.hypot(dx, dy);
    if (distance >= 8) { gesture.moved = true; tailClicks = []; }
    pull(dx, dy);
    rendering.presentFor(100);
  }, true);
  document.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const held = gesture.moved || performance.now() - gesture.at >= 260, moved = gesture.moved;
    cancelGesture(true);
    if (collapsed) {
      if (moved) { mesh.release(180, () => setCollapsed(false, 'pull')); return; }
      const now = performance.now();
      mesh.stop();
      tailClicks = held ? [] : tailClicks.filter(at => now - at <= 1200);
      if (!held) tailClicks.push(now);
      if (tailClicks.length >= 4) setCollapsed(false, 'rapid'); else sway();
    } else if (held) { mesh.release(); window.dispatchEvent(new Event('whale-tail-tug')); }
    else setCollapsed(true);
  }, true);
  document.addEventListener('pointercancel', () => cancelGesture(), true);
  button.addEventListener('lostpointercapture', event => { if (gesture?.pointerId === event.pointerId) cancelGesture(); });
  button.addEventListener('click', event => { event.stopPropagation(); if (!event.detail && !busy) setCollapsed(!collapsed); });
  button.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault(); setCollapsed(!collapsed);
  });
  window.addEventListener('whale-reset-position', () => { cancelGesture(); finishMotion(); applyState(false); });
  window.addEventListener('whale-mode-changing', () => { cancelGesture(); finishMotion(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelGesture(); if (busy) finishMotion(); } });
  window.addEventListener('blur', () => { cancelGesture(); tailClicks = []; });
  window.addEventListener('resize', () => { cancelGesture(); tailClicks = []; wagUntil = 0; if (busy) finishMotion(); else layout(); });
  window.addEventListener('whale-position-committed', () => { if (!busy) layout(); });
  new ResizeObserver(() => { if (!busy && !gesture) layout(); }).observe(root);
  image.addEventListener('load', () => rendering.hitCache.prepare(image.src).then(() => rendering.presentFor()));
  if (window.whaleDesktop?.testMode) window.__whaleTailTest = {
    state: () => ({ active: mesh.active, frames: mesh.frames, points: mesh.points, rest: window.WhaleTailMesh.rest,
      triangles: mesh.triangles?.length || 0, units: mesh.units }),
    sourceAt(x, y) {
      const vector = grabVector(x, y), point = new DOMPoint(vector.x, vector.y).matrixTransform(baseMatrix.inverse());
      return mesh.sourceAt({ x: point.x / mesh.units + 470, y: point.y / mesh.units + 800 });
    },
    screenAt(source) {
      const p = mesh.map(source), g = grabVector(0, 0);
      const point = new DOMPoint((p.x - 470) * mesh.units, (p.y - 800) * mesh.units).matrixTransform(baseMatrix);
      return { x: (point.x - g.x) * g.mirror * g.scaleX, y: (point.y - g.y) * g.scaleY };
    }
  };
  window.WhaleCollapse = Object.freeze({
    get collapsed() { return collapsed; }, get busy() { return busy; }, get edge() { return edge; },
    hit,
    paintBounds() {
      const r = button.getBoundingClientRect(), pad = 160 * mesh.units + 16;
      return { left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad, width: r.width + 2 * pad, height: r.height + 2 * pad };
    }
  });
  update();
})();
