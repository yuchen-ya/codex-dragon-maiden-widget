import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ROOT, DATA_HOME, readJson } from '../runtime/paths.mjs';

const output = path.resolve(process.argv[2] || path.join(ROOT, 'qa-output'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-follow-test-'));
const executable = path.join(DATA_HOME, 'desktop-runtime', 'node_modules', 'electron', 'dist', 'electron.exe');
const env = { ...process.env, WHALE_DESKTOP_TEST: '1', WHALE_DESKTOP_VERIFY_DIR: output, WHALE_TEST_POWERSHELL: process.env.WHALE_TEST_POWERSHELL || readJson(path.join(DATA_HOME, 'follow-config.json'), {}).powerShellPath || 'powershell.exe' };
delete env.ELECTRON_RUN_AS_NODE;
const scale = process.env.WHALE_TEST_SCALE;
if (scale && !['1', '1.25', '1.5', '2'].includes(scale)) throw new Error('Unsupported fixture display scale');
const child = spawn(executable, [path.join(ROOT, 'desktop', 'main.cjs'), '--whale-data=' + dataDir, ...(scale ? ['--force-device-scale-factor=' + scale] : [])], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let diagnostic = ''; child.stderr.on('data', d => { diagnostic += d; }); child.stdout.resume();
const timer = setTimeout(() => child.kill(), 180000);
const [code] = await once(child, 'close'); clearTimeout(timer);
const report = path.join(output, 'desktop-follow.json');
if (!fs.existsSync(report)) throw new Error('Desktop test did not produce a report: ' + diagnostic.slice(-2200) + ' data=' + dataDir + ' ' + (fs.existsSync(path.join(dataDir,'desktop-error.json')) ? fs.readFileSync(path.join(dataDir,'desktop-error.json'),'utf8') : ''));
const result = JSON.parse(fs.readFileSync(report, 'utf8'));
assert.equal(code, 0, JSON.stringify(result)); assert.equal(result.ok, true);
console.log(JSON.stringify(result));
// Keep the isolated fixture with the QA report for debugging; it contains only test data.
