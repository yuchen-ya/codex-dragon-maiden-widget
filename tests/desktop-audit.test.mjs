import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
// Windows PowerShell 5 treats BOM-less UTF-8 as the active ANSI code page.
// Generated harnesses interpolate local paths, which can contain any Unicode.
const writePowerShell = (file,source) => fs.writeFile(file,'\uFEFF'+source.replace(/^\uFEFF/,''),'utf8');
const require = createRequire(import.meta.url);
const { shutdownCompanion } = require('../desktop/lifecycle.cjs');
const { externalWebUrl } = require('../desktop/external-links.cjs');

test('shutdown still flushes cached state and closes services when the renderer never answers', async () => {
  const calls = [];
  const result = await shutdownCompanion({
    readRenderer: () => new Promise(() => {}),
    saveRenderer: () => calls.push('save'), flushState: () => calls.push('flush'),
    closeBridge: () => calls.push('bridge'), closeDispatcher: () => calls.push('service'),
  }, { timeoutMs: 150, rendererMs: 15 });
  assert.deepEqual(calls, ['flush', 'bridge', 'service']);
  assert.deepEqual(result.stages.map(x => x.status), ['timeout', 'complete', 'complete', 'complete']);
});

test('shutdown has an overall deadline and never saves a late renderer snapshot', async () => {
  const calls = [], start = Date.now(); let answer;
  const result = await shutdownCompanion({
    readRenderer: () => new Promise(resolve => { answer = resolve; }),
    saveRenderer: () => calls.push('late-save'), flushState: () => Promise.reject(new Error('disk unavailable')),
    closeBridge: () => calls.push('bridge'), closeDispatcher: () => new Promise(() => {}),
  }, { timeoutMs: 70, rendererMs: 10, stateMs: 10 });
  answer({ 'dshw-pos': 'outdated' }); await Promise.resolve();
  assert.deepEqual(calls, ['bridge']);
  assert.deepEqual(result.stages.map(x => x.status), ['timeout', 'failed', 'complete', 'timeout']);
  assert.ok(Date.now() - start < 700, 'hung services must not leave the companion alive');
});

test('normal shutdown saves current settings before flushing and draining services', async () => {
  const calls = [], snapshot = { 'dshw-pos': 'latest' };
  const result = await shutdownCompanion({
    readRenderer: () => snapshot, saveRenderer: value => { assert.equal(value, snapshot); calls.push('save'); },
    flushState: () => calls.push('flush'), closeBridge: () => calls.push('bridge'), closeDispatcher: () => calls.push('service'),
  });
  assert.equal(result.clean, true); assert.deepEqual(calls, ['save', 'flush', 'bridge', 'service']);
});

test('external links only accept ordinary credential-free HTTP and HTTPS URLs', () => {
  assert.equal(externalWebUrl('https://example.org/path?q=1#part'), 'https://example.org/path?q=1#part');
  assert.equal(externalWebUrl('http://example.org'), 'http://example.org/');
  for (const value of ['file:///C:/secret', 'javascript:alert(1)', 'data:text/html,x', 'cmd:thing', '//example.org',
    'https://user:password@example.org', 'https:\\example.org', 'https://example.org\n', ' https://example.org', null, 42]) {
    assert.equal(externalWebUrl(value), null, String(value));
  }
});

test('preload requires a trusted recent user click before exposing external navigation', async () => {
  const source = await fs.readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
  const listeners = {}, calls = []; let bridge;
  const ipcRenderer = { sendSync: () => ({}), send: (...args) => calls.push(args), on() {}, invoke: (...args) => { calls.push(args); return Promise.resolve(true); } };
  vm.runInNewContext(source, {
    require: () => ({ ipcRenderer, contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } } }),
    document: { addEventListener: (name, fn) => { listeners[name] = fn; } },
    localStorage: { getItem: () => null, setItem() {} }, process: { argv: [] },
    navigator: { userActivation: { isActive: true } }, window: { dispatchEvent() {} }, Date, Promise,
  });
  assert.equal(await bridge.openExternal('https://example.org'), false);
  listeners.click({ isTrusted: false, button: 0 });
  assert.equal(await bridge.openExternal('https://example.org'), false);
  listeners.click({ isTrusted: true, button: 0 });
  assert.equal(await bridge.openExternal('https://example.org'), true);
  assert.equal(await bridge.openExternal('https://example.org'), false, 'one click cannot launch repeated external windows');
  assert.equal(calls.filter(x => x[0] === 'whale-open-external').length, 1);
});

