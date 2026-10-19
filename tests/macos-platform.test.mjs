import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../runtime/paths.mjs';
import { pipeName, startBridge, bridgeRequest } from '../runtime/bridge.mjs';
import { findCodexCli } from '../runtime/codex-quota.mjs';
import { restoreMacLaunchAgent } from '../scripts/macos-backup.mjs';

for (const scenario of ['fresh', 'disabled-without-plist', 'disabled-with-plist', 'enabled']) {
  test('Mac rollback restores login startup state: ' + scenario, t => {
    const qa = path.join(ROOT, 'qa-output');
    fs.mkdirSync(qa, { recursive: true });
    const directory = fs.mkdtempSync(path.join(qa, 'mac-rollback-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const plistPath = path.join(directory, 'launchagent.plist');
    const backupDir = path.join(directory, 'backup'); fs.mkdirSync(backupDir);
    fs.writeFileSync(plistPath, 'new agent');
    if (['disabled-with-plist', 'enabled'].includes(scenario)) fs.writeFileSync(path.join(backupDir, 'LaunchAgent.plist'), 'previous agent');
    const calls = [], label = 'com.codex-dragon-maiden-widget.test';
    const receipt = { hadInstall: scenario !== 'fresh', backupDir, plistPath, previous: { label, enabled: scenario === 'enabled' } };
    restoreMacLaunchAgent({ receipt, current: { label, launchAgentPath: plistPath }, domain: 'gui/123', run: args => calls.push(args) });
    if (scenario === 'enabled') assert.deepEqual(calls, [['enable', 'gui/123/' + label], ['bootstrap', 'gui/123', plistPath], ['kickstart', 'gui/123/' + label]]);
    else assert.deepEqual(calls, [['disable', 'gui/123/' + label]]);
    if (['fresh', 'disabled-without-plist'].includes(scenario)) assert.equal(fs.existsSync(plistPath), false);
    else assert.equal(fs.readFileSync(plistPath, 'utf8'), 'previous agent');
  });
}

test('Mac CLI discovery skips directories and accepts executable bundles in spaced app paths', { skip: process.platform !== 'darwin' }, t => {
  const qa = path.join(ROOT, 'qa-output');
  fs.mkdirSync(qa, { recursive: true });
  const directory = fs.mkdtempSync(path.join(qa, 'mac-cli-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const application = path.join(directory, 'Codex Test.app');
  const resource = path.join(application, 'Contents/Resources/codex-cli');
  fs.mkdirSync(resource, { recursive: true });
  assert.notEqual(findCodexCli({ WHALE_CODEX_APP_PATH: application }, 'darwin'), resource);
  const binary = path.join(resource, 'CodexCLI.app/Contents/MacOS/codex');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  assert.equal(findCodexCli({ WHALE_CODEX_APP_PATH: application }, 'darwin'), binary);
});

test('Mac IPC accepts long Unicode data paths, isolates instances and authenticates requests', { skip: process.platform !== 'darwin' }, async t => {
  const qa = path.join(ROOT, 'qa-output');
  fs.mkdirSync(qa, { recursive: true });
  const directory = fs.mkdtempSync(path.join(qa, 'mac-ipc-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const dataDir = path.join(directory, '中文带空格的数据目录 '.repeat(6));
  const otherDir = dataDir + '-other';
  fs.mkdirSync(dataDir);
  fs.mkdirSync(otherDir);
  assert.ok(Buffer.byteLength(pipeName(dataDir)) < 104);
  assert.notEqual(pipeName(dataDir), pipeName(dataDir.toUpperCase()));
  const dispatcher = { dispatch: async () => ({ status: 200, body: Buffer.from('{"ok":true}') }) };
  const first = await startBridge(dispatcher, { dataDir });
  const second = await startBridge(dispatcher, { dataDir: otherDir });
  t.after(async () => { await first.close(); await second.close(); });
  assert.notEqual(first.pipe, second.pipe);
  assert.equal(fs.statSync(path.dirname(first.pipe)).mode & 0o777, 0o700);
  assert.equal(fs.statSync(first.pipe).mode & 0o777, 0o600);
  assert.equal((await bridgeRequest('/api/status', { dataDir })).ok, true);
  assert.equal((await bridgeRequest('/api/status', { dataDir, runtime: { ...first, token: second.token } })).ok, false);
  await assert.rejects(startBridge(dispatcher, { dataDir }), /already listening/);
});

test('Finder launcher supports an explicit Node 24 path and preserves spaced arguments', { skip: process.platform !== 'darwin' }, t => {
  const qa = path.join(ROOT, 'qa-output');
  fs.mkdirSync(qa, { recursive: true });
  const directory = fs.mkdtempSync(path.join(qa, 'mac-launcher-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const interpreter = path.join(directory, 'Node with spaces');
  fs.symlinkSync(process.execPath, interpreter);
  const result = spawnSync('/bin/zsh', [path.join(ROOT, 'scripts/macos-launcher.command'), '-e', 'console.log(JSON.stringify(process.argv.slice(1)))', 'argument with spaces', '$literal'], {
    env: { PATH: '/usr/bin:/bin', HOME: directory, WHALE_NODE_BIN: interpreter }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ['argument with spaces', '$literal']);
  const oldNode = path.join(directory, 'old-node');
  fs.writeFileSync(oldNode, '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  fs.symlinkSync(process.execPath, path.join(directory, 'node'));
  const fallback = spawnSync('/bin/zsh', [path.join(ROOT, 'scripts/macos-launcher.command'), '--version'], {
    env: { PATH: directory + ':/usr/bin:/bin', HOME: directory, WHALE_NODE_BIN: oldNode }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(fallback.status, 0, fallback.stderr);
  assert.equal(fallback.stdout.trim(), process.version);
});
