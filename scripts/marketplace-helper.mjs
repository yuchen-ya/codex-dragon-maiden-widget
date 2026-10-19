// Personal-marketplace command helper. Changes only this plugin's entry.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const name = 'codex-dragon-maiden-widget';
const marketplace = path.join(os.homedir(), '.agents', 'plugins', 'marketplace.json');
const mode = process.argv[2];
const receiptPath = process.argv[3];
const entry = { name, source: { source: 'local', path: './plugins/codex-dragon-maiden-widget' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const raw = fs.existsSync(marketplace) ? fs.readFileSync(marketplace, 'utf8') : null;
const current = raw === null ? { name: 'personal', interface: { displayName: 'Personal' }, plugins: [] } : JSON.parse(raw.replace(/^\uFEFF/, ''));
if (!current || Array.isArray(current) || !/^[A-Za-z0-9_-]+$/.test(current.name) || !Array.isArray(current.plugins)) throw new Error('Invalid personal marketplace; no changes made.');
const matches = current.plugins.filter(p => p?.name === name);
if (matches.length > 1) throw new Error('Duplicate whale entries; no changes made.');
const previous = matches[0] ?? null;
const atomic = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, file); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
};
if (mode === 'inspect') {
  if (previous && (previous.source?.source !== 'local' || previous.source?.path !== entry.source.path)) throw new Error('The existing whale entry uses another source. Choose the existing installation explicitly before upgrading.');
  console.log(JSON.stringify({ marketplace, marketplaceName: current.name, previousEntry: previous }));
} else if (mode === 'install') {
  if (!receiptPath) throw new Error('A private backup receipt is required.');
  if (previous && (previous.source?.source !== 'local' || previous.source?.path !== entry.source.path)) throw new Error('Existing whale source differs; no changes made.');
  const saved = { marketplace, marketplaceName: current.name, previousEntry: previous, installedEntry: entry };
  atomic(receiptPath, saved);
  const i = current.plugins.findIndex(p => p?.name === name);
  if (i < 0) current.plugins.push(entry); else current.plugins[i] = entry;
  if ((fs.existsSync(marketplace) ? fs.readFileSync(marketplace, 'utf8') : null) !== raw) throw new Error('Marketplace changed concurrently; retry installation.');
  atomic(marketplace, current);
  console.log(current.name);
} else if (mode === 'restore' || mode === 'check-restore') {
  const saved = read(receiptPath);
  if (saved.marketplace !== marketplace || saved.marketplaceName !== current.name || saved.installedEntry?.name !== name) throw new Error('Backup marketplace identity mismatch.');
  if (JSON.stringify(previous) !== JSON.stringify(saved.installedEntry)) throw new Error('Whale marketplace entry changed since installation; refusing to overwrite it.');
  if (mode === 'check-restore') { console.log(current.name); process.exit(0); }
  const i = current.plugins.findIndex(p => p?.name === name);
  if (saved.previousEntry === null) current.plugins.splice(i, 1); else current.plugins[i] = saved.previousEntry;
  if (fs.readFileSync(marketplace, 'utf8') !== raw) throw new Error('Marketplace changed concurrently; retry rollback.');
  atomic(marketplace, current);
  console.log(current.name);
} else throw new Error('Usage: node marketplace-helper.mjs inspect|install|restore [private-receipt.json]');
