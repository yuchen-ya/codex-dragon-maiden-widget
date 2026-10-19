import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { ConfigStore } from '../runtime/config.mjs';
import { WhaleService } from '../runtime/service.mjs';
import { ROOT } from '../runtime/paths.mjs';
import { verifyRendering } from './render-regression.mjs';
import { verifyCurrency } from './currency-regression.mjs';
import { verifyHostOcclusion } from './host-occlusion.mjs';
import { verifyAuditUI } from './audit-ui-regression.mjs';

const delay = ms => new Promise(r => setTimeout(r, ms));
export async function makeFixture(dataDir) {
  const codex = path.join(dataDir, 'fixture-codex'); fs.mkdirSync(codex, { recursive: true });
  fs.writeFileSync(path.join(codex, 'config.toml'), 'model_provider="fixture"\n[model_providers.fixture]\nbase_url="https://example.invalid/v1"\nexperimental_bearer_token="TEST-ONLY-NOT-A-KEY"\n');
  fs.writeFileSync(path.join(dataDir, '.dshw-size.json'), JSON.stringify({ scale: 1, sound: false, vol: 0, bubbleOn: true, turnCostOn: true }));
  const config = new ConfigStore({ dataDir, codexHome: codex, env: {} });
  const provider = { amount: 12.3456, currency: 'USD', fail: false, delay: 0, async balance(c) {
    if (this.delay) await delay(this.delay);
    if (this.fail) throw new Error('Fixture refresh failure');
    return { ok: true, totalBalance: this.amount, currency: this.currency, providerName: '桌面交互测试', accountId: c.accountId, updatedAt: new Date().toISOString() };
  } };
  const service = new WhaleService({ config, provider });
  return { service, monitor: false, autoRefresh: false, fxFetchImpl: async () => new Response(JSON.stringify({ amount: 1, base: 'USD', date: '2026-09-15', rates: { CNY: 6.7115 } }), { headers: { 'Content-Type': 'application/json' } }) };
}

