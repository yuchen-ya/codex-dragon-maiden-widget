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

test('question reminder shows character wording above a smaller session title and keeps its waiting lifecycle', () => {
  let rendered, scene;
  const box = {
    bubbleOn: true,
    bubbleRenderModules: modules => { rendered = modules; },
    sceneOpen: (kind, build, ttl, item) => { scene = { kind, ttl, item }; build(); }
  };
  vm.createContext(box);
  vm.runInContext(productionFunction('showInteractionNotice'), box);
  const valid = () => true;
  box.showInteractionNotice({ id: 'q1', kind: 'question', threadTitle: '修复提醒气泡' }, { valid });
  assert.deepEqual(Array.from(rendered, item => item.text), ['老大，我有个问题', '[修复提醒气泡]']);
  assert.ok(rendered[0].size > rendered[1].size);
  assert.equal(scene.kind, 'wait'); assert.equal(scene.ttl, 0); assert.equal(scene.item.isValid, valid);
  box.showInteractionNotice({ id: 'q2', kind: 'question' }, { valid });
  assert.equal(rendered[1].text, '[未命名会话]');
  box.showInteractionNotice({ id: 'q3', kind: 'question', threadTitle: '查找桌面端插件' }, { valid });
  assert.equal(rendered[1].text, '[查找桌面端…]');
});
const exported = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(new URL('../desktop/ui/account-view.js', import.meta.url), 'utf8'), exported);
const { quotaBubbleModules } = exported.module.exports;
const turnExport = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(new URL('../desktop/ui/turn-notice.js', import.meta.url), 'utf8'), turnExport);

