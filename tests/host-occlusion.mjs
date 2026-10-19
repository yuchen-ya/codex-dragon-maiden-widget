import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import readline from 'node:readline';
import net from 'node:net';
import { once } from 'node:events';
import { ROOT } from '../runtime/paths.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function verifyHostOcclusion({ window, ev, wait, clickAt, hitPoint, move, dispatcher, output, dataDir, setHost, setTestCursor, host, renderInfo }) {
  const { BrowserWindow, screen } = await import('electron');
  const checks = [], details = {}, env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // This is a GUI-subsystem fixture whose window must actually be visible.
  // STARTF_USESHOWWINDOW/SW_HIDE can suppress its first ShowWindow call.
  const child = spawn(process.execPath, [path.join(ROOT, 'tests', 'occlusion-host.cjs'), '--fixture-dir=' + dataDir], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false });
  const responses = new Map(); let id = 0, diagnostics = '', control;
  child.stderr.on('data', value => { diagnostics += value; });
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const timer = setTimeout(() => readyReject(new Error('Independent host startup timed out: ' + diagnostics.slice(-800))), 20000);
  readline.createInterface({ input: child.stdout }).on('line', line => {
    try { const value = JSON.parse(line); if (value.startupError) readyReject(new Error(value.startupError)); else if (value.ready) readyResolve(value); else if (responses.has(value.id)) { responses.get(value.id)(value); responses.delete(value.id); } } catch {}
  });
  const request = command => new Promise((resolve, reject) => {
    if (!control || control.destroyed) { reject(new Error('Host control is not connected')); return; }
    const serial = ++id;
    const timeout = setTimeout(() => { responses.delete(serial); reject(new Error('Host command timed out: ' + command)); }, 4000);
    responses.set(serial, value => { clearTimeout(timeout); resolve(value); });
    control.write(JSON.stringify({ id: serial, command }) + '\n');
  });
  const probe = async (handle = window.getNativeWindowHandle().readBigUInt64LE().toString()) => {
    const result = await promisify(execFile)(process.env.WHALE_TEST_PYTHON || 'python', [path.join(ROOT, 'tests', 'window-probe.py'), handle], { windowsHide: true, timeout: 10000 });
    return JSON.parse(result.stdout);
  };
  const attach = async (owner = '0', ownerPid = 0) => promisify(execFile)(process.env.WHALE_TEST_PYTHON || 'python', [path.join(ROOT, 'tests', 'fixture-owner.py'), window.getNativeWindowHandle().readBigUInt64LE().toString(), String(process.pid), owner, String(ownerPid)], { windowsHide: true, timeout: 10000 });
  async function continuous(label) {
    const before = await request('snapshot'); await delay(1200); const after = await request('snapshot');
    const frames = after.frames - before.frames;
    const maxGap = Math.max(...after.gaps.slice(-Math.min(frames, 100)));
    const result = { frames, maxGapMs: maxGap, hidden: after.hidden, reportAgeMs: Date.now() - after.reportedAt };
    details[label] = result;
    assert.ok(frames >= 20 && maxGap < 300 && result.reportAgeMs < 300, label + ': host keeps painting without another click: ' + JSON.stringify(result));
    assert.equal(after.hidden, false);
  }
  let cover;
  try {
    const fixture = await ready; clearTimeout(timer); details.host = fixture;
    control = net.createConnection(fixture.controlPipe); await once(control, 'connect');
    readline.createInterface({ input: control }).on('line', line => {
      const value = JSON.parse(line);
      if (responses.has(value.id)) { responses.get(value.id)(value); responses.delete(value.id); }
    });
    assert.notEqual(fixture.pid, process.pid); assert.equal(fixture.defaultBackgroundThrottling, true);
    await setHost({ hostAlive: true, hostPid: fixture.pid, window: fixture.handle, visible: true, attached: true, bounds: fixture.bounds });
    await attach(fixture.handle, fixture.pid); window.moveTop();
    if (process.env.WHALE_NATIVE_FOLLOW_ONLY !== '1') {
    await ev("window.__whaleRenderTest.close(); window.__whaleRenderTest.scale(1.2); window.__whaleRenderTest.place(120,80,false)");
    await delay(650); await request('focus');
    await continuous('beforeClick');
    const { screen } = await import('electron');
    const hostInput = (await request('snapshot')).inputRect;
    const hostDip = screen.screenToDipRect(null, fixture.bounds);
    const hostPoint = screen.dipToScreenPoint({ x: hostDip.x + hostInput.left + 12, y: hostDip.y + hostInput.top + hostInput.height / 2 });
    if(process.env.WHALE_CURSOR_ROUTING_TEST==='1'){
      setTestCursor(null);
      const sample=async()=>{
        const result=await promisify(execFile)(process.env.WHALE_TEST_PYTHON||'python',[path.join(ROOT,'tests','cursor-routing.py'),fixture.handle,String(fixture.pid),String(Math.round(hostPoint.x)),String(Math.round(hostPoint.y))],{windowsHide:true,timeout:10000});return JSON.parse(result.stdout);
      };
      window.setIgnoreMouseEvents(true,{forward:true});await delay(100);details.forwardedCursor=await sample();
      window.setIgnoreMouseEvents(true,{forward:false});await delay(100);details.unforwardedCursor=await sample();
      fs.writeFileSync(path.join(output,'cursor-routing.json'),JSON.stringify(details,null,2));
      assert.equal(details.unforwardedCursor.counts.arrow,0,'host I-beam must not be replaced by the ignored overlay');
      assert.ok(details.unforwardedCursor.counts.ibeam>300,'native cursor stays an I-beam while moving within host input');
      checks.push('real Windows cursor sampling keeps host text cursor stable without forwarded mouse moves');
    }
    details.hostNative = await probe(fixture.handle);
    move(5, 5); await delay(120);
    await promisify(execFile)(process.env.WHALE_TEST_PYTHON || 'python', [path.join(ROOT, 'tests', 'native-click.py'), fixture.handle, String(fixture.pid), String(Math.round(hostPoint.x)), String(Math.round(hostPoint.y))], { windowsHide: true, timeout: 10000 });
    dispatcher.whale.provider.delay = 2200;
    // Real native injection must use the real cursor. A pinned synthetic cursor
    // races the OS cursor restored by native-click.py and falsely toggles input.
    const point = await hitPoint();
    setTestCursor?.(null);
    details.beforeNative = { point, inputEnabled: renderInfo().inputEnabled, flags: await probe(), hit: await ev(`WhaleRendering.hitCache.hit(document.querySelector('.dshwv-img'),${point.x},${point.y},WhaleRendering.mirrorScale(document.querySelector('.dshwv-root'))<0)`) };
    // native-click.py moves the real pointer, waits for hover, and refuses to
    // click unless WindowFromPoint identifies this exact fixture HWND/PID.
    const bounds = window.getContentBounds();
    await ev("window.__nativeTrace=[];for(const n of ['pointerdown','pointerup','pointermove','blur','focus','gotpointercapture','lostpointercapture'])window.addEventListener(n,e=>window.__nativeTrace.push({type:e.type,x:e.clientX,y:e.clientY,buttons:e.buttons,focus:document.hasFocus(),drag:document.querySelector('.dshwv-root').classList.contains('dshwv-dragging')}),true)");
    const physical = screen.dipToScreenPoint({ x: bounds.x + point.x, y: bounds.y + point.y });
    const actualClick = await promisify(execFile)(process.env.WHALE_TEST_PYTHON || 'python', [path.join(ROOT, 'tests', 'native-click.py'), window.getNativeWindowHandle().readBigUInt64LE().toString(), String(process.pid), String(Math.round(physical.x)), String(Math.round(physical.y))], { windowsHide: true, timeout: 10000 });
    details.nativeClick = JSON.parse(actualClick.stdout);
    await wait('window.__whaleRenderTest.status().shown', 'native Windows click opens bubble');
    assert.equal(await ev('window.__whaleRenderTest.status().busy'), true, 'network wait overlaps the visual test');
    const clicked = await probe(); details.clicked = clicked;
    assert.equal(clicked.toolWindow, true); assert.equal(clicked.noActivate, false); assert.equal(clicked.appWindow, false);
    await continuous('bubbleVisible');
    checks.push('first native whale click works and the independent host keeps painting while an API request is pending');
    dispatcher.whale.provider.delay = 0;
    await ev("window.__whaleRenderTest.close(); document.querySelector('.dshwv-menu-btn').click()");
    await wait('window.whaleDesktop && document.querySelector(".dshwv-menu").checkVisibility({opacityProperty:true})', 'menu accepts keyboard focus');
    await delay(220);
    const editing = await probe(); details.editing = editing;
    assert.equal(editing.toolWindow, true); assert.equal(editing.noActivate, false); assert.equal(editing.appWindow, false);
    await continuous('menuVisible');
    checks.push('menu enables keyboard focus while retaining TOOLWINDOW and keeping the host renderer active');
    await ev("document.querySelector('.dshwv-menu-btn').click()"); await delay(300); move(5, 5);
    const closed = await probe(); details.closed = closed;
    assert.equal(closed.toolWindow, true); assert.equal(closed.appWindow, false); assert.equal(renderInfo().keyboardFocus, false);
    // Record an opaque control as well. Electron embedder/driver configurations
    // differ in whether native occlusion stops rAF; don't misreport that as a
    // reproduction of the user's Codex freeze if this host keeps scheduling.
    const [hx, hy, hw, hh] = details.hostNative.bounds;
    const coverBounds = screen.screenToDipRect(null, { x: hx - 16, y: hy - 16, width: hw + 32, height: hh + 32 });
    cover = new BrowserWindow({ ...coverBounds, frame: false, thickFrame: false, show: false, backgroundColor: '#dbe6ef', focusable: false, skipTaskbar: true, webPreferences: { sandbox: true } });
    await cover.loadURL('about:blank');
    cover.showInactive(); cover.setAlwaysOnTop(true); cover.moveTop(); await delay(800);
    details.coverNative = await probe(cover.getNativeWindowHandle().readBigUInt64LE().toString());
    assert.equal(details.coverNative.visible, true); assert.equal(details.coverNative.toolWindow, false);
    const beforeCover = await request('snapshot'); await delay(1100); const afterCover = await request('snapshot');
    details.opaqueControl = { frames: afterCover.frames - beforeCover.frames, beforeCover: beforeCover.frames, afterCover: afterCover.frames };
    details.nativeOcclusionPauseReproduced = details.opaqueControl.frames < 8;
    if (!details.nativeOcclusionPauseReproduced) details.limit = 'The isolated Electron host continues rAF beneath the opaque control. Native TOOLWINDOW, first-click delivery and host liveness are verified; the original Codex freeze is not reproduced by this fixture.';
    cover.destroy(); cover = null;
    await delay(700); await continuous('afterCoverRemoved');
    checks.push('host remains responsive after menu close and opaque-control removal');
    // Input emulation runs after the occlusion measurements, so attaching a
    // debugger cannot affect their scheduling. It targets only this fixture.
    move(5,5); await delay(120);
    await request('focus'); await delay(120); setTestCursor?.(null);
    await promisify(execFile)(process.env.WHALE_TEST_PYTHON || 'python', [path.join(ROOT, 'tests', 'native-click.py'), fixture.handle, String(fixture.pid), String(Math.round(hostPoint.x)), String(Math.round(hostPoint.y))], { windowsHide: true, timeout: 10000 });
    const typed = await request('type'); details.input = { ...typed.observed, focusEmulation: true };
    assert.equal(typed.observed.active, 'editor'); assert.equal(typed.observed.value, 'fixture-input-ok');
    checks.push('native click reaches the isolated host input and scoped text emulation updates the focused editor');
    }
    if (process.env.WHALE_TEST_POWERSHELL) {
      const nativeHost = { hostAlive: true, hostPid: fixture.pid, window: fixture.handle, visible: true, attached: true, nativeFollowing: true, bounds: fixture.bounds, dpi: screen.getDisplayMatching(window.getBounds()).scaleFactor * 96, serial: 0 };
      // Keep delivering deliberately stale geometry during real native moves.
      // It must be ignored while the native message pump owns the bounds.
      const stale = setInterval(() => setHost(nativeHost), 40);
      let serial = 0, sizing = false;
      details.sizeTrace = [];
      const sizes = setInterval(async () => {
        if (sizing) return; sizing = true;
        try { const latest = await request('bounds'); await setHost({ ...nativeHost, bounds: latest.bounds, serial: ++serial }); details.sizeTrace.push({ serial, requested: latest.bounds, actual: window.getBounds() }); } catch (error) { details.sizeTrace.push({ error: error.message }); } finally { sizing = false; }
      }, 100);
      try {
        const follow = await promisify(execFile)(process.env.WHALE_TEST_POWERSHELL, ['-NoProfile', '-NonInteractive', '-File', path.join(ROOT, 'tests', 'native-follow.ps1'),
          '-Overlay', window.getNativeWindowHandle().readBigUInt64LE().toString(), '-OverlayPid', String(process.pid), '-FixtureHost', fixture.handle, '-FixturePid', String(fixture.pid)], { windowsHide: true, timeout: 20000 });
        details.nativeFollow = JSON.parse(follow.stdout.replace(/^\uFEFF/, '').trim());
        assert.equal(details.nativeFollow.ok, true);
        fs.writeFileSync(path.join(output, 'native-follow.json'), JSON.stringify(details.nativeFollow, null, 2));
        checks.push('native follower moves and resizes through 72 positions without stealing focus or accepting stale IPC bounds');
      } finally { clearInterval(stale); clearInterval(sizes); }
    }
    fs.writeFileSync(path.join(output, 'host-occlusion.json'), JSON.stringify({ ok: true, checks, details }, null, 2));
    return { checks };
  } catch (error) {
    details.inputTrace = await ev('window.__nativeTrace || []').catch(() => []);
    fs.writeFileSync(path.join(output, 'host-process.log'), diagnostics);
    fs.writeFileSync(path.join(output, 'host-occlusion.json'), JSON.stringify({ ok: false, checks, details, error: error.stack }, null, 2));
    throw error;
  } finally {
    clearTimeout(timer); cover?.destroy(); dispatcher.whale.provider.delay = 0;
    await attach().catch(() => {});
    await request('close').catch(() => {});
    control?.destroy();
    if (child.exitCode === null) {
      const closing = once(child, 'close'); const kill = setTimeout(() => child.kill(), 3000); await closing; clearTimeout(kill);
    }
    await setHost(host);
  }
}