export async function verifyDesktop({ app, window, screen, setHost, setTestCursor, dispatcher, dataDir, errors, renderInfo }) {
  const output = path.resolve(process.env.WHALE_DESKTOP_VERIFY_DIR);
  fs.mkdirSync(output, { recursive: true });
  const checks = [], inputTrace = [], ev = code => window.webContents.executeJavaScript(code);
  // Synthetic renderer input must not be mixed with the user's physical mouse.
  // Native hit/occlusion checks below restore the real OS input flags explicitly.
  const nativeIgnore = window.setIgnoreMouseEvents.bind(window);
  let nativePhase = false;
  window.setIgnoreMouseEvents = (ignored, options) => nativeIgnore(nativePhase ? ignored : true, nativePhase ? options : { forward:false });
  nativeIgnore(true, { forward:false });
  const wait = async (code, label, timeout = 6000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (await ev(code)) return; await delay(80); }
    throw new Error('Timed out: ' + label);
  };
  const move = (x, y) => { setTestCursor({ x, y }); window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) }); };
  const clickAt = async p => { window.focus(); await wait('document.hasFocus()', 'synthetic click fixture focus'); move(p.x, p.y); await delay(100); inputTrace.push(await ev(`(() => {const e=document.elementFromPoint(${Math.round(p.x)},${Math.round(p.y)});return {x:${Math.round(p.x)},y:${Math.round(p.y)},tag:e?.tagName,cls:e?.className,text:e?.textContent?.slice(0,70)}})()`)); window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: Math.round(p.x), y: Math.round(p.y) }); await delay(45); window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: Math.round(p.x), y: Math.round(p.y) }); await delay(220); };
  const hitPoint = () => ev(`(() => {
    const img = document.querySelector('.dshwv-img'), r = img.getBoundingClientRect();
    const c = document.createElement('canvas'); c.width = c.height = 610; const ctx = c.getContext('2d'); ctx.drawImage(img,0,0,610,610);
    const a = ctx.getImageData(0,0,610,610).data; let chosen = null, distance = Infinity;
    for (let y=10;y<600;y+=5) for(let x=10;x<600;x+=5) if(a[(y*610+x)*4+3]>230) { const d=(x-305)**2+(y-305)**2; if(d<distance){distance=d;chosen={x,y};} }
    const flip = WhaleRendering.mirrorScale(document.querySelector('.dshwv-root')) < 0;
    return {x:r.x+(flip?610-chosen.x:chosen.x)*r.width/610,y:r.y+chosen.y*r.height/610};
  })()`);
  const clickSelector = async selector => clickAt(await ev(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('missing element');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`));
  try {
    const area = screen.getPrimaryDisplay().workArea;
    const dip = { x: area.x + 30, y: area.y + 30, width: Math.min(1060, area.width - 60), height: Math.min(760, area.height - 60) };
    const host = { hostAlive: true, hostPid: 123456, window: '0', visible: true, attached: true, bounds: screen.dipToScreenRect(null, dip) };
    await setHost(host); window.setAlwaysOnTop(true, 'normal');
    await wait("document.querySelector('.dshwv-img')?.complete && document.querySelector('.dshwv-img').naturalWidth > 0", 'image load');
    await wait("window.__whaleRenderTest?.status().balance === 12.3456 && window.__whaleRenderTest.status().hitCache.decodes > 0", 'balance and alpha cache');
    await delay(500);
    // sendInputEvent requires a focused fixture window. The later independent
    // host test covers actual Windows activation on the first native click.
    window.focus(); await wait('document.hasFocus()', 'fixture focused for synthetic mouse input');
    await ev(`(() => {
      window.__fixturePointerLog=[];
      for(const name of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture','blur']) document.addEventListener(name,e=>{
        const root=document.querySelector('.dshwv-root'),img=document.querySelector('.dshwv-img');
        if(name==='pointermove'&&!root.classList.contains('dshwv-dragging'))return;
        const info=()=>({type:e.type,x:e.clientX,y:e.clientY,buttons:e.buttons,pointerId:e.pointerId,target:e.target?.tagName,targetClass:String(e.target?.className||''),cancelBubble:e.cancelBubble,defaultPrevented:e.defaultPrevented,focus:document.hasFocus(),captured:e.pointerId!==undefined&&root.hasPointerCapture(e.pointerId),hit:WhaleRendering.hitCache.hit(img,e.clientX,e.clientY,WhaleRendering.mirrorScale(root)<0),image:img.getBoundingClientRect().toJSON(),bodyTransform:document.querySelector('.dshwv-body').style.transform,scale:WhaleRendering.mirrorScale(root),dragging:root.classList.contains('dshwv-dragging'),status:window.__whaleRenderTest.status()});
        window.__fixturePointerLog.push(info());
        if(name==='pointerdown'||name==='pointerup')queueMicrotask(()=>window.__fixturePointerLog.push({...info(),type:'after-'+name}));
      },true);
      window.addEventListener('blur',()=>window.__fixturePointerLog.push({type:'window-blur',status:window.__whaleRenderTest.status()}));
      window.addEventListener('error',e=>window.__fixturePointerLog.push({type:'error',message:e.message,stack:e.error?.stack}));
    })()`);
    assert.equal(window.isVisible(), true); assert.equal(window.webContents.getURL(), 'whale://widget/widget.html'); checks.push('local protocol and visible transparent window');
    if (process.env.WHALE_COMPLETE_UI_ONLY === '1') {
      checks.push(...(await verifyAuditUI({ window, ev, wait, clickAt, hitPoint, move, dispatcher, output, dataDir })).checks);
      assert.equal((errors || []).length, 0, JSON.stringify(errors));
      fs.writeFileSync(path.join(output, 'desktop-follow.json'), JSON.stringify({ ok: true, checks, errors, dataDir, auditUiOnly: true }, null, 2));
      await setHost({ hostAlive: false }); return;
    }
    if (process.env.WHALE_HOST_ONLY === '1') {
      window.setIgnoreMouseEvents = nativeIgnore; nativeIgnore(!renderInfo().inputEnabled, {forward:true});
      checks.push(...(await verifyHostOcclusion({ window, ev, wait, clickAt, hitPoint, move, dispatcher, output, dataDir, setHost, setTestCursor, host, renderInfo })).checks);
      fs.writeFileSync(path.join(output, 'desktop-follow.json'), JSON.stringify({ ok: true, checks, errors, dataDir, rendering: renderInfo(), hostOnly: true }, null, 2));
      await setHost({ hostAlive: false }); return;
    }
    if (process.env.WHALE_RENDER_GRAPHICS_ONLY === '1') {
      const rendering = await verifyRendering({ window, ev, wait, clickAt, hitPoint, move, dispatcher, output, renderInfo, graphicsOnly: true });
      assert.equal((errors || []).length, 0, JSON.stringify(errors));
      fs.writeFileSync(path.join(output, 'desktop-follow.json'), JSON.stringify({ ok: true, checks: rendering.checks, errors, dataDir, rendering: renderInfo(), graphicsOnly: true }, null, 2));
      await setHost({ hostAlive: false }); return;
    }
    assert.equal(await ev("document.querySelectorAll('.dshwv-root').length"), 1);
    let point = await hitPoint();
    await clickAt(point);
    await wait("!window.__whaleRenderTest.status().switching && document.querySelector('.dshwv-pop-open')", 'first complete bubble');
    const bubble = await ev("document.querySelector('.dshwv-pop').innerText");
    assert.match(bubble, /12\.35/); assert.doesNotMatch(bubble, /12\.3456|峰谷|高峰|倒计时/); checks.push('click produces balance bubble with two decimal amounts');
    for (let retry = 0; retry < 3; retry++) {
      await ev('window.__whaleRenderTest.close()');
      await wait('!window.__whaleRenderTest.status().shown&&!window.__whaleRenderTest.status().switching', 'bubble closed before repeated first click');
      window.focus(); await wait('document.hasFocus()', 'repeated click has fixture focus');
      await clickAt(await hitPoint());
      await wait('window.__whaleRenderTest.status().shown&&!window.__whaleRenderTest.status().switching', 'repeated first click opens bubble');
    }
    checks.push('three additional first-click sequences succeed with focused synthetic input and unchanged click assertions');
    const original = await ev("document.querySelector('.dshwv-root').getBoundingClientRect().toJSON()");
    point = await hitPoint(); move(point.x, point.y);
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: Math.round(point.x), y: Math.round(point.y) });
    for (let i=1;i<=8;i++) { move(point.x-i*20, point.y-i*13); await delay(35); }
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: Math.round(point.x-160), y: Math.round(point.y-104) });
    await delay(500);
    const dragged = await ev("document.querySelector('.dshwv-root').getBoundingClientRect().toJSON()");
    assert.ok(Math.abs(dragged.x-original.x)>90, 'actual mouse drag changes position');
    const position = await ev("localStorage.getItem('dshw-pos')"); assert.ok(position); checks.push('pointer drag and persistent position');
    point = await hitPoint(); move(point.x, point.y); await delay(120); await clickSelector('.dshwv-menu-btn');
    await wait("document.querySelector('.dshwv-menu').checkVisibility({opacityProperty:true})", 'menu open');
    const menu = await ev("document.querySelector('.dshwv-menu').innerText");
    for (const label of ['角色', '音效', '自定义泡泡', '资源管理', 'API 设置']) assert.ok(menu.includes(label), label);
    assert.doesNotMatch(menu, /峰谷|高峰|倒计时/); checks.push('clickable menu retains original management controls');
    const settings = await ev("(() => {const b=[...document.querySelectorAll('.dshwv-menu button')].find(e=>e.textContent.trim()==='API 设置');const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
    await clickAt(settings); await wait("document.querySelector('#settings-dialog').open", 'API dialog');
    assert.equal(await ev("document.querySelectorAll('[name*=peak],[name*=Peak]').length"), 0); checks.push('settings open inside widget with schedule controls removed');
    await clickSelector('#cancel-settings');
    point = await hitPoint(); move(point.x, point.y); await delay(150);
    if (!(await ev("document.querySelector('.dshwv-menu').checkVisibility({opacityProperty:true})"))) await clickSelector('.dshwv-menu-btn');
    const buttonByText = async (text, scope = 'document') => clickAt(await ev(`(() => {const scope=${scope};const b=[...scope.querySelectorAll('button, .dshwv-bubchip')].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.checkVisibility({opacityProperty:true}));if(!b)throw new Error('missing visible control: '+${JSON.stringify(text)});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`));
    await buttonByText('自定义泡泡');
    await wait("[...document.querySelectorAll('.dshwv-bubmask')].some(e=>e.checkVisibility({opacityProperty:true}))", 'bubble editor');
    await buttonByText('首次点击 · 编辑内容');
    const currentMask = "[...document.querySelectorAll('.dshwv-bubmask')].filter(e=>e.checkVisibility({opacityProperty:true})).at(-1)";
    const editor = await ev(`(${currentMask}).innerText`);
    assert.match(editor, /可选模块/); assert.doesNotMatch(editor, /峰谷|时段倒计时|高峰/);
    const dismissFixtureConfirm = async () => {
      const visibleConfirm = "[...document.querySelectorAll('.dshwv-confirmmask')].filter(e=>e.checkVisibility({opacityProperty:true})).at(-1)";
      if (await ev(`!!(${visibleConfirm})`)) await buttonByText('确定', visibleConfirm);
    };
    await buttonByText('取消', currentMask); await dismissFixtureConfirm();
    await buttonByText('取消', currentMask); await dismissFixtureConfirm();
    checks.push('bubble module editor works with retired options removed');
    point = await hitPoint(); move(point.x,point.y); await delay(100);
    if (!(await ev("document.querySelector('.dshwv-menu').checkVisibility({opacityProperty:true})"))) await clickSelector('.dshwv-menu-btn');
    await buttonByText('管理', "document.querySelector('.dshwv-menu')");
    await wait("[...document.querySelectorAll('.dshwv-resmask')].some(e=>e.checkVisibility({opacityProperty:true}))", 'resource manager');
    const resClose = await ev("(() => {const e=[...document.querySelectorAll('.dshwv-resclose')].find(e=>e.checkVisibility({opacityProperty:true}));const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()");
    await clickAt(resClose); checks.push('resource manager opens and closes through actual controls');
    move(15, 15); await delay(120); // Collapse hover-only affordances before native hit testing.
    const ps = process.env.WHALE_TEST_POWERSHELL;
    if (ps) {
      const nativeHit = async p => {
        // The user can change foreground apps while this isolated fixture runs.
        // Re-establish its focus before supplying the synthetic cursor; blur
        // intentionally clears hover and is not a native hit-test failure.
        window.focus(); await wait('document.hasFocus()', 'native hit fixture focus');
        const dipPoint = screen.screenToDipPoint(p), bounds = window.getContentBounds();
        setTestCursor({ x: dipPoint.x - bounds.x, y: dipPoint.y - bounds.y }); await delay(180);
        nativePhase = true; nativeIgnore(!renderInfo().inputEnabled, {forward:true});
        const result = await promisify(execFile)(ps, ['-NoProfile', '-NonInteractive', '-File', path.join(ROOT, 'desktop', 'supervisor.ps1'), '-Hit', '-X', String(Math.round(p.x)), '-Y', String(Math.round(p.y))], { windowsHide: true, timeout: 10000 });
        nativePhase = false; nativeIgnore(true, {forward:false});
        return JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
      };
      // Close any open whale menu before checking transparent regions.
      // The expanded settings menu may cover the pet's center. Close it through
      // its own control instead of accidentally clicking a setting at that point.
      await ev("if(document.querySelector('.dshwv-menu').checkVisibility({opacityProperty:true}))document.querySelector('.dshwv-menu-btn').click()");
      await wait("!document.querySelector('.dshwv-menu').checkVisibility({opacityProperty:true})", 'menu closed before native hit test');
      assert.equal(await ev("!!document.querySelector('dialog[open]')"), false, 'no modal overlays the transparent hit-test area');
      point = await hitPoint(); await delay(300);
      const bounds = window.getBounds();
      const solid = await nativeHit(screen.dipToScreenPoint({ x: bounds.x+point.x, y: bounds.y+point.y }));
      const empty = await nativeHit(screen.dipToScreenPoint({ x: bounds.x+8, y: bounds.y+8 }));
      const expectedHandle = window.getNativeWindowHandle().readBigUInt64LE().toString();
      fs.writeFileSync(path.join(output, 'native-hit.json'), JSON.stringify({ solid, empty, point, bounds, expectedHandle, physicalPoint: screen.dipToScreenPoint({x:bounds.x+point.x,y:bounds.y+point.y}) }, null, 2));
      assert.equal(solid.rootWindow, expectedHandle); assert.notEqual(empty.rootWindow, expectedHandle); checks.push('Windows hit testing: pet receives clicks, transparent area passes through');
    }
    await setHost({ ...host, visible: false }); assert.equal(window.isVisible(), false);
    const moved = { ...dip, x: dip.x+25, y: dip.y+15, width: dip.width-80, height: dip.height-40 };
    const physicalMoved = screen.dipToScreenRect(null, moved);
    await setHost({ ...host, bounds: physicalMoved }); await delay(300);
    assert.equal(window.isVisible(), true);
    const actual = window.getBounds(), expected = screen.screenToDipRect(null, physicalMoved);
    for (const key of ['x','y','width','height']) assert.ok(Math.abs(actual[key]-expected[key]) <= 1, key + ' follows host within native DIP rounding');
    checks.push('host move, resize, minimize and restore');
    fs.writeFileSync(path.join(output, 'pointer-input-trace.json'), JSON.stringify(await ev('window.__fixturePointerLog'), null, 2));
    const loaded = once(window.webContents, 'did-finish-load'); window.webContents.reload(); await loaded;
    await wait("document.querySelector('.dshwv-img')?.complete && document.querySelector('.dshwv-img').naturalWidth > 0", 'reload'); await delay(400);
    assert.equal(await ev("localStorage.getItem('dshw-pos')"), position); checks.push('position survives renderer restart');
    fs.writeFileSync(path.join(output, 'desktop-follow.png'), (await window.webContents.capturePage()).toPNG());
    const rendering = await verifyRendering({ window, ev, wait, clickAt, hitPoint, move, dispatcher, output, renderInfo });
    checks.push(...rendering.checks);
    checks.push(...(await verifyCurrency({ window, ev, wait, clickAt, hitPoint, move, dispatcher, output })).checks);
    checks.push(...(await verifyAuditUI({ window, ev, wait, clickAt, hitPoint, move, dispatcher, output, dataDir })).checks);
    window.setIgnoreMouseEvents = nativeIgnore;
    nativeIgnore(!renderInfo().inputEnabled, {forward:true});
    checks.push(...(await verifyHostOcclusion({ window, ev, wait, clickAt, hitPoint, move, dispatcher, output, dataDir, setHost, setTestCursor, host, renderInfo })).checks);
    assert.equal((errors || []).length, 0, JSON.stringify(errors));
    fs.writeFileSync(path.join(output, 'desktop-follow.json'), JSON.stringify({ ok: true, checks, errors, dataDir, rendering: renderInfo(), screenshot: path.join(output, 'desktop-follow.png') }, null, 2));
    await setHost({ hostAlive: false });
  } catch (error) {
    try { fs.writeFileSync(path.join(output, 'desktop-failure.png'), (await window.webContents.capturePage()).toPNG()); } catch {}
    const diagnostic = await ev(`({events:window.__fixturePointerLog,status:window.__whaleRenderTest?.status(),money:WhaleMoney.state(),root:document.querySelector('.dshwv-root').getBoundingClientRect().toJSON(),img:document.querySelector('.dshwv-img').getBoundingClientRect().toJSON()})`).catch(() => null);
    fs.writeFileSync(path.join(output, 'desktop-follow.json'), JSON.stringify({ ok: false, checks, error: error.stack, inputTrace, errors, dataDir, diagnostic, rendering:renderInfo() }, null, 2)); app.exit(1);
  }
}
