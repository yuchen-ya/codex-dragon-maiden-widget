import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export async function verifyFxPopover({ window, ev, wait, clickAt, output }) {
  const checks = [], button = '#dshw-fx-info', note = '#dshw-currency-note';
  assert.equal(await ev(`document.querySelector('${note}').hidden`), true);
  assert.equal(await ev("!!document.querySelector('#dshw-failed-notice,#dshw-cancelled-notice')"), false);
  await ev(`document.querySelector('${button}').scrollIntoView({block:'nearest'})`);
  const click = async selector => {
    const point = await ev(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await clickAt(point);
  };
  await click(button);
  await wait(`!document.querySelector('${note}').hidden`, 'FX explanation opened by click');
  const geometry = await ev(`(() => {const btn=document.querySelector('${button}'),refresh=document.querySelector('#dshw-fx-refresh'),note=document.querySelector('${note}');return{button:btn.getBoundingClientRect().toJSON(),refresh:refresh.getBoundingClientRect().toJSON(),note:note.getBoundingClientRect().toJSON(),width:innerWidth,height:innerHeight,expanded:btn.getAttribute('aria-expanded'),background:getComputedStyle(btn).backgroundColor,text:note.textContent};})()`);
  assert.ok(geometry.button.left >= geometry.refresh.right - 1); assert.equal(geometry.expanded, 'true');
  assert.match(geometry.text, /1 美元 = .* 人民币/); assert.match(geometry.text, /Frankfurter · 汇率日期/);
  assert.match(geometry.text, /最近成功获取：/); assert.match(geometry.text, /最近检查：.*北京时间/);
  assert.match(geometry.text, /每天 00:15 检查；休市日可能沿用上个交易日/);
  assert.ok(geometry.note.left >= 0 && geometry.note.top >= 0 && geometry.note.right <= geometry.width && geometry.note.bottom <= geometry.height);
  await click(note);
  assert.equal(await ev(`document.querySelector('${note}').hidden`), false);
  assert.equal(await ev("document.querySelector('.dshwv-menu').classList.contains('dshwv-menu-open')"), true);
  fs.writeFileSync(path.join(output, 'fx-explanation.png'), (await window.webContents.capturePage()).toPNG());
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await wait(`document.querySelector('${note}').hidden`, 'FX explanation Escape close');
  assert.equal(await ev(`document.activeElement===document.querySelector('${button}')`), true);
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await wait(`!document.querySelector('${note}').hidden`, 'FX explanation keyboard open');
  await click('#dshw-fx-refresh');
  await wait(`document.querySelector('${note}').hidden`, 'FX explanation outside click close');
  assert.equal(await ev("document.querySelector('.dshwv-menu').classList.contains('dshwv-menu-open')"), true);
  checks.push('FX information is hidden until click, sits right of refresh, stays inside the viewport, preserves all quote fields, accepts keyboard activation, and closes on Escape or outside click without closing the menu');
  return { checks };
}
