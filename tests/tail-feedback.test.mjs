import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/whale-widget.js', import.meta.url), 'utf8');
const start = source.indexOf('    var tailTugIndex = 0, tailPullCount');
const end = source.indexOf("    window.addEventListener('whale-desktop-mode'", start);
const blockedStart = source.indexOf('    function reactionBlocked(');
const blockedEnd = source.indexOf('    var reactionNoticeClient', blockedStart);

function fixture() {
  let now = 0;
  const handlers = {}, shown = [];
  const context = vm.createContext({
    performance: { now: () => now },
    window: { WhaleCollapse: { collapsed: false, busy: false },
      addEventListener: (name, handler) => { handlers[name] = handler; },
      DragonDialogue: { text: (group, index) => `${group}:${index}` } },
    document: { querySelector: () => null }, bubbleOn: true, menuOpen: false,
    whaleSysQueue: [], bubbleScene: null,
    sceneOpen: (kind, render) => { context.bubbleScene = { kind }; render(); },
    bubbleRenderModules: modules => shown.push(modules[0].text)
  });
  vm.runInContext(source.slice(blockedStart, blockedEnd) + source.slice(start, end), context);
  return { context, shown, advance: ms => { now += ms; },
    pull: () => handlers['whale-tail-tug'](),
    rapid: () => handlers['whale-tail-response']({ detail: 'rapid' }) };
}

test('tail pulls stay quiet first, object twice even while a tail bubble is open, then ignore a fixed interval', () => {
  const f = fixture();
  f.pull(); assert.deepEqual(f.shown, []);
  f.advance(300); f.pull();
  assert.deepEqual(f.shown, ['tail_pull:0']);
  f.advance(300); f.pull();
  assert.deepEqual(f.shown, ['tail_pull:0', 'tail_pull:1']);
  for (let i = 0; i < 19; i++) { f.advance(1000); f.pull(); f.rapid(); }
  assert.equal(f.shown.length, 2);
  f.advance(1000); f.pull(); // Silent pulls did not extend the ignore interval.
  assert.equal(f.shown.length, 2);
  f.advance(300); f.pull();
  assert.equal(f.shown.at(-1), 'tail_pull:0');
});

test('a gap of ten seconds starts a quiet new round', () => {
  const f = fixture();
  f.pull(); f.advance(10000); f.pull();
  assert.deepEqual(f.shown, []);
  f.advance(300); f.pull();
  assert.deepEqual(f.shown, ['tail_pull:0']);
});

test('hidden, animation and business notices suppress tail dialogue without consuming the first pull', () => {
  const f = fixture();
  f.context.window.WhaleCollapse.collapsed = true; f.pull(); f.rapid();
  f.context.window.WhaleCollapse.collapsed = false;
  f.context.window.WhaleCollapse.busy = true; f.pull();
  f.context.window.WhaleCollapse.busy = false;
  f.context.bubbleScene = { kind: 'wait' }; f.pull();
  f.context.bubbleScene = null;
  f.pull(); assert.deepEqual(f.shown, []);
  f.pull(); assert.deepEqual(f.shown, ['tail_pull:0']);
});
