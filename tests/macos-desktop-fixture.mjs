import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function verifyDesktop({ app, window, screen, setHost, setTestCursor, dataDir, errors, renderInfo }) {
  const output = process.env.WHALE_DESKTOP_VERIFY_DIR, checks = [];
  const ev = code => window.webContents.executeJavaScript(code);
  const wait = async (code, label) => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) { if (await ev(code)) return; await delay(50); }
    throw new Error('Timed out: ' + label);
  };
  const move = async point => {
    setTestCursor(point);
    window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(point.x), y: Math.round(point.y) });
    await delay(100);
  };
  const click = async point => {
    app.focus({ steal: true }); window.focus(); window.webContents.focus(); await wait('document.hasFocus()', 'focus'); await move(point);
    for (const type of ['mouseDown', 'mouseUp']) {
      window.webContents.sendInputEvent({ type, button: 'left', clickCount: 1, x: Math.round(point.x), y: Math.round(point.y) });
      await delay(60);
    }
    await delay(250);
  };
  const center = selector => ev(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  const hitPoint = () => ev(`(() => {
    const img=document.querySelector('.dshwv-img'),r=img.getBoundingClientRect();
    for(let y=r.y+r.height*.3;y<r.bottom;y+=3)for(let x=r.x+r.width*.3;x<r.right;x+=3)
      if(window.__whaleInputTest.hit({x,y}))return{x,y};
    throw Error('No opaque pet pixel');
  })()`);
  try {
    const area = screen.getPrimaryDisplay().workArea;
    const host = { hostAlive: true, hostPid: 123456, window: 'fixture', attached: true, visible: true,
      bounds: { x: area.x + 40, y: area.y + 40, width: Math.min(900, area.width - 80), height: Math.min(650, area.height - 80) } };
    await setHost(host);
    await wait('window.__whaleInputTest && window.__whaleRenderTest?.status().hitCache.decodes > 0', 'decoded image');
    await wait('WhaleAccountView.subscription?.available', 'fixture subscription');
    await delay(250);
    assert.equal(window.isVisible(), true);
    assert.equal(window.isAlwaysOnTop(), true);
    assert.equal(await ev('window.whaleDesktop.platform'), 'darwin');
    assert.equal(renderInfo().windowShape, null);
    checks.push('native macOS transparent window and renderer ready on Retina display');
    const image = await window.webContents.capturePage();
    const pixels = image.toBitmap();
    let transparent = 0, opaque = 0;
    for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] === 0) transparent++; if (pixels[i] > 230) opaque++; }
    assert.ok(transparent > pixels.length / 8); assert.ok(opaque > 100);
    await move({ x: 4, y: 4 });
    assert.equal(renderInfo().inputEnabled, false);
    await move(await hitPoint());
    assert.equal(renderInfo().inputEnabled, true);
    checks.push('transparent pixels pass mouse events through; opaque pet enables input');
    await click(await hitPoint());
    await wait('window.__whaleRenderTest.status().shown && !window.__whaleRenderTest.status().switching', 'quota bubble');
    await wait("document.querySelector('.dshwv-pop-open')?.innerText.includes('75.0%')", 'subscription quota');
    await delay(600); // Capture after the existing bubble text fade finishes.
    fs.writeFileSync(path.join(output, 'macos-quota.png'), (await window.webContents.capturePage()).toPNG());
    checks.push('mouse click opens the subscription quota bubble');
    await ev('window.__whaleRenderTest.close()'); await delay(400);
    const before = await ev("document.querySelector('.dshwv-root').getBoundingClientRect().toJSON()");
    const point = await hitPoint(); await move(point);
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x: Math.round(point.x), y: Math.round(point.y), clickCount: 1 });
    for (let i = 1; i <= 6; i++) await move({ x: point.x - i * 15, y: point.y - i * 12 });
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x: Math.round(point.x - 90), y: Math.round(point.y - 72), clickCount: 1 });
    await delay(400);
    const after = await ev("document.querySelector('.dshwv-root').getBoundingClientRect().toJSON()");
    assert.ok(before.x - after.x > 50, 'drag moves the pet');
    const position = await ev("localStorage.getItem('dshw-pos')"); assert.ok(position);
    checks.push('pointer capture drag commits a persistent pet position');
    await move(await hitPoint()); await click(await center('.dshwv-menu-btn'));
    await wait("document.querySelector('.dshwv-menu-open')?.checkVisibility({opacityProperty:true})", 'settings menu');
    assert.match(await ev("document.querySelector('.dshwv-menu').innerText"), /外观与位置/);
    fs.writeFileSync(path.join(output, 'macos-settings.png'), (await window.webContents.capturePage()).toPNG());
    await ev('WhaleFeedback.open()'); await wait("!!document.querySelector('dialog[open]')", 'preferences dialog');
    await wait('document.hasFocus()', 'keyboard focus for preferences');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait("!document.querySelector('dialog[open]')", 'Escape closes preferences');
    checks.push('settings menu, keyboard focus and Escape dismissal');
    await setHost({ ...host, visible: false }); assert.equal(window.isVisible(), false);
    const moved = { ...host, bounds: { ...host.bounds, x: host.bounds.x + 25, y: host.bounds.y + 20, width: host.bounds.width - 100, height: host.bounds.height - 80 } };
    await setHost(moved); await delay(200);
    assert.equal(window.isVisible(), true); assert.deepEqual(window.getBounds(), moved.bounds);
    checks.push('host move, resize, minimize and restore in macOS point coordinates');
    assert.equal(await ev("window.whaleDesktop.command('desktop')"), true);
    await setHost({ hostAlive: false, visible: false }); await delay(150);
    assert.equal(window.isVisible(), true); assert.deepEqual(window.getBounds(), screen.getPrimaryDisplay().workArea);
    checks.push('standalone mode remains visible without a Codex host');
    const loaded = once(window.webContents, 'did-finish-load'); window.webContents.reload(); await loaded;
    await wait('window.__whaleRenderTest?.status().hitCache.decodes > 0', 'renderer restart');
    assert.equal(await ev("localStorage.getItem('dshw-pos')"), position);
    checks.push('renderer restart preserves saved position');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'macos-desktop.json'), JSON.stringify({ ok: true, checks, errors, scaleFactor: screen.getPrimaryDisplay().scaleFactor, rendering: renderInfo() }, null, 2));
    app.quit();
  } catch (error) {
    fs.writeFileSync(path.join(output, 'macos-failure.png'), (await window.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(output, 'macos-desktop.json'), JSON.stringify({ ok: false, checks, errors, error: error.stack, dataDir, focus: { app: app.isActive(), window: window.isFocused(), web: window.webContents.isFocused(), focusable: window.isFocusable() }, rendering: renderInfo() }, null, 2));
    app.exit(1);
  }
}
