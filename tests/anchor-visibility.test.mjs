import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('restoring a smaller host keeps old or negative saved anchors within the viewport', () => {
  const source = fs.readFileSync(new URL('../assets/whale-widget.js', import.meta.url), 'utf8');
  const start = source.indexOf('    function settle() {'), end = source.indexOf('    function snapBounds(', start);
  assert.ok(start > 0 && end > start);
  for (const [h, v, hOff, vOff] of [['right','bottom',-2208,-918], ['left','top',2208,918], ['right','bottom',20,30]]) {
    const state = { h, v, hOff, vOff, left: 0, top: 0 };
    vm.runInNewContext(source.slice(start, end) + ';settle();', { state, viewport: () => ({w:400,h:300}), root:{offsetWidth:120,offsetHeight:140}, drag:{active:false}, rightGap:()=>0, clamp:(n,a,b)=>Math.min(b,Math.max(a,n)), refreshFlip:()=>{} });
    assert.ok(state.left >= 0 && state.left + 120 <= 400);
    assert.ok(state.top >= 0 && state.top + 140 <= 300);
    if(hOff===20){ assert.equal(state.left,260); assert.equal(state.top,130); }
  }
});