async function animationMask(type, frameCount = 2, failedDecoder = false) {
  const source = await fs.readFile(new URL('../desktop/ui/alpha-worker.js', import.meta.url), 'utf8');
  let drawn, decodes = 0, released = 0;
  const frames = [[255, 0, 0, 0], [0, 255, 0, 0]].map(alpha => ({ width: 2, height: 2, alpha, close() { released++; } }));
  const context = { clearRect() {}, drawImage(image) { drawn = image; }, getImageData: () => ({ data: Uint8Array.from(drawn.alpha.flatMap(a => [0, 0, 0, a])) }) };
  const box = {
    OffscreenCanvas: class { getContext() { return context; } },
    fetch: async () => ({ ok: true, blob: async () => ({ type, arrayBuffer: async () => new ArrayBuffer(0) }) }),
    createImageBitmap: async () => frames[0],
    ImageDecoder: class {
      constructor() { if (failedDecoder) throw new Error('unsupported image decoder'); this.tracks = { ready: Promise.resolve(), selectedTrack: { frameCount } }; }
      decode() { decodes++; return Promise.resolve({ image: frames[1] }); }
      close() { released++; }
    },
    self: { postMessage() {} }, Uint8Array, Math, Promise, performance,
  };
  vm.createContext(box); vm.runInContext(source, box);
  const result = await vm.runInContext("decode('memory-role')", box);
  return { alpha: [...new Uint8Array(result.alpha)], decodes, released };
}

test('APNG and GIF masks include opaque pixels from later frames', async () => {
  for (const type of ['image/png', 'image/gif']) {
    const result = await animationMask(type);
    assert.deepEqual(result.alpha, [255, 255, 0, 0]);
    assert.equal(result.decodes, 1); assert.equal(result.released, 3);
  }
});

test('long or unsupported animations keep a bounded clickable fallback instead of passing through visible pixels', async () => {
  const large = await animationMask('image/png', 600);
  assert.deepEqual(large.alpha, [255, 255, 255, 255]); assert.equal(large.decodes, 0);
  const unsupported = await animationMask('image/png', 2, true);
  assert.deepEqual(unsupported.alpha, [255, 255, 255, 255]);
});

test('broken saved role requests fallback once, then announces readiness only for a loaded replacement', async () => {
  const source = await fs.readFile(new URL('../desktop/ui/input.js', import.meta.url), 'utf8');
  const begin = source.indexOf('  async function prepare()'), end = source.indexOf("  pet.addEventListener('load'");
  const events = [], bridgeCalls = [];
  const box = { pet: { complete: true, naturalWidth: 0, currentSrc: 'broken-role' }, failedRoleSources: new Set(), ready: false,
    rendering: { hitCache: { prepare: async () => ({}) } }, bridge: { ready: () => bridgeCalls.push('ready') }, request() {},
    window: { dispatchEvent: event => events.push(event) }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } };
  vm.createContext(box); vm.runInContext(source.slice(begin, end), box);
  await vm.runInContext('prepare(); prepare()', box);
  assert.equal(events.length, 1); assert.equal(events[0].type, 'whale-role-fallback'); assert.equal(bridgeCalls.length, 0);
  box.pet.currentSrc = 'default-role'; box.pet.naturalWidth = 100;
  await vm.runInContext('prepare()', box);
  assert.deepEqual(bridgeCalls, ['ready']);
});

test('an earlier accepted press retains native input after the squish makes its pixel transparent', async () => {
  const source = await fs.readFile(new URL('../desktop/ui/input.js', import.meta.url), 'utf8');
  const start = source.indexOf("  document.addEventListener('pointerdown'"), end = source.indexOf('  function release(');
  let handler, captured = true;
  const enabled = [], box = { releaseEpoch: 0, point: null, heldPointer: null,
    root: { hasPointerCapture: id => captured && id === 1 }, hit: () => false,
    document: { addEventListener: (_name, callback) => { handler = callback; } },
    update: () => enabled.push(box.heldPointer !== null) };
  vm.createContext(box); vm.runInContext(source.slice(start, end), box);
  handler({ pointerId: 1, clientX: 20, clientY: 30 });
  assert.equal(box.heldPointer, 1); assert.deepEqual(enabled, [true]);
  box.heldPointer = null; captured = false;
  handler({ pointerId: 2, clientX: 100, clientY: 100 });
  assert.equal(box.heldPointer, null); assert.deepEqual(enabled, [true, false], 'an unaccepted transparent-area press still passes through');
});

