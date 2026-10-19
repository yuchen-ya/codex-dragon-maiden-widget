import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/whale-widget.js', import.meta.url), 'utf8');
function productionFunction(name) {
  const start = source.indexOf(`    function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n    }', start) + '\n    }'.length);
}
const exported = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(new URL('../desktop/ui/account-view.js', import.meta.url), 'utf8'), exported);
const { quotaBubbleModules } = exported.module.exports;
const quoteModule = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(new URL('../desktop/ui/dragon-maiden-quotes.js', import.meta.url), 'utf8'), quoteModule);
const { quotes, lines } = quoteModule.module.exports;

test('quota bubble shows the returned weekly quota and reset without inventing a 5-hour period', () => {
  const modules = quotaBubbleModules({ available: true, windows: [{ windowDurationMins: 10080, usedPercent: 37, resetsAt: Date.UTC(2026, 9, 25, 6, 6) }] });
  assert.deepEqual(Array.from(modules, item => item.text), ['每周额度', '剩余 63.0%', '重置 10/25 14:06']);
  assert.ok(!modules.some(item => /token|5 小时/.test(item.text)));
});

test('unknown, unavailable and expired quotas remain distinguishable from zero usage', () => {
  assert.match(quotaBubbleModules(null)[1].text, /读取中/);
  assert.match(quotaBubbleModules({ available: false })[1].text, /暂时读不到/);
  const modules = quotaBubbleModules({ available: true, windows: [{ usedPercent: null, stale: true }] });
  assert.equal(modules[1].text, '比例未知');
  assert.match(modules[2].text, /已过期/);
});

test('both returned quota periods fit the same compact scene', () => {
  const modules = quotaBubbleModules({ available: true, windows: [{ windowDurationMins: 300, usedPercent: 0 }, { windowDurationMins: 10080, usedPercent: 50 }] });
  assert.deepEqual(Array.from(modules, item => item.text), ['Codex 额度', '5 小时额度 剩余 100.0%', '每周额度 剩余 50.0%']);
});

function interaction() {
  const events = [];
  const box = {
    window: { WhaleAccountView: { mode: 'subscription' }, DragonMaidenQuotes: { lines: () => [] } },
    bubbleOn: true, bubbleShown: false, bubbleScene: null, bubbleRoundOn: false, bubbleSeqIdx: 0, BUBBLE_MS: 5000,
    bubbleRenderDefault() {}, bubbleRenderModules() {},
    sceneOpen(kind) { events.push(kind); box.bubbleShown = true; box.bubbleScene = { kind }; },
    hideBubble() { events.push('close'); box.bubbleShown = false; box.bubbleScene = null; },
    bubbleResetTtl() { events.push('extend'); },
    bubbleIsChoice: () => false
  };
  vm.createContext(box);
  vm.runInContext(['bubbleDefaultQueue', 'bubbleShowSeqNext', 'whaleClick', 'bubbleNext', 'refreshQuotaBubble'].map(productionFunction).join('\n'), box);
  box.bubbleSeq = box.bubbleDefaultQueue();
  return { box, events };
}

test('subscription pet and bubble clicks follow quota, persona quote, then close', () => {
  const { box, events } = interaction();
  box.whaleClick();
  assert.equal(box.bubbleScene.kind, 'normal');
  box.whaleClick();
  assert.deepEqual(events, ['normal', 'extend']);
  box.bubbleNext();
  assert.equal(box.bubbleScene.kind, 'custom');
  box.bubbleNext();
  assert.equal(box.bubbleShown, false);
  assert.deepEqual(events, ['normal', 'extend', 'custom', 'close']);
});

test('disabled bubbles and active notices are respected by pet clicks', () => {
  const { box, events } = interaction();
  box.bubbleOn = false; box.whaleClick();
  box.bubbleOn = true;
  for (const kind of ['cost', 'alert']) { box.bubbleScene = { kind }; box.whaleClick(); }
  assert.deepEqual(events, []);
});

test('a quota response can update only its still-open quota scene once', () => {
  const { box, events } = interaction();
  box.whaleClick(); box.refreshQuotaBubble(); box.refreshQuotaBubble();
  assert.deepEqual(events, ['normal', 'normal']);
  box.bubbleNext(); box.refreshQuotaBubble();
  assert.equal(box.bubbleScene.kind, 'custom');
  box.bubbleNext(); box.refreshQuotaBubble();
  assert.equal(box.bubbleShown, false);
  assert.deepEqual(events, ['normal', 'normal', 'custom', 'close']);
});

test('runtime quotes preserve reviewed text while unresolved rewrite notes stay in review', () => {
  const review = JSON.parse(fs.readFileSync(new URL('../docs/quote-sources.json', import.meta.url), 'utf8')).rows;
  assert.equal(quotes.length, 52);
  for (const quote of quotes) {
    const row = review.find(item => item.id === quote.id);
    assert.ok(['keep', 'edit'].includes(row.status));
    assert.equal(quote.text, row.text);
    assert.ok(!['04', '05', '06', '30'].includes(quote.id));
  }
});

test('full-quota jokes require at least 95 percent in every fresh returned period', () => {
  const quota = (used, stale = false) => ({ available: true, windows: used.map(usedPercent => ({ usedPercent, stale })) });
  assert.equal(lines(null).length, 47);
  assert.equal(lines(quota([5])).length, 52);
  assert.equal(lines(quota([0, 6])).length, 47);
  assert.equal(lines(quota([0], true)).length, 47);
  assert.equal(lines(quota([null])).length, 47);
});

test('dialog controls over the pet receive their pointer and click events', () => {
  const blocked = [], box = {
    isWhaleHit: () => true, menuOpen: true, menuBtnHide: true,
    closeMenu() { blocked.push('menu closed'); },
    endDrag() {},
    event: { target: { closest: selector => selector === 'dialog[open]' ? {} : null },
      preventDefault() { blocked.push('prevented'); }, stopPropagation() { blocked.push('stopped'); } }
  };
  vm.createContext(box);
  vm.runInContext(['onDocPointerDown', 'onDocPointerUp', 'onDocClickStopper', 'onDocContextMenu'].map(productionFunction).join('\n'), box);
  box.onDocPointerDown(box.event); box.onDocPointerUp(box.event);
  box.onDocClickStopper(box.event); box.onDocContextMenu(box.event);
  assert.deepEqual(blocked, []);
});
