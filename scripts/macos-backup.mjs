import fs from 'node:fs';
import path from 'node:path';
export function backupMacInstall({ dataDir, pluginRoot, plistPath, installId }) {
  const backupDir = path.join(dataDir, 'backups', 'macos-' + installId);
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const operational = ['follow-config.json', 'follow-install.json', 'pause-until-host-exit.json'];
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(path.join(dataDir, 'follow-config.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const name of operational) { const source = path.join(dataDir, name); if (fs.existsSync(source)) fs.copyFileSync(source, path.join(backupDir, name)); }
  const oldPlist = previous?.launchAgentPath || plistPath;
  if (fs.existsSync(oldPlist)) fs.copyFileSync(oldPlist, path.join(backupDir, 'LaunchAgent.plist'));
  if (previous?.probePath && fs.existsSync(previous.probePath)) fs.copyFileSync(previous.probePath, path.join(backupDir, 'window-probe'));
  let sourceBackup = null;
  if (previous?.pluginRoot && path.resolve(previous.pluginRoot) !== path.resolve(pluginRoot) && fs.existsSync(previous.pluginRoot)) {
    sourceBackup = path.join(backupDir, 'previous-plugin');
    const excluded = new Set(['node_modules', '.git', 'qa', 'references']);
    fs.cpSync(previous.pluginRoot, sourceBackup, { recursive: true, filter: source => !excluded.has(path.basename(source)) });
  }
  const receipt = { version: 1, installId, createdAt: new Date().toISOString(), backupDir, previous, sourceBackup, plistPath: oldPlist, operational, hadInstall: !!previous };
  fs.writeFileSync(path.join(backupDir, 'receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'macos-rollback-receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
  return receipt;
}