for (const foreign of [false, true]) {
  test(`current-user startup ${foreign ? 'rejects another installation before stopping the monitor' : 'installs, verifies and removes only its own shortcut'}`, { skip: process.platform !== 'win32' }, async t => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dragon-startup-'));
    t.after(() => fs.rm(temporary, { recursive: true, force: true }));
    const scripts = path.join(temporary, 'scripts'), desktop = path.join(temporary, 'desktop'), data = path.join(temporary, 'data');
    const roaming = path.join(temporary, 'roaming'), startup = path.join(roaming, 'Microsoft/Windows/Start Menu/Programs/Startup');
    await Promise.all([fs.mkdir(scripts), fs.mkdir(desktop), fs.mkdir(startup, {recursive:true}), fs.mkdir(path.join(data, 'desktop-runtime/node_modules/electron/dist'), {recursive:true})]);
    const launcher=path.join(temporary,'launcher.exe');
    const quote=value=>"'"+value.replaceAll("'","''")+"'";
    await Promise.all([
      fs.writeFile(launcher,''), fs.writeFile(path.join(data,'desktop-runtime/node_modules/electron/dist/electron.exe'),''),
      fs.writeFile(path.join(data,'follow-config.json'),JSON.stringify({enabled:true,sentinel:'keep'})),
      fs.copyFile(new URL('../scripts/install-follow.ps1',import.meta.url),path.join(scripts,'install-follow.ps1')),
      fs.copyFile(new URL('../scripts/uninstall-follow.ps1',import.meta.url),path.join(scripts,'uninstall-follow.ps1')),
      writePowerShell(path.join(scripts,'build-launcher.ps1'),'param([string]$DataDir)\nWrite-Output '+quote(launcher)),
      writePowerShell(path.join(desktop,'supervisor.ps1'),'param([string]$DataDir,[switch]$Stop)\nSet-Content -LiteralPath (Join-Path $DataDir stop-called) -Value yes'),
    ]);
    const link=path.join(startup,'Codex Dragon Maiden Widget.lnk');
    const harness=path.join(temporary,'check.ps1');
    await writePowerShell(harness, `$ErrorActionPreference='Stop'
$shell=New-Object -ComObject WScript.Shell
${foreign ? `$s=$shell.CreateShortcut(${quote(link)});$s.TargetPath=${quote(launcher)};$s.Arguments='foreign-owner';$s.Save()` : ''}
& ${quote(path.join(scripts,'install-follow.ps1'))} -DataDir ${quote(data)} -NoStart
$s=$shell.CreateShortcut(${quote(link)})
if($s.TargetPath -ine ${quote(launcher)} -or !$s.Arguments.Contains(${quote(data)})){throw 'Shortcut target mismatch'}
& ${quote(path.join(scripts,'uninstall-follow.ps1'))} -DataDir ${quote(data)}
if(Test-Path -LiteralPath ${quote(link)}){throw 'Shortcut not removed'}
`);
    const executable=path.join(process.env.WINDIR,'System32/WindowsPowerShell/v1.0/powershell.exe');
    const result=spawnSync(executable,['-NoLogo','-NoProfile','-NonInteractive','-File',harness],{encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,APPDATA:roaming}});
    if(foreign){
      assert.notEqual(result.status,0); assert.match(result.stderr,/another installation/);
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(data,'follow-config.json'),'utf8')),{enabled:true,sentinel:'keep'});
      assert.equal(await fs.access(path.join(data,'stop-called')).then(()=>true,()=>false),false);
    } else {
      assert.equal(result.status,0,result.stdout+result.stderr);
      assert.equal(JSON.parse((await fs.readFile(path.join(data,'follow-config.json'),'utf8')).replace(/^\uFEFF/,'' )).enabled,false);
    }
  });
}
