import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_HOME, readJson } from '../runtime/paths.mjs';
import { bridgeRequest } from '../runtime/bridge.mjs';

// Exercise only this companion's exit/recovery. Never close the user's Codex app.
const initialStatus = await bridgeRequest('/api/status');
assert.equal(initialStatus.visible, true, 'Companion must be visible before testing');
const initialWorker = readJson(path.join(DATA_HOME, 'supervisor-state.json'), {});
const initialWindow = readJson(path.join(DATA_HOME, 'runtime.json'), {});
assert.ok(initialWorker.pid && initialWindow.pid);
await bridgeRequest('/internal/host', { method: 'POST', body: { hostAlive: false }, timeoutMs: 3000 }).catch(() => {});
let status, runtime;
const started = Date.now();
while (Date.now() - started < 20000) {
  await new Promise(resolve => setTimeout(resolve, 300));
  try {
    runtime = readJson(path.join(DATA_HOME, 'runtime.json'), {});
    if (!runtime.pid || runtime.pid === initialWindow.pid) continue;
    status = await bridgeRequest('/api/status', { timeoutMs: 1500 });
    if (status.visible && status.hostPid === initialStatus.hostPid) break;
  } catch { }
}
assert.ok(status?.visible && runtime.pid !== initialWindow.pid, 'Companion did not automatically recover');
assert.equal(readJson(path.join(DATA_HOME, 'supervisor-state.json'), {}).pid, initialWorker.pid, 'Supervisor must survive its child exiting');
const report = { ok: true, hostPid: status.hostPid, supervisorPid: initialWorker.pid, oldCompanionPid: initialWindow.pid, newCompanionPid: runtime.pid, recoveryMs: Date.now() - started, visible: status.visible, supervisorSurvived: true, codexWasNotRestarted: true };
const destination = process.argv[2];
if (destination) { fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true }); fs.writeFileSync(destination, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report));