test('subscription completion enters the character bubble queue once and respects its main switch', async () => {
  const queued = [];
  let record = { ok: true, seq: 1, id: 'thread:turn1', turn: 'turn1', ts: 1000, tokens: 2299061, amount: null, outcome: 'completed' };
  const box = {
    lastCostPending: false, lastCostSeq: 0, lastCostId: '', lastCostAligned: false, costPollingStartedAt: 0,
    LAST_TURN_URL: '/last-turn', state: { currency: 'USD' }, WhaleTurnNotice: turnExport.module.exports,
    window: { WhaleAccountView: { mode: 'subscription' }, dispatchEvent() {} },
    CustomEvent: class {}, localStorage: { setItem() {} },
    fetch: async () => ({ json: async () => record }), playTaskEndSound() {},
    bubbleOn: true, turnCostOn: true, whaleSysPush: item => queued.push(item)
  };
  vm.createContext(box);
  vm.runInContext(['pollLastTurn', 'showCostBubble'].map(productionFunction).join('\n'), box);
  box.pollLastTurn(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(queued.length, 1); assert.equal(queued[0].kind, 'cost'); assert.equal(queued[0].notice.tokens, 2299061);
  box.pollLastTurn(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(queued.length, 1);
  box.turnCostOn = false;
  record = { ...record, seq: 2, id: 'thread:turn2', turn: 'turn2' };
  box.pollLastTurn(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(queued.length, 1);
});
const quoteModule = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(new URL('../desktop/ui/dragon-maiden-quotes.js', import.meta.url), 'utf8'), quoteModule);
const { quotes, lines } = quoteModule.module.exports;

test('quota bubble shows the returned weekly quota and reset without inventing a 5-hour period', () => {
  const modules = quotaBubbleModules({ available: true, windows: [{ windowDurationMins: 10080, usedPercent: 37, resetsAt: Date.UTC(2026, 9, 25, 6, 6) }] });
  assert.deepEqual(Array.from(modules, item => item.text), ['本周', '剩余 63%', '— tok/s']);
  assert.ok(modules[0].size < modules[1].size && modules[2].size < modules[1].size);
  assert.ok(!modules.some(item => /token|5 小时/.test(item.text)));
});

test('unknown, unavailable and expired quotas remain distinguishable from zero usage', () => {
  assert.match(quotaBubbleModules(null)[0].text, /读取中/);
  assert.equal(quotaBubbleModules({ available: false })[1].text, '剩余 —');
  const modules = quotaBubbleModules({ available: true, windows: [{ usedPercent: null, stale: true }] });
  assert.match(modules[1].text, /—\*/);
  assert.equal(modules[2].text, '— tok/s');
});

test('both returned quota periods fit the same compact scene', () => {
  const modules = quotaBubbleModules({ available: true, windows: [{ windowDurationMins: 300, usedPercent: 0 }, { windowDurationMins: 10080, usedPercent: 50 }] });
  assert.deepEqual(Array.from(modules, item => item.text), ['5小时 / 本周', '剩余 100% / 50%', '— tok/s']);
});

test('recent quota speed identifies its model and age, and unavailable timing is not zero', () => {
  const quota = { available: true, windows: [{ windowDurationMins: 10080, usedPercent: 50 }] };
  const rows = quotaBubbleModules(quota, { model: 'gpt-6.1-sol', tokensPerSecond: 42.5, timestamp: 1000 }, 121000);
  assert.deepEqual(Array.from(rows, row => row.text), ['本周', '剩余 50%', '42.5 tok/s']);
  assert.equal(quotaBubbleModules(quota, { model: 'gpt-6-astra', tokensPerSecond: null, timestamp: 1000 }, 1000)[2].text, '— tok/s');
});

function interaction() {
  const events = [], rendered = [];
  let now = 1000, random = 0.99;
  const box = {
    Date: { now: () => now }, Math: { random: () => random },
    petpetClickCount: 0, petpetLastClickAt: -Infinity, petpetLastShownAt: -Infinity,
    window: { WhaleAccountView: { mode: 'subscription' }, DragonMaidenQuotes: { lines: () => [] } },
    bubbleOn: true, bubbleShown: false, bubbleScene: null, bubbleRoundOn: false, bubbleSeqIdx: 0, BUBBLE_MS: 5000,
    bubbleRenderDefault() {}, bubbleRenderModules(modules) { rendered.push(modules); },
    sceneOpen(kind, build, ttl) { events.push(kind); box.bubbleShown = true; box.bubbleScene = { kind, ttl }; build(); },
    hideBubble() { events.push('close'); box.bubbleShown = false; box.bubbleScene = null; },
    bubbleResetTtl() { events.push('extend'); },
    bubbleIsChoice: () => false
  };
  vm.createContext(box);
  vm.runInContext(['bubbleDefaultQueue', 'bubbleShowSeqNext', 'bubbleTryPetpet', 'whaleClick', 'bubbleNext', 'refreshQuotaBubble'].map(productionFunction).join('\n'), box);
  box.bubbleSeq = box.bubbleDefaultQueue();
  return { box, events, rendered, advance(ms) { now += ms; }, random(value) { random = value; } };
}

test('random petpet keeps quota first, closes on the next bubble click and observes its cooldown', () => {
  const h = interaction(); h.random(0.09);
  h.box.whaleClick(); assert.equal(h.box.bubbleScene.kind, 'normal');
  h.box.bubbleNext();
  assert.equal(h.rendered.at(-1)[0].imgId, 'bimg_dragon_petpet');
  assert.equal(h.box.bubbleScene.ttl, 5000);
  h.box.bubbleNext(); assert.equal(h.box.bubbleShown, false);
  h.box.whaleClick(); h.box.bubbleNext();
  assert.equal(h.rendered.at(-1)[0].roleQuotes, true, 'cooldown still allows ordinary quotes');
  h.box.bubbleNext(); h.advance(20000);
  h.box.whaleClick(); h.box.bubbleNext();
  assert.equal(h.rendered.at(-1)[0].imgId, 'bimg_dragon_petpet');
});

test('four closely spaced pet clicks only boost the next bubble click and never display petpet directly', () => {
  const h = interaction(); h.random(0.59);
  for (let index = 0; index < 4; index++) { h.box.whaleClick(); h.advance(300); }
  assert.equal(h.rendered.length, 0);
  assert.equal(h.box.bubbleScene.kind, 'normal');
  h.box.bubbleNext();
  assert.equal(h.rendered.at(-1)[0].imgId, 'bimg_dragon_petpet');
  h.box.bubbleNext(); assert.equal(h.box.bubbleShown, false);
});

test('a pause resets the click boost and an unsuccessful roll keeps the normal interaction', () => {
  const h = interaction(); h.random(0.6);
  for (let index = 0; index < 4; index++) { h.box.whaleClick(); h.advance(300); }
  assert.equal(h.rendered.length, 0);
  h.box.bubbleNext();
  assert.equal(h.rendered.at(-1)[0].roleQuotes, true);
  h.box.bubbleNext();
  h.advance(2001); h.random(0.59); h.box.whaleClick();
  assert.equal(h.box.bubbleScene.kind, 'normal');
  h.box.bubbleNext();
  assert.equal(h.rendered.at(-1)[0].roleQuotes, true);
});

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
  for (const kind of ['cost', 'alert', 'wait']) { box.bubbleScene = { kind }; box.whaleClick(); }
  assert.deepEqual(events, []);
  assert.equal(box.petpetClickCount, 0);
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
