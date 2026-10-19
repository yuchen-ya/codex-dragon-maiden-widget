import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DATA_HOME, ROOT } from '../runtime/paths.mjs';

if (process.platform !== 'darwin') throw new Error('This smoke test requires macOS.');
const output = path.resolve(process.argv[2] || path.join(ROOT, 'qa-output', 'macos-smoke'));
fs.mkdirSync(output, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(output, 'data-'));
const executable = path.join(DATA_HOME, 'desktop-runtime/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
if (!fs.existsSync(executable)) throw new Error('Install the Electron runtime with scripts/install-desktop.mjs first.');
const cliScript = path.join(dataDir, 'quota-fixture.mjs');
fs.writeFileSync(cliScript, `import readline from 'node:readline';
for await (const line of readline.createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.id == null) continue;
  const result = message.method === 'initialize' ? {} : { rateLimits: { limitId: 'codex', primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: Math.floor(Date.now()/1000)+3600 } } };
  console.log(JSON.stringify({ id: message.id, result }));
}
`);
const cli = path.join(dataDir, 'quota-fixture.command');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
fs.writeFileSync(cli, '#!/bin/sh\nexec ' + quote(process.execPath) + ' ' + quote(cliScript) + ' "$@"\n', { mode: 0o700 });
const env = { ...process.env, WHALE_HOME: dataDir, CODEX_HOME: path.join(dataDir, 'codex'), CODEX_CLI: cli,
  WHALE_DESKTOP_TEST: '1', WHALE_MACOS_SMOKE: '1', WHALE_DESKTOP_VERIFY_DIR: output };
delete env.ELECTRON_RUN_AS_NODE;
const report = path.join(output, 'macos-desktop.json');
fs.rmSync(report, { force: true });
const child = spawn(executable, [path.join(ROOT, 'desktop/main.cjs'), '--whale-data=' + dataDir], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let diagnostic = '';
child.stdout.resume();
child.stderr.on('data', bytes => { diagnostic = (diagnostic + bytes).slice(-6000); });
const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
let code;
try { [code] = await once(child, 'close'); } finally { clearTimeout(timer); }
if (!fs.existsSync(report)) throw new Error('No macOS smoke report: ' + diagnostic);
const result = JSON.parse(fs.readFileSync(report, 'utf8'));
if (code !== 0 || !result.ok) throw new Error(JSON.stringify(result) + '\n' + diagnostic);
console.log(JSON.stringify(result, null, 2));
