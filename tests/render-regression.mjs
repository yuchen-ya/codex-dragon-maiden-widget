import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const api = 'window.__whaleRenderTest';
const front = `document.querySelector('.dshwv-frame[data-buffer="' + ${api}.status().front + '"]')`;

export async function verifyRendering({ window, ev, wait, clickAt, hitPoint, move, dispatcher, output, renderInfo, graphicsOnly = false }) {
  const checks = [], details = {};
  const stable = () => wait(`!${api}.status().switching`, 'frame commit');
  const text = () => ev(`${front}.textContent`);
  const close = async () => { await ev(`${api}.close()`); await delay(650); };
  const capture = async name => {
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(output, name + '.png'), image.toPNG());
    return image;
  };
  async function watch(action, count = 36) {
    await ev(`(() => {
      window.__renderFrames = [];
      window.__renderFramesDone = new Promise(resolve => {
        function sample() {
          const layers = [...document.querySelectorAll('.dshwv-frame')].map(el => ({ opacity: +getComputedStyle(el).opacity, text: el.textContent }));
          window.__renderFrames.push({ at: performance.now(), layers, shown: ${api}.status().shown, switching: ${api}.status().switching });
          if (window.__renderFrames.length < ${count}) requestAnimationFrame(sample); else resolve(window.__renderFrames);
        }
        document.addEventListener('pointerup', sample, { once:true, capture:true });
      });
    })()`);
    await action();
    return ev('window.__renderFramesDone');
  }
  const holdNodes = () => ev(`window.__heldFrame = ${front}; window.__heldNodes = [...window.__heldFrame.childNodes]; window.__heldHTML = window.__heldFrame.innerHTML; true`);
  const nodesUnchanged = () => ev(`window.__heldFrame === ${front} && window.__heldHTML === window.__heldFrame.innerHTML && window.__heldNodes.length === window.__heldFrame.childNodes.length && window.__heldNodes.every((node,index) => node === window.__heldFrame.childNodes[index])`);
  async function refresh() { await ev(`${api}.refresh(true)`); await wait(`!${api}.status().busy`, 'background refresh'); }
  async function clickBubble() {
    const point = await ev(`(() => {const r=document.querySelector('.dshwv-bshape').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await clickAt(point); await stable();
  }

  try {
    if (!graphicsOnly) {
      await close();
      await ev(`${api}.queue([
        {kind:'custom',modules:[{type:'text',text:'当前 API 余额'},{type:'balance'},{type:'today'}]},
        {kind:'custom',modules:[{type:'random',lines:[{t:'随机 A',w:1},{t:'随机 B',w:3}]}]}
      ]); window.__savedRandom = Math.random; window.__randomCalls = 0; window.__randomValue = 0; Math.random = () => { window.__randomCalls++; return window.__randomValue; }; true`);
      await clickAt(await hitPoint()); await stable(); await delay(450);
      assert.match(await text(), /12\.35/);
      const first = await text(); await holdNodes();
      dispatcher.whale.provider.amount = 9.8765;
      dispatcher.whale.provider.delay = 150;
      await ev(`${api}.refresh(true)`); await delay(50);
      assert.equal(await ev(`${api}.status().status`), 'loading');
      assert.equal(await nodesUnchanged(), true, 'loading preserves nodes');
      await wait(`!${api}.status().busy`, 'first background update');
      assert.equal(await text(), first); assert.equal(await nodesUnchanged(), true);
      checks.push('first bubble remains unchanged through background loading and success');
      await close(); await clickAt(await hitPoint()); await stable();
      assert.match(await text(), /9\.88/); assert.match(await text(), /2\.47/);
      checks.push('reopening uses the latest balance and usage, formatted to two decimals');
      await clickBubble();
      assert.match(await text(), /随机 A/);
      const second = await text(), calls = await ev('window.__randomCalls');
      assert.equal(calls, 1, 'one weighted draw on entry');
      await holdNodes();
      dispatcher.whale.provider.amount = 8.7654;
      await refresh(); await ev(`${api}.usage()`); await delay(180);
      dispatcher.whale.provider.fail = true; await refresh();
      assert.equal(await ev(`${api}.status().status`), 'error');
      assert.equal(await text(), second); assert.equal(await nodesUnchanged(), true);
      assert.equal(await ev('window.__randomCalls'), calls);
      checks.push('random bubble retains its nodes and sentence through balance, usage and error callbacks');
      dispatcher.whale.provider.fail = false;
      // Send the actual mouse down/up, including the refresh dispatched by endDrag.
      const whalePoint = await hitPoint();
      const frames = await watch(() => clickAt(whalePoint));
      await stable();
      for (const frame of frames) {
        assert.ok(frame.layers.reduce((sum, layer) => sum + layer.opacity, 0) >= 0.98, 'no empty content buffer frame');
        for (const layer of frame.layers) if (layer.opacity > 0.001) assert.doesNotMatch(layer.text, /随机 B/, 'no reroll during return');
      }
      assert.ok(frames.some(frame => frame.switching), 'trace includes the actual transition');
      assert.ok(frames.some(frame => frame.layers.some(layer => layer.opacity > 0.9 && /8\.77/.test(layer.text))), 'trace includes the new complete frame');
      assert.doesNotMatch(await text(), /随机/); assert.match(await text(), /8\.77/);
      assert.equal(await ev('window.__randomCalls'), calls);
      details.returnFrames = frames;
      checks.push('actual whale release returns directly to first bubble without a random flash or empty frame');
      await ev('window.__randomValue = 0.99'); await clickBubble();
      assert.match(await text(), /随机 B/); assert.equal(await ev('window.__randomCalls'), calls + 1);
      await ev('Math.random = window.__savedRandom; true');
      checks.push('random selection occurs once on re-entry and still respects weights');

      // Delay image readiness while keeping the existing complete buffer on screen.
      const beforeImage = await text();
      await ev(`window.__nativeDecode = HTMLImageElement.prototype.decode; window.__releaseImages = [];
        HTMLImageElement.prototype.decode = function () {
          if (!this.classList.contains('dshwv-mimg')) return window.__nativeDecode.call(this);
          const img = this; return new Promise((resolve,reject) => window.__releaseImages.push(() => window.__nativeDecode.call(img).then(resolve,reject)));
        };
        ${api}.scene([{type:'image',imgId:'bimg_petpet'}],0);`);
      await delay(180);
      assert.equal(await text(), beforeImage);
      assert.equal(await ev(`${api}.status().switching`), true);
      assert.equal(await ev(`getComputedStyle(${front}).opacity`), '1');
      await ev(`${api}.close(); HTMLImageElement.prototype.decode = window.__nativeDecode; window.__releaseImages.forEach(release => release());`);
      await delay(350);
      assert.equal(await ev(`${api}.status().switching`), false);
      assert.equal(await ev(`${api}.status().shown`), false);
      assert.equal(await ev("document.querySelector('.dshwv-pop-open') !== null"), false);
      checks.push('slow image decode keeps the previous frame; closing cancels pending commits');
      await ev(`${api}.scene([{type:'text',text:'保留这一帧'}],0)`); await stable(); await delay(450);
      await ev(`HTMLImageElement.prototype.decode = function () { return this.classList.contains('dshwv-mimg') ? Promise.reject(new Error('fixture decode failure')) : window.__nativeDecode.call(this); }; ${api}.scene([{type:'image',imgId:'bimg_petpet'}],0);`);
      await delay(120); await stable(); assert.equal(await text(), '保留这一帧');
      await ev('HTMLImageElement.prototype.decode = window.__nativeDecode; true');
      checks.push('failed decoding retains the complete previous frame');
      await ev(`${api}.scene([{type:'text',text:'过期内容'}],0); ${api}.scene([{type:'text',text:'最后一次切换'}],0);`);
      await stable(); assert.equal(await text(), '最后一次切换');
      await ev(`${api}.scene([{type:'text',text:'自动关闭'}],60)`); await delay(450);
      assert.equal(await ev(`${api}.status().shown`), false); assert.equal(await ev(`${api}.status().switching`), false);
      checks.push('rapid replacement and automatic close invalidate earlier scene generations');
      await ev(`${api}.scene([{type:'image',imgId:'bimg_petpet'}],0)`); await stable(); await delay(450);
      assert.equal(await ev(`${front}.querySelector('img.dshwv-mimg').naturalWidth > 0`), true);
      await capture('bubble-gif');
      checks.push('animated bubble images decode and render through the back buffer');
      await ev(`${api}.scene([{type:'text',text:'被打断的内容'}],0); ${api}.showCost(0.2468)`);
      await wait(`${api}.status().scene === 'cost' && !${api}.status().switching`, 'priority cost scene');
      assert.match(await text(), /上一轮期间 API 扣费:/);
      assert.doesNotMatch(await text(), /被打断的内容/);
      await clickBubble();
      assert.equal(await ev(`${api}.status().shown`), false);
      assert.equal(await ev(`${api}.status().switching`), false);
      checks.push('priority cost scene cancels pending content and its close resets switching');
      dispatcher.whale.provider.delay = 0;

      const originalRole = await ev("document.querySelector('.dshwv-img').currentSrc");
      const nextRole = new URL(originalRole); nextRole.searchParams.set('render-test', 'revision');
      await ev(`window.__releaseRoles = [];
        HTMLImageElement.prototype.decode = function () {
          if (this.className) return window.__nativeDecode.call(this);
          const img=this;return new Promise((resolve,reject) => window.__releaseRoles.push(() => window.__nativeDecode.call(img).then(resolve,reject)));
        };
        ${api}.role('default','测试角色',${JSON.stringify(nextRole.href)}); true;`);
      await delay(180);
      assert.equal(await ev("document.querySelector('.dshwv-img').currentSrc"), originalRole, 'keep the decoded old role while the next one is delayed');
      await ev('HTMLImageElement.prototype.decode = window.__nativeDecode; window.__releaseRoles.forEach(release => release());');
      await wait(`document.querySelector('.dshwv-img').currentSrc === ${JSON.stringify(nextRole.href)} && document.querySelector('.dshwv-img').complete`, 'decoded role swap');
      await ev(`${api}.role('default','小鲸鱼',${JSON.stringify(originalRole)})`);
      await wait(`document.querySelector('.dshwv-img').currentSrc === ${JSON.stringify(originalRole)}`, 'role restored');
      checks.push('role changes retain the old art until the next asset and input mask are ready');
    }

    await close(); move(5, 5); await delay(160);
    await ev(`${api}.scale(1.5); ${api}.place(120,80,false)`); await delay(350);
    const decodeCount = await ev(`${api}.status().hitCache.decodes`);
    const alphaStats = async name => {
      const rect = await ev(`(() => {const r=document.querySelector('.dshwv-img').getBoundingClientRect();return {x:Math.max(0,Math.floor(r.x)-12),y:Math.max(0,Math.floor(r.y)-12),width:Math.ceil(r.width)+24,height:Math.ceil(r.height)+24}})()`);
      const image = await window.webContents.capturePage(rect);
      fs.writeFileSync(path.join(output, name + '.png'), image.toPNG());
      const size = image.getSize(), bytes = image.toBitmap();
      let solid = 0, partial = 0, transparent = 0;
      for (let offset = 3; offset < bytes.length; offset += 4) {
        if (bytes[offset] === 255) solid++; else if (bytes[offset] > 0) partial++; else transparent++;
      }
      return { size, solid, partial, transparent, painted: solid + partial };
    };
    const normal = await alphaStats('edge-normal');
    assert.ok(normal.solid > 1000 && normal.partial > 50 && normal.transparent > 100, 'antialiased transparent edge pixels exist');
    const graphics = [];
    for (let index = 0; index < 4; index++) {
      const flip = index % 2 === 0;
      const trace = await ev(`new Promise(resolve => {
        const root=document.querySelector('.dshwv-root'), text=document.querySelector('.dshwv-text'), frames=[];
        const start=performance.now(); ${api}.place(${120 + index * 12},80,${flip});
        function sample(now) {
          const a=new DOMMatrix(getComputedStyle(root).transform).a;
          frames.push({at:now-start, root:a, text:new DOMMatrix(getComputedStyle(text).transform).a, hitScale:WhaleRendering.mirrorScale(root)});
          if (now-start<380) requestAnimationFrame(sample); else resolve({frames,duration:getComputedStyle(root).transitionDuration,easing:getComputedStyle(root).transitionTimingFunction});
        } requestAnimationFrame(sample);
      })`);
      assert.equal(trace.duration, '0.3s'); assert.equal(trace.easing, 'ease');
      assert.ok(trace.frames.filter(frame => Math.abs(frame.root) < .98).length >= 4, 'full interpolation includes multiple middle frames');
      for (const frame of trace.frames) assert.ok(Math.abs(frame.hitScale - frame.root) < .0001, 'alpha hit testing follows the visible mirror');
      const matrix = trace.frames.at(-1);
      assert.equal(matrix.root, flip ? -1 : 1); assert.equal(matrix.text, flip ? -1 : 1);
      const pixels = await alphaStats('flip-' + index);
      assert.ok(pixels.painted / normal.painted > 0.85, 'complete art after the 300 ms mirror transition');
      graphics.push({ trace, pixels });
    }
    checks.push('both mirror directions retain the original 300 ms ease interpolation, visible hit orientation and complete final art');
    const released = [];
    for (const flip of [true, false]) {
      await close();
      const span = await ev("innerWidth-document.querySelector('.dshwv-root').offsetWidth-45");
      const startX = flip ? span : 45, endX = flip ? 45 : span;
      await ev(`${api}.place(${startX},80,${!flip})`); await delay(350);
      const point = await hitPoint(); move(point.x, point.y); await delay(80);
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: Math.round(point.x), y: Math.round(point.y) });
      for (let step = 1; step <= 8; step++) { move(point.x+(endX-startX)*step/8,point.y); await delay(20); }
      await ev(`window.__releaseTrace=new Promise(resolve=>document.addEventListener('pointerup',()=>{
        const frames=[],start=performance.now();function sample(now){frames.push({at:now-start,a:WhaleRendering.mirrorScale(document.querySelector('.dshwv-root'))});if(now-start<370)requestAnimationFrame(sample);else resolve(frames);}requestAnimationFrame(sample);
      },{once:true,capture:true})); true;`);
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: Math.round(point.x+endX-startX), y: Math.round(point.y) });
      const trace = await ev('window.__releaseTrace');
      assert.equal(await ev(`${api}.status().flip`), flip);
      assert.ok(trace.filter(frame=>Math.abs(frame.a)<.98).length>=4, 'release plays middle frames');
      assert.equal(trace.at(-1).a, flip ? -1 : 1);
      released.push({ flip, trace });
    }
    details.releaseAnimations = released;
    checks.push('actual drag releases to both sides play the complete flip transition');
    await ev(`${api}.place(120,80,false)`); await delay(350);
    await ev(`${api}.place(120,80,true)`); await delay(50);
    const turningPoint = await hitPoint(); move(turningPoint.x,turningPoint.y);
    window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:Math.round(turningPoint.x),y:Math.round(turningPoint.y)});
    move(turningPoint.x+20,turningPoint.y); await delay(30);
    const turningPosition = await ev("document.querySelector('.dshwv-position').getBoundingClientRect().x");
    window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:Math.round(turningPoint.x+20),y:Math.round(turningPoint.y)});
    assert.ok(Math.abs(turningPosition-140)<2, 'drag origin and size do not use the compressed mirror rectangle');
    checks.push('starting a drag during a flip keeps the unscaled layout origin');
    await ev(`${api}.place(120,80,false)`); await delay(350);
    const pressedPoint = await hitPoint(); move(pressedPoint.x, pressedPoint.y); await delay(40);
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: Math.round(pressedPoint.x), y: Math.round(pressedPoint.y) });
    const pressed = [];
    for (let index = 0; index < 4; index++) { await delay(30); pressed.push(await alphaStats('press-' + index)); }
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: Math.round(pressedPoint.x), y: Math.round(pressedPoint.y) });
    for (const pixels of pressed) assert.ok(pixels.painted / normal.painted > 0.7, 'no blank press frame');
    checks.push('real pointer press frames retain the whale silhouette and antialiased edge');
    await close();
    const dragPoint = await hitPoint(); move(dragPoint.x, dragPoint.y);
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: Math.round(dragPoint.x), y: Math.round(dragPoint.y) });
    await delay(30); await ev("window.dispatchEvent(new Event('blur'))");
    assert.equal(await ev("document.querySelector('.dshwv-root').classList.contains('dshwv-dragging')"), false);
    move(2, 2); await delay(120);
    assert.equal(renderInfo().inputEnabled, false);
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: 2, y: 2 });
    checks.push('blur releases drag capture and restores transparent mouse pass-through');
    await delay(900);
    const beforeIdle = renderInfo().presents; await delay(500);
    const idlePresents = renderInfo().presents - beforeIdle;
    assert.ok(idlePresents <= 3, 'no perpetual full-window repaint while idle: ' + idlePresents);
    const timings = await ev(`new Promise(resolve => { const times=[];let last=performance.now(),i=0; function step(now) {times.push(now-last);last=now;${api}.place(120+(i%25)*4,80,!!(i%2)); if(++i<90)requestAnimationFrame(step);else resolve(times.slice(2));}requestAnimationFrame(step); })`);
    const sorted = [...timings].sort((a, b) => a - b);
    const performanceInfo = { frames: timings.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * .95)], maxMs: sorted.at(-1), idlePresents };
    assert.ok(performanceInfo.p95Ms < 80, 'flip frame scheduling stays responsive');
    checks.push('frame scheduling stays responsive and full repaint stops when idle');
    details.hitCache = await ev(`${api}.status().hitCache`);
    assert.equal(details.hitCache.decodes, decodeCount, 'movement, press and resize reuse decoded alpha');
    checks.push('movement and press reuse the alpha cache without new bitmap decoding');
    details.graphics = { devicePixelRatio: await ev('devicePixelRatio'), normal, flips: graphics, pressed, performance: performanceInfo };
    details.rendering = renderInfo();
    await close();
    await ev(`${api}.queue([{kind:'custom',modules:[{type:'text',text:'当前 API 余额'},{type:'balance'},{type:'today'}]}]); ${api}.place(120,80,false); ${api}.open()`);
    await stable(); await delay(500); await capture('bubble-balance');
    const result = { ok: true, graphicsOnly, checks, details };
    fs.writeFileSync(path.join(output, 'render-regression.json'), JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    await capture('render-failure').catch(() => {});
    const status = await ev(`${api}.status()`).catch(() => null);
    fs.writeFileSync(path.join(output, 'render-regression.json'), JSON.stringify({ ok: false, checks, error: error.stack, status, details }, null, 2));
    throw error;
  }
}
