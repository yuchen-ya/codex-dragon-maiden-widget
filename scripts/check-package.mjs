import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {verifyReleaseMetadata} from './release-metadata.mjs';
const version=verifyReleaseMetadata();
for (const name of ['dragon-maiden-bust-v1.png', 'dragon-maiden-bust-v1-a.png']) {
  if (!fs.existsSync(fileURLToPath(new URL('../assets/' + name, import.meta.url)))) throw new Error('Approved character image missing: ' + name);
}
for(const name of ['../vendor/smol-toml/dist/index.js','../desktop/main.cjs','../desktop/ui/widget.html','../desktop/ui/gesture.js','../desktop/ui/audio-engine.js','../desktop/ui/insights.js','../desktop/ui/workshop.js','../assets/dragon-maiden-bust-v1.png']) {
  if(!fs.existsSync(fileURLToPath(new URL(name,import.meta.url))))throw new Error('Package dependency missing: '+name);
}
if(!fs.existsSync(fileURLToPath(new URL('../desktop/ui/account-view.js',import.meta.url))))throw new Error('Account view module is missing');
if(!fs.existsSync(fileURLToPath(new URL('../desktop/ui/shape.js',import.meta.url))))throw new Error('Window region module is missing');
if(!fs.existsSync(fileURLToPath(new URL('../desktop/ui/dragon-maiden-quotes.js',import.meta.url))))throw new Error('Character quotes are missing');
if(!fs.existsSync(fileURLToPath(new URL('../desktop/ui/account-notices.js',import.meta.url))))throw new Error('Account notification UI is missing');
if(!fs.existsSync(fileURLToPath(new URL('../runtime/account-notices.mjs',import.meta.url))))throw new Error('Account notification ledger is missing');
for (const name of ['../runtime/interaction-notices.mjs', '../desktop/ui/interaction-notices.js', '../scripts/interaction-hook.mjs']) {
  if (!fs.existsSync(fileURLToPath(new URL(name, import.meta.url)))) throw new Error('Interaction reminder dependency missing: ' + name);
}
await import('../runtime/dispatcher.mjs');
for (const name of ['scripts/macos-launcher.command', 'scripts/install-macos.mjs', 'desktop/macos/supervisor.mjs', 'desktop/macos/window-probe.swift']) {
  if (!fs.existsSync(fileURLToPath(new URL('../' + name, import.meta.url)))) throw new Error('macOS dependency missing: ' + name);
}
await import('../runtime/process.mjs');
process.stdout.write('Package v' + version + ' metadata and dependency graph are complete.\n');
