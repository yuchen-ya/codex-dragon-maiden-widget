import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DATA_HOME } from '../runtime/paths.mjs';
import { restoreMacLaunchAgent } from './macos-backup.mjs';
if (process.platform !== 'darwin') throw new Error('This rollback is only for macOS');
const receiptFile = process.argv[2] || path.join(DATA_HOME, 'macos-rollback-receipt.json');
const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
if (receipt.version !== 1 || !path.isAbsolute(receipt.backupDir)) throw new Error('Invalid rollback receipt');
const configFile = path.join(DATA_HOME, 'follow-config.json');
let current = {}; try { current = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch {}
const domain = 'gui/' + process.getuid();
const run = (args, allowFailure = false) => { const result = spawnSync('/bin/launchctl', args, { encoding: 'utf8' }); if (!allowFailure && result.status !== 0) throw new Error(result.stderr || 'launchctl failed'); return result; };
const service = domain + '/' + (current.label || 'com.codex-dragon-maiden-widget.codex');
if (run(['print', service], true).status === 0) {
 run(['bootout', service]);
 for (let i = 0; i < 30 && run(['print', service], true).status === 0; i++) await new Promise(resolve => setTimeout(resolve, 200));
 if (run(['print', service], true).status === 0) throw new Error('Current LaunchAgent did not stop');
}
if (!receipt.hadInstall) {
 fs.writeFileSync(configFile, JSON.stringify({ ...current, enabled: false }, null, 2));
 restoreMacLaunchAgent({ receipt, current, domain, run });
 process.stdout.write('No previous installation: automatic following disabled. All settings and usage records retained.\n');
} else {
 const previous = receipt.previous;
 if (previous?.pluginRoot && !fs.existsSync(previous.pluginRoot) && receipt.sourceBackup && fs.existsSync(receipt.sourceBackup)) fs.cpSync(receipt.sourceBackup, previous.pluginRoot, { recursive: true, errorOnExist: true, force: false });
 if (!previous?.pluginRoot || !fs.existsSync(path.join(previous.pluginRoot, 'desktop', 'macos', 'supervisor.mjs'))) throw new Error('Previous code directory is missing. Restore previous-plugin from the backup to the original pluginRoot before retrying.');
 for (const name of ['follow-config.json', 'follow-install.json', 'pause-until-host-exit.json']) {
  const backup = path.join(receipt.backupDir, name), target = path.join(DATA_HOME, name);
  if (fs.existsSync(backup)) fs.copyFileSync(backup, target); else if (fs.existsSync(target)) fs.unlinkSync(target);
 }
 const probe = path.join(receipt.backupDir, 'window-probe');
 if (previous.probePath && fs.existsSync(probe)) { fs.copyFileSync(probe, previous.probePath); fs.chmodSync(previous.probePath, 0o755); }
 restoreMacLaunchAgent({ receipt, current, domain, run });
 process.stdout.write('Previous operational configuration restored. Latest balance history, token records, settings and custom assets retained.\n');
}
