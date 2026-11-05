// Run with Electron: electron tests/collapse-fixture.cjs. All data is isolated.
const { app, BrowserWindow, protocol, session, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'qa-output', 'collapse');
const dataDir = path.join(output, 'run-' + Date.now());
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', path.join(dataDir, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
protocol.registerSchemesAsPrivileged([{ scheme: 'whale', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
let saved = {}, shapes = [], win, dispatcher;
const checks = [], errors = [];
ipcMain.on('whale-storage', event => { event.returnValue = saved; });
ipcMain.on('whale-save-storage', (_event, values) => { saved = values; });
ipcMain.on('whale-shape', (_event, values) => { shapes = values; if (process.platform === 'win32') win.setShape(values); });
ipcMain.handle('whale-command', () => true);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ev = code => win.webContents.executeJavaScript(code);
async function wait(code, label) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) { if (await ev(code)) return; await delay(25); }
  throw Error('Timed out: ' + label);
}
function click(point, clickCount = 1) {
  const p = { x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount };
  win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
  win.webContents.sendInputEvent({ type: 'mouseDown', ...p });
  win.webContents.sendInputEvent({ type: 'mouseUp', ...p });
}
const collapsed = () => ev('WhaleCollapse.collapsed');
async function tailPoint() {
  const point = await ev(`(() => {
    for(const source of [{x:1200,y:180},{x:1190,y:190},{x:1110,y:220},{x:1080,y:300},{x:1060,y:410},{x:1000,y:530}]){
      const p=__whaleTailTest.screenAt(source);
      if([[0,0],[2,0],[-2,0],[0,2],[0,-2]].every(([dx,dy])=>WhaleCollapse.hit(p.x+dx,p.y+dy)))return p;
    }
    const r=document.querySelector('.dshwv-tail img').getBoundingClientRect();
    for(let y=Math.ceil(r.top);y<r.bottom;y+=2)for(let x=Math.ceil(r.left);x<r.right;x+=2)
      if([[0,0],[2,0],[-2,0],[0,2],[0,-2]].every(([dx,dy])=>WhaleCollapse.hit(x+dx,y+dy)))return {x,y};
    const img=document.querySelector('.dshwv-tail img'),s=getComputedStyle(img);
    return {error:'No exposed clickable tail pixel',complete:img.complete,natural:[img.naturalWidth,img.naturalHeight],viewport:[innerWidth,innerHeight],bounds:r.toJSON(),button:img.parentElement.getBoundingClientRect().toJSON(),
      style:{left:s.left,top:s.top,width:s.width,height:s.height,transform:s.transform,origin:s.transformOrigin},src:img.currentSrc};
  })()`);
  assert.ok(!point.error, JSON.stringify(point));
  return point;
}
async function restoreByClicks() {
  const point = await tailPoint();
  for (let i = 0; i < 4; i++) { click(point, i + 1); await delay(75); }
  await wait('!WhaleCollapse.collapsed && !WhaleCollapse.busy', 'four-tap restore');
  await delay(70);
}
async function dragTail() {
  const p = await tailPoint(), x = Math.round(p.x), y = Math.round(p.y);
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await delay(300);
  assert.equal(await ev("!!document.querySelector('.dshwv-tail-held')"), true, 'tail pointer capture survives the hold');
  await startPullProbe({ x, y });
  for (const [dx, dy] of [[60, 0], [-60, 0], [0, 60], [0, -60]]) {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: x + dx, y: y + dy, modifiers: ['leftbuttondown'] });
    await delay(50);
    await checkPullDirection(dx, dy);
  }
  win.webContents.sendInputEvent({ type: 'mouseMove', x: x + 60, y: y - 30, modifiers: ['leftbuttondown'] });
  await delay(60);
  const pull = await ev("(() => {const m=new DOMMatrix(getComputedStyle(document.querySelector('.dshwv-tail img')).transform);return {x:m.m41,y:m.m42,full:document.querySelector('.dshwv-tail img').naturalWidth};})()");
  assert.equal(pull.x, 0); assert.equal(pull.y, 0);
  assert.equal(pull.full, 1536, 'complete tail, not a cropped tip, is deformed around a fixed hinge');
  win.webContents.sendInputEvent({ type: 'mouseUp', x: x + 60, y: y - 30, button: 'left', clickCount: 1 });
}
async function startPullProbe(point) {
  await ev(`(() => {
    const img=document.querySelector('.dshwv-tail img'), r=img.parentElement.getBoundingClientRect(), s=getComputedStyle(img);
    const mirror=!WhaleCollapse.collapsed && WhaleRendering.mirrorScale(document.querySelector('.dshwv-root'))<0?-1:1;
    const [ox,oy]=s.transformOrigin.split(' ').map(parseFloat);
    const origin={x:parseFloat(s.left)+ox,y:parseFloat(s.top)+oy};
    window.__tailPullProbe={source:__whaleTailTest.sourceAt(${point.x},${point.y}),start:${JSON.stringify(point)}};
  })()`);
}
async function checkPullDirection(dx, dy) {
  const displacement = await ev(`(() => {
    const probe=__tailPullProbe,p=__whaleTailTest.screenAt(probe.source);
    return {x:p.x-probe.start.x,y:p.y-probe.start.y};
  })()`);
  assert.ok(displacement.x * dx + displacement.y * dy > .1,
    `grabbed tail pixel must follow force (${dx},${dy}), got ${JSON.stringify(displacement)}`);
}
async function capture(name) {
  const r = await ev(`(() => { const r=document.querySelector('.dshwv-root').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}; })()`);
  fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage(r)).toPNG());
}
async function checkTailConnection(name) {
  const screenshot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(output, name + '.png'), screenshot.toPNG());
  const { width, height } = screenshot.getSize(), rgba = screenshot.toBitmap();
  const seen = new Uint8Array(width * height), queue = new Int32Array(width * height);
  let components = 0;
  const edge = await ev('WhaleCollapse.edge');
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || rgba[start * 4 + 3] < 96) continue;
    let head = 0, end = 1, touches = false;
    queue[0] = start; seen[start] = 1;
    while (head < end) {
      const index = queue[head++], x = index % width, y = Math.floor(index / width);
      if (edge === 'bottom' ? y >= height - 3 : edge === 'left' ? x <= 2 : x >= width - 3) touches = true;
      for (const next of [x ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y ? index - width : -1, y < height - 1 ? index + width : -1]) {
        if (next < 0 || seen[next] || rgba[next * 4 + 3] < 96) continue;
        seen[next] = 1; queue[end++] = next;
      }
    }
    if (end < 12) continue;
    components++;
    assert.equal(touches, true, name + ': tail pixels must remain connected to the real ' + edge + ' edge');
  }
  assert.ok(components > 0, name + ': tail remains visible');
}
async function checkHiddenPull(name) {
  const p = await tailPoint(), x = Math.round(p.x), y = Math.round(p.y);
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await delay(30); await startPullProbe({ x, y });
  for (const [dx, dy] of [[60, -60], [-60, -60], [60, 60], [-60, 60]]) {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: x + dx, y: y + dy, modifiers: ['leftbuttondown'] });
    await delay(70);
    await checkPullDirection(dx, dy);
    await checkTailConnection(name + '-' + dx + '-' + dy);
  }
  await ev("window.dispatchEvent(new Event('blur'))");
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}
async function auditDeformation() {
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const folder = path.join(root, 'qa-output', 'tail-deformation');
  fs.mkdirSync(folder, { recursive: true });
  const poses = [];
  for (const mirror of [false, true]) {
    await ev(`localStorage.setItem('dshw-collapsed','false');localStorage.setItem('dshw-pos',JSON.stringify({v:2,hAnchor:'${mirror ? 'left' : 'right'}',hDist:120,vAnchor:'bottom',vDist:0}));`);
    await win.reload();
    await wait(`window.__whaleTailTest && WhaleRendering.hitCache.stats.decodes>=2 && __whaleRenderTest.status().flip===${mirror}`, 'audit layout');
    await ev(`window.__tailDrawTimes=[];(()=>{const prototype=WhaleTailMesh.TailMesh.prototype,draw=prototype.draw;prototype.draw=function(){const at=performance.now();draw.call(this);__tailDrawTimes.push(performance.now()-at);};})()`);
    await delay(400);
    const point = await tailPoint(), x = Math.round(point.x), y = Math.round(point.y);
    const hinge = await ev('__whaleTailTest.screenAt({x:470,y:800})');
    const length = Math.hypot(x - hinge.x, y - hinge.y);
    const dx = (x - hinge.x) / length * 110, dy = (y - hinge.y) / length * 110;
    async function sample(label) {
      const state = await ev(`({...__whaleTailTest.state(),label:'${label}',mirror:${mirror},material:__whaleTailTest.screenAt({x:1240,y:200})})`);
      state.file = (mirror ? 'mirror-' : 'normal-') + label + '.png';
      const screenshot = await win.webContents.capturePage();
      fs.writeFileSync(path.join(folder, state.file), screenshot.toPNG());
      if (label === 'held') {
        const samples = await ev(`(() => {
          const img=document.querySelector('.dshwv-tail img'), c=document.createElement('canvas');c.width=1536;c.height=1024;
          const context=c.getContext('2d',{willReadFrequently:true});context.drawImage(img,0,0);const pixels=context.getImageData(0,0,1536,1024).data,result=[];
          for(let y=120;y<930;y+=31)for(let x=320;x<1240;x+=29){
            if(![[0,0],[10,0],[-10,0],[0,10],[0,-10]].every(([dx,dy])=>pixels[((y+dy)*1536+x+dx)*4+3]>=250))continue;
            const p=__whaleTailTest.screenAt({x,y});
            if(p.x>3&&p.y>3&&p.x<innerWidth-3&&p.y<innerHeight-3&&WhaleCollapse.hit(p.x,p.y))result.push(p);
          }
          return {points:result,width:innerWidth,height:innerHeight};
        })()`);
        const bitmap = screenshot.toBitmap(), size = screenshot.getSize();
        const transparent = samples.points.filter(p => bitmap[(Math.floor(p.y * size.height / samples.height) * size.width + Math.floor(p.x * size.width / samples.width)) * 4 + 3] < 230).length;
        assert.ok(samples.points.length > 20, 'enough visible opaque tail samples');
        assert.ok(transparent / samples.points.length < .02, 'opaque tail has no transparent triangle seams');
        state.alphaAudit = { samples: samples.points.length, transparent };
        assert.equal(await ev(`(() => {const r=document.querySelector('.dshwv-tail-mesh').getBoundingClientRect();
          for(let y=Math.max(0,r.top);y<Math.min(innerHeight,r.bottom);y+=20)for(let x=Math.max(0,r.left);x<Math.min(innerWidth,r.right);x+=20)
            if(!WhaleCollapse.hit(x,y)&&!WhaleRendering.hitCache.hit(document.querySelector('.dshwv-img'),x,y,WhaleRendering.mirrorScale(document.querySelector('.dshwv-root'))<0))
              return __whaleInputTest.hit({x,y});return true;})()`), false, 'transparent mesh area remains click-through');
      }
      poses.push(state);
    }
    await sample('rest');
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    const distances = [2, 5, 12, 30, 70, 110];
    for (let i = 1; i <= distances.length; i++) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x + dx * distances[i - 1] / 110), y: Math.round(y + dy * distances[i - 1] / 110), modifiers: ['leftbuttondown'] });
      await delay(35); await sample('pull-' + i);
    }
    await sample('held');
    win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(x + dx), y: Math.round(y + dy), button: 'left', clickCount: 1 });
    const start = Date.now();
    for (const ms of [0, 50, 100, 180, 280, 420, 560, 760]) {
      await delay(Math.max(0, start + ms - Date.now())); await sample('release-' + ms);
    }
    const lastFrames = await ev('__whaleTailTest.state().frames');
    await delay(250);
    assert.equal(await ev('__whaleTailTest.state().active'), false);
    assert.equal(await ev('__whaleTailTest.state().frames'), lastFrames, 'no mesh frames while idle');
    const timings = await ev('__tailDrawTimes');
    fs.writeFileSync(path.join(folder, (mirror ? 'mirror' : 'normal') + '-draw-times.json'), JSON.stringify(timings));
    for (const [label, fx, fy] of [['left', -75, 0], ['right', 75, 0], ['up', 0, -75], ['down', 0, 75]]) {
      const p = await tailPoint(), px = Math.round(p.x), py = Math.round(p.y);
      win.webContents.sendInputEvent({ type: 'mouseDown', x: px, y: py, button: 'left', clickCount: 1 });
      await delay(30); await startPullProbe({ x: px, y: py });
      win.webContents.sendInputEvent({ type: 'mouseMove', x: px + fx, y: py + fy, modifiers: ['leftbuttondown'] });
      await delay(50); await checkPullDirection(fx, fy); await sample('direction-' + label);
      await ev("window.dispatchEvent(new Event('blur'))");
      win.webContents.sendInputEvent({ type: 'mouseUp', x: px + fx, y: py + fy, button: 'left', clickCount: 1 });
    }
  }
  fs.writeFileSync(path.join(folder, 'poses.json'), JSON.stringify(poses, null, 2));
  for (const side of ['left', 'right']) {
    await ev(`localStorage.setItem('dshw-pos',JSON.stringify({v:2,hAnchor:'${side}',hDist:0,vAnchor:'top',vDist:90}));`);
    await win.reload();
    await wait('window.__whaleTailTest && WhaleRendering.hitCache.stats.decodes>=2', 'audit side'); await delay(350);
    click(await tailPoint()); await wait('WhaleCollapse.collapsed && !WhaleCollapse.busy', 'audit side hide');
    await checkHiddenPull(side + '-mesh-audit');
  }
  checks.push('普通与镜像的拉直回弹、四向受力截图和关节数据已采集；透明网格接缝检查通过，静止后停止绘制，侧边拖尾仍连接边缘');
}
async function sourceAttachment() {
  return ev(`(() => {
    const img=document.querySelector('.dshwv-tail img'), b=img.parentElement.getBoundingClientRect(), s=getComputedStyle(img);
    const [ox,oy]=s.transformOrigin.split(' ').map(parseFloat), mirror=WhaleRendering.mirrorScale(document.querySelector('.dshwv-root'))<0?-1:1;
    const x=parseFloat(s.left)+ox;
    return {hinge:{x:mirror<0?b.right-x:b.left+x,y:b.top+parseFloat(s.top)+oy},
      portrait:document.querySelector('.dshwv-img').getBoundingClientRect().toJSON(),mirror};
  })()`);
}
async function captureMotion(name, attachment) {
  const folder = path.join(output, name); fs.mkdirSync(folder, { recursive: true });
  await ev(`(() => {
    const initial=${JSON.stringify(attachment)}, records=[];
    const stop=WhaleRendering.onFrame(()=>{
      const actors=[...document.querySelectorAll('.dshwv-collapse-actor')],tail=actors.find(e=>e.src.includes('dragon-maiden-tail-')),
        body=actors.find(e=>!e.src.includes('dragon-maiden-tail-'));
      if(!tail||!body)return;
      const ts=getComputedStyle(tail),bs=getComputedStyle(body),tm=new DOMMatrix(ts.transform),bm=new DOMMatrix(bs.transform);
      const to=ts.transformOrigin.split(' ').map(parseFloat),bo=bs.transformOrigin.split(' ').map(parseFloat);
      const local={x:initial.mirror<0?initial.portrait.right-initial.hinge.x:initial.hinge.x-initial.portrait.left,
        y:initial.hinge.y-initial.portrait.top};
      const expected=new DOMPoint(local.x-bo[0],local.y-bo[1]).matrixTransform(bm);
      expected.x+=parseFloat(bs.left)+bo[0];expected.y+=parseFloat(bs.top)+bo[1];
      const actual={x:parseFloat(ts.left)+to[0]+tm.e,y:parseFloat(ts.top)+to[1]+tm.f};
      const margin=parseFloat(ts.width)*1.3/768*84,edge=WhaleCollapse.edge;
      const outside=edge==='left'?actual.x<=-margin:edge==='right'?actual.x>=innerWidth+margin:actual.y>=innerHeight+margin;
      records.push({at:tail.getAnimations()[0]?.currentTime,gap:Math.hypot(actual.x-expected.x,actual.y-expected.y),outside,opacity:parseFloat(ts.opacity)});
    });
    window.__stopAttachmentAudit=()=>{stop();return records;};
  })()`);
  for (let i = 0; i < 28; i++) {
    const shot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(folder, String(i).padStart(4, '0') + '.png'), shot.toPNG());
    await delay(40);
  }
  await wait('!WhaleCollapse.busy', name + ' completion');
  const audit = await ev('__stopAttachmentAudit()');
  fs.writeFileSync(path.join(output, name + '-attachment.json'), JSON.stringify(audit, null, 2));
  assert.ok(audit.length >= 10, name + ': audit samples the moving actors');
  const visible = audit.filter(frame => frame.opacity > .1 && !frame.outside);
  assert.ok(visible.every(frame => frame.gap < 1), name + ': visible tail root must remain attached to the moving body: ' + JSON.stringify(visible.filter(f=>f.gap>=1)));
}
async function main() {
  const { makeFixture } = await import(pathToFileURL(path.join(root, 'tests/desktop-fixture.mjs')));
  const { createDispatcher } = await import(pathToFileURL(path.join(root, 'runtime/dispatcher.mjs')));
  const { acceptInteractionHook } = await import(pathToFileURL(path.join(root, 'runtime/interaction-notices.mjs')));
  const options = await makeFixture(dataDir);
  fs.writeFileSync(path.join(dataDir, '.dshw-size.json'), JSON.stringify({ scale: 1.5, vol: 0, bubbleOn: true }));
  dispatcher = createDispatcher({ dataDir, ...options });
  session.defaultSession.protocol.handle('whale', async request => {
    const url = new URL(request.url);
    const result = await dispatcher.dispatch(url.pathname + url.search, { method: request.method,
      body: ['GET', 'HEAD'].includes(request.method) ? null : Buffer.from(await request.arrayBuffer()) });
    return new Response(request.method === 'HEAD' ? null : result.body, { status: result.status, headers: result.headers });
  });
  win = new BrowserWindow({ width: 860, height: 650, show: false, frame: false, transparent: true,
    webPreferences: { backgroundThrottling: false, preload: path.join(root, 'desktop/preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, additionalArguments: ['--whale-render-test'] } });
  win.webContents.on('console-message', (_event, details) => { if (details.level === 'error') errors.push(details.message); });
  // Keep synthetic pointer coordinates independent of the user's real mouse.
  win.setIgnoreMouseEvents(true, { forward: false });
  await win.loadURL('whale://widget/widget.html'); win.show(); win.focus();
  await wait('window.WhaleCollapse && WhaleRendering.hitCache.stats.decodes >= 2 && window.__whaleRenderTest.status().scale === 1.5', 'character and tail masks');
  await delay(350);
  if (process.argv.includes('--tail-audit')) { await auditDeformation(); return; }
  assert.equal(await collapsed(), false);
  const position = await ev("localStorage.getItem('dshw-pos')");
  await ev(`window.__tailTrace=[];for(const name of ['pointerdown','pointerup','pointercancel','lostpointercapture','whale-tail-tug'])
    document.addEventListener(name,e=>__tailTrace.push({name,target:e.target.className,held:!!document.querySelector('.dshwv-tail-held'),status:__whaleRenderTest.status()}),true);
    window.addEventListener('whale-tail-tug',()=>__tailTrace.push({name:'tug',status:__whaleRenderTest.status()}));`);
  await ev("for(const name of ['blur','resize'])window.addEventListener(name,()=>__tailTrace.push({name,at:performance.now()}));");
  await ev("for(const name of ['pointermove','gotpointercapture','dragstart'])document.addEventListener(name,e=>__tailTrace.push({name,buttons:e.buttons,id:e.pointerId,target:e.target.className,held:!!document.querySelector('.dshwv-tail-held'),captured:document.querySelector('.dshwv-tail').hasPointerCapture(e.pointerId||1)}),true);");
  await dragTail();
  assert.equal(await ev('__whaleRenderTest.status().shown'), false, 'first pull is silent');
  await delay(450); await dragTail();
  await wait("__whaleRenderTest.status().scene === 'tail' && __whaleRenderTest.status().shown", 'exclusive tail dialogue');
  assert.equal(await collapsed(), false);
  assert.equal(await ev("localStorage.getItem('dshw-pos')"), position);
  await capture('tail-tug-dialogue');
  checks.push('展开时四向轻拉顺着受力方向、尾根固定，第一次安静、第二次显示专属台词，不改变角色位置');
  await dragTail();
  await wait("document.querySelector('.dshwv-pop').innerText.includes('还拽')", 'third pull objects while previous tail bubble is open');
  await ev('__whaleRenderTest.close()'); await delay(450);
  await dragTail(); await delay(100);
  assert.equal(await ev('__whaleRenderTest.status().shown'), false, 'further pulls during ignore period are silent');
  checks.push('第三次拉扯替换成更不满的台词，随后继续拉扯不回应');
  await wait('!__whaleTailTest.state().active', 'tail rebound settled');
  const portraitSource = await ev("document.querySelector('.dshwv-img').src");
  const portraitRect = await ev("document.querySelector('.dshwv-img').getBoundingClientRect().toJSON()");
  function sameRect(actual, expected, label) {
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(actual[key] - expected[key]) < .5, `${label} ${key}: ${actual[key]} vs ${expected[key]}`);
  }
  const bodyPoint = await ev(`(() => {const r=document.querySelector('.dshwv-img').getBoundingClientRect();for(let y=Math.ceil(r.top);y<r.top+r.height*.5;y+=2)for(let x=Math.ceil(r.left);x<r.right;x+=2)if(__whaleInputTest.hit({x,y}))return {x,y};})()`);
  await capture('expanded');
  click(await tailPoint()); await delay(150);
  await wait("WhaleCollapse.busy && document.querySelector('.dshwv-collapse-motion')?.naturalWidth === 384", 'H3 playback');
  const motionRect = await ev("document.querySelector('.dshwv-collapse-motion').getBoundingClientRect().toJSON()");
  sameRect(portraitRect, { x: motionRect.x + motionRect.width * 192 / 768, y: motionRect.y + motionRect.height * 192 / 768,
    width: motionRect.width * 576 / 768, height: motionRect.height * 576 / 768 }, 'portrait alignment');
  checks.push('静止半身与动画首帧的位置、比例一致');
  assert.equal(await ev(`__whaleInputTest.hit(${JSON.stringify(bodyPoint)})`), false);
  await delay(280); await capture('hide-back-motion');
  await wait('!WhaleCollapse.busy', 'motion completion'); await delay(70);
  assert.equal(await ev("!!document.querySelector('.dshwv-collapse-motion')"), false);
  assert.equal(await ev("document.querySelector('.dshwv-img').src"), portraitSource);
  checks.push('播放 H3 身体与受控尾巴透明动作，动作期间不拦截身体点击，结束清理播放层且保留原半身素材');
  assert.equal(await collapsed(), true);
  const tipRect = await ev("document.querySelector('.dshwv-tail').getBoundingClientRect().toJSON()");
  sameRect(tipRect, { x: motionRect.x + motionRect.width * 473 / 768, y: motionRect.y + motionRect.height * 689 / 768,
    width: motionRect.width * 79 / 768, height: motionRect.height * 79 / 768 }, 'tail tip alignment');
  checks.push('静止尾尖与动画末帧的位置、比例一致');
  assert.equal(await ev('WhaleCollapse.busy || !!document.querySelector(".dshwv-collapse-motion")'), false);
  assert.equal(await ev('document.querySelector(".dshwv-body").inert'), true);
  assert.equal(await ev(`__whaleInputTest.hit(${JSON.stringify(bodyPoint)})`), false);
  assert.equal(shapes.some(r => bodyPoint.x >= r.x && bodyPoint.x < r.x + r.width && bodyPoint.y >= r.y && bodyPoint.y < r.y + r.height), false);
  checks.push('尾尖单击收起；身体不接受输入，旧头部退出原生窗口区域');
  await capture('collapsed');
  await checkHiddenPull('bottom-pull');
  checks.push('隐藏尾巴向四个方向牵拉时，真实截图的尾巴像素始终连到窗口底边，没有悬空切口');
  const p = await tailPoint();
  assert.ok(!p.error, JSON.stringify(p));
  await ev("window.__tailClicks=[];document.addEventListener('click',e=>__tailClicks.push({target:e.target.className,hit:WhaleCollapse.hit(e.clientX,e.clientY),x:e.clientX,y:e.clientY}),true)");
  click(p); await delay(65);
  assert.equal(await collapsed(), true);
  assert.ok(await ev("document.querySelector('.dshwv-tail img').getAnimations().length > 0"), JSON.stringify(await ev("({clicks:__tailClicks,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches})")));
  await delay(500); assert.equal(await collapsed(), true);
  checks.push('单击尾巴产生有限摇晃，等待后仍保持收起');
  const transparent = await ev(`(() => {const r=document.querySelector('.dshwv-tail img').getBoundingClientRect();return {x:r.left+1,y:r.top+1};})()`);
  assert.equal(await ev(`__whaleInputTest.hit(${JSON.stringify(transparent)})`), false);
  checks.push('尾巴透明区域不接受输入');
  const hook = { hook_event_name: 'PreToolUse', session_id: 'collapse-thread', turn_id: 'turn', tool_name: 'request_user_input', tool_use_id: 'call' };
  acceptInteractionHook(dataDir, hook);
  acceptInteractionHook(dataDir, { ...hook, tool_name: 'exec_command', tool_use_id: 'approval-call', hook_event_name: 'PermissionRequest' });
  await delay(1200);
  assert.equal(await collapsed(), true);
  assert.equal(await ev("!!document.querySelector('.dshwv-pop-open')"), false);
  assert.equal(await ev("!!document.querySelector('.dshwv-tail-notice')"), false);
  assert.equal(await ev("document.querySelector('.dshwv-tail').hasAttribute('title')"), false);
  checks.push('隐藏后真实提问与授权不弹气泡、不显示提醒点或悬浮提示、不自动展开');
  acceptInteractionHook(dataDir, { ...hook, hook_event_name: 'PostToolUse' });
  acceptInteractionHook(dataDir, { ...hook, tool_name: 'exec_command', tool_use_id: 'approval-call', hook_event_name: 'PostToolUse' });
  await ev(`window.__whaleRenderTest.open(); __whaleRenderTest.cost({id:'hidden-cost',completionKind:'success',amount:1});
    __whaleRenderTest.scene([{type:'text',text:'hidden custom'}],1000); whaleToast('hidden toast'); window.dispatchEvent(new Event('whale-tail-tug'));`);
  await delay(250);
  assert.equal(await ev("!!document.querySelector('.dshwv-pop-open')"), false);
  assert.equal(await ev("document.querySelector('#toast').hidden"), true);
  checks.push('隐藏后额度、完成、自定义、尾巴台词和错误 Toast 均不显示');
  assert.equal(saved['dshw-collapsed'], 'true');
  await win.reload();
  await wait('window.WhaleCollapse && WhaleRendering.hitCache.stats.decodes >= 2', 'reload'); await delay(350);
  assert.equal(await collapsed(), true);
  checks.push('重载保留收起状态');
  const restore = await tailPoint();
  for (let i = 0; i < 3; i++) { click(restore, i + 1); await delay(75); }
  assert.equal(await collapsed(), true);
  click(restore, 4); await wait('!WhaleCollapse.busy', 'motion completion'); await delay(70);
  assert.equal(await collapsed(), false);
  assert.equal(await ev("localStorage.getItem('dshw-pos')"), position);
  checks.push('双击和三击不展开，1.2秒内第四次点击展开并保留原位置');
  click(await tailPoint()); await delay(150); await wait('!WhaleCollapse.busy', 'hide completion'); await delay(70); click(await tailPoint(), 2); await delay(50);
  assert.equal(await collapsed(), true);
  await delay(1300);
  const isolated = await tailPoint();
  for (let i = 0; i < 3; i++) { click(isolated, i + 1); await delay(75); }
  assert.equal(await collapsed(), true);
  await delay(1300);
  checks.push('收起点击不计入恢复次数，超出时间窗的旧点击不会累积');
  await dragTail(); await wait('!WhaleCollapse.collapsed && !WhaleCollapse.busy', 'drag restore');
  assert.equal(await ev('__whaleRenderTest.status().shown'), false, 'first pull wake is silent');
  await delay(450); await dragTail();
  await wait("__whaleRenderTest.status().scene === 'tail'", 'second pull after wake');
  await ev('__whaleRenderTest.close()'); await delay(350);
  assert.equal(await ev("localStorage.getItem('dshw-pos')"), position);
  checks.push('第一次拖尾巴唤醒保持安静，再拉才接专属短句，隐藏期间安静且保留原位置');
  click(await tailPoint()); await wait('WhaleCollapse.collapsed && !WhaleCollapse.busy', 'hide before cancellation');
  const cancelPoint = await tailPoint();
  win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(cancelPoint.x), y: Math.round(cancelPoint.y), button: 'left', clickCount: 1 });
  await ev("window.dispatchEvent(new Event('blur'))");
  win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(cancelPoint.x), y: Math.round(cancelPoint.y), button: 'left', clickCount: 1 });
  assert.equal(await collapsed(), true);
  assert.equal(await ev("!!document.querySelector('.dshwv-tail-held')"), false);
  checks.push('失焦取消未完成的尾巴手势，不误展开或留下拖拽状态');
  await ev("window.dispatchEvent(new Event('whale-reset-position'))"); await delay(150); await wait('!WhaleCollapse.busy', 'motion completion'); await delay(70);
  assert.equal(await collapsed(), false);
  checks.push('恢复位置命令可以找回完整角色');
  click(await tailPoint()); await wait('WhaleCollapse.busy', 'motion before reset');
  await ev("window.dispatchEvent(new Event('whale-reset-position'))");
  await delay(1300);
  assert.equal(await collapsed(), false);
  assert.equal(await ev('WhaleCollapse.busy || !!document.querySelector(".dshwv-collapse-motion")'), false);
  checks.push('动作中恢复位置会取消播放；旧加载和定时回调不会重新收起');
  const petPoint = await ev(`(() => {const img=document.querySelector('.dshwv-img'),root=document.querySelector('.dshwv-root'),r=img.getBoundingClientRect();for(let y=Math.ceil(r.top);y<r.top+r.height*.5;y+=2)for(let x=Math.ceil(r.left);x<r.right;x+=2)if(WhaleRendering.petInteraction.hit(img,root,x,y))return {x,y};})()`);
  click(petPoint); await wait('window.__whaleRenderTest.status().shown', 'body click after restore');
  await ev('window.__whaleRenderTest.close()'); await delay(400);
  const from = { x: Math.round(petPoint.x), y: Math.round(petPoint.y) };
  win.webContents.sendInputEvent({ type: 'mouseDown', ...from, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseMove', x: from.x - 40, y: from.y - 35 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: from.x - 40, y: from.y - 35, button: 'left', clickCount: 1 });
  await delay(400);
  assert.equal(await ev("document.querySelector('.dshwv-root').classList.contains('dshwv-dragging')"), false);
  const draggedPosition = await ev("localStorage.getItem('dshw-pos')");
  assert.ok(draggedPosition);
  click(await tailPoint()); await delay(150); await wait('!WhaleCollapse.busy', 'motion completion'); await delay(70);
  await restoreByClicks();
  assert.equal(await collapsed(), false);
  assert.equal(await ev("localStorage.getItem('dshw-pos')"), draggedPosition);
  checks.push('恢复后身体点击与拖动正常；拖动后再次收起展开保留位置');
  // Exercise the left-edge mirrored layout too.
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await ev("localStorage.setItem('dshw-pos',JSON.stringify({v:2,hAnchor:'left',hDist:0,vAnchor:'bottom',vDist:0}))");
  win.reload();
  await wait('window.WhaleCollapse && WhaleRendering.hitCache.stats.decodes >= 2 && window.__whaleRenderTest.status().flip', 'left mirror'); await delay(350);
  click(await tailPoint()); await delay(150); await wait('!WhaleCollapse.busy', 'motion completion'); await delay(70); assert.equal(await collapsed(), true);
  await capture('collapsed-left');
  await restoreByClicks();
  assert.equal(await collapsed(), false);
  await capture('expanded-left');
  await dragTail();
  await delay(450); await dragTail();
  await wait("__whaleRenderTest.status().scene === 'tail'", 'mirrored tail tug');
  await ev('__whaleRenderTest.close()'); await delay(450);
  checks.push('左侧镜像布局可收起、摇晃和连续四击恢复');
  for (const scale of [0.6, 2.5]) {
    await ev(`(() => {const slider=document.querySelector('input[type="range"][min="0.6"]');slider.value=${scale};slider.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await delay(350);
    click(await tailPoint()); await delay(150); await wait('!WhaleCollapse.busy', 'motion completion'); await delay(70); assert.equal(await collapsed(), true);
    await checkHiddenPull('scale-' + scale);
    await restoreByClicks();
    assert.equal(await collapsed(), false);
  }
  checks.push('最小与最大角色缩放均可点击尾尖及连续四击恢复');
  await ev('__whaleRenderTest.scale(1)'); await delay(350);
  for (const [side, hDist, vDist] of [['left', 0, 90], ['right', 0, 90], ['bottom', 300, 200]]) {
    const intent = { v: 2, hAnchor: side === 'right' ? 'right' : 'left', hDist, vAnchor: 'top', vDist };
    await ev('localStorage.setItem("dshw-pos",' + JSON.stringify(JSON.stringify(intent)) + ')');
    win.reload(); await wait('window.WhaleCollapse && __whaleRenderTest.status().scale === 1 && WhaleRendering.hitCache.stats.decodes >= 2', 'edge fixture');
    await delay(350);
    const before = await ev("document.querySelector('.dshwv-img').getBoundingClientRect().toJSON()");
    const attachment = await sourceAttachment();
    const savedPosition = await ev("localStorage.getItem('dshw-pos')");
    click(await tailPoint()); await wait('WhaleCollapse.busy && document.querySelector(".dshwv-collapse-actor")', 'edge hide');
    assert.equal(await ev('WhaleCollapse.edge'), side);
    await captureMotion(side + '-middle-hide', attachment);
    assert.equal(await collapsed(), true);
    if (side !== 'bottom') {
      const docked = await ev("document.querySelector('.dshwv-tail').getBoundingClientRect().toJSON()");
      assert.ok(Math.abs(docked.y + docked.height / 2 - before.y - before.height / 2) < docked.height,
        'docked tail must stay beside the original body, without jumping to its invisible translated bounds');
    }
    await checkHiddenPull(side + '-middle-pull');
    assert.equal(await ev("!!document.querySelector('.dshwv-pop-open')"), false);
    if (side === 'left') {
      win.reload(); await wait("window.WhaleCollapse?.collapsed && WhaleCollapse.edge === 'left' && WhaleRendering.hitCache.stats.decodes >= 2", 'left dock reload');
      await delay(300); await checkTailConnection('left-middle-reload');
    }
    const p = await tailPoint();
    for (let i = 0; i < 4; i++) { click(p, i + 1); await delay(65); }
    await wait('WhaleCollapse.busy', 'edge appear');
    assert.equal(await ev("!!document.querySelector('.dshwv-pop-open')"), false, 'response must wait until appearance finishes');
    await captureMotion(side + '-middle-appear', attachment);
    const after = await ev("document.querySelector('.dshwv-img').getBoundingClientRect().toJSON()");
    sameRect(after, before, side + ' restored portrait');
    assert.equal(await ev("localStorage.getItem('dshw-pos')"), savedPosition);
    await wait("__whaleRenderTest.status().scene === 'tail'", 'rapid wake dialogue');
    await ev('__whaleRenderTest.close()'); await delay(350);
    checks.push(side + ' 中部位置朝实际窗口边缘收起，四向拖尾无断口，展开后原位置与比例恢复，完成后才回应连点');
  }
  await ev("document.querySelector('.dshwv-tail').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
  await wait('WhaleCollapse.collapsed && !WhaleCollapse.busy', 'keyboard hide');
  await ev("document.querySelector('.dshwv-tail').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}))");
  await wait('!WhaleCollapse.collapsed && !WhaleCollapse.busy', 'keyboard appear');
  assert.equal(await collapsed(), false);
  checks.push('尾巴支持 Enter / 空格切换');
  await delay(500);
  assert.equal(await ev('document.querySelector(".dshwv-tail img").getAnimations().some(a=>a.playState==="running")'), false);
  assert.deepEqual(errors, []);
  checks.push('静止后无持续尾巴动画、renderer 无错误');
}
app.whenReady().then(main).catch(async error => {
  errors.push(error.stack || String(error));
  if (win) fs.writeFileSync(path.join(output, 'event-trace.json'), JSON.stringify(await ev('({trace:window.__tailTrace,status:window.__whaleRenderTest?.status(),collapsed:window.WhaleCollapse?.collapsed,busy:window.WhaleCollapse?.busy})'), null, 2));
  if (win) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
  process.exitCode = 1;
}).finally(async () => {
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ok: errors.length === 0, checks, errors,
    scope: '隔离 Electron、真实 preload、协议、renderer 与 Windows setShape；合成鼠标输入，不代表跨应用真实鼠标验收。' }, null, 2));
  if (dispatcher) await dispatcher.close();
  win?.destroy(); app.quit();
});
