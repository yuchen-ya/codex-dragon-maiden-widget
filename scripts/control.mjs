import { ensureService, serviceRequest, runningService, launchDesktop } from '../runtime/process.mjs';
import { DATA_HOME } from '../runtime/paths.mjs';

const command = process.argv[2] || 'open';
try {
  let result;
  if (command === 'open') result = await launchDesktop();
  else if (command === 'desktop') result = await launchDesktop({ mode: 'standalone' });
  else if (command === 'follow') result = await launchDesktop({ mode: 'follow-codex' });
  else if (command === 'reset-position') { await ensureService(); result = await serviceRequest('/api/reset-position', {method:'POST',body:{}}); }
  else if (command === 'quota') result = await serviceRequest('/api/insights' + (process.argv.includes('--refresh') ? '?refresh=1' : ''));
  else if (command === 'usage') result = await serviceRequest('/dsh-whale/usage-records.json');
  else if (command === 'status') result = await serviceRequest('/api/status');
  else if (command === 'stop') { const running = await runningService(DATA_HOME); result = running ? await serviceRequest('/api/stop', { method: 'POST', body: {} }) : { ok: true, stopped: true }; }
  else throw new Error('支持 open、desktop、follow、reset-position、quota、usage、status、stop');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.ok === false) process.exitCode = 1;
} catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
