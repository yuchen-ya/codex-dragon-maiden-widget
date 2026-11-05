import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {verifyReleaseMetadata} from './release-metadata.mjs';
const version=verifyReleaseMetadata();
for (const name of ['dragon-maiden-bust-v1.png', 'dragon-maiden-bust-v1-a.png', 'dragon-maiden-tail-v1.png']) {
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
for (const name of ['../runtime/interaction-notices.mjs', '../runtime/approval-context.mjs', '../desktop/ui/interaction-notices.js', '../scripts/interaction-hook.mjs']) {
  if (!fs.existsSync(fileURLToPath(new URL(name, import.meta.url)))) throw new Error('Interaction reminder dependency missing: ' + name);
}
await import('../runtime/approval-context.mjs');
await import('../runtime/dispatcher.mjs');
if (!fs.existsSync(fileURLToPath(new URL('../desktop/ui/jev-settings.js', import.meta.url)))) throw new Error('Jev settings UI is missing');
for (const file of ['../desktop/ui/reaction-notices.js', '../assets/dialogue-library.json', '../lib/dialogue-core.cjs', '../desktop/ui/dialogue.js', '../desktop/ui/collapse.js', '../desktop/ui/tail-mesh.js']) {
  if (!fs.existsSync(fileURLToPath(new URL(file, import.meta.url)))) throw new Error('Reaction dependency is missing: ' + file);
}
for (const file of ['dragon-maiden-hide-v7.webp', 'dragon-maiden-appear-v7.webp', 'dragon-maiden-tail-hide-v8.webp', 'dragon-maiden-tail-appear-v8.webp', 'dragon-maiden-tail-v1.png']) {
  if (!fs.existsSync(fileURLToPath(new URL('../assets/' + file, import.meta.url)))) throw new Error('Collapse animation asset is missing: ' + file);
}
const tailTrack = JSON.parse(fs.readFileSync(new URL('../assets/dragon-maiden-tail-motion-v8.json', import.meta.url), 'utf8'));
for (const action of ['hide', 'appear']) {
  if (tailTrack[action].length !== 56 || tailTrack[action].some(point => point.length !== 2 || point.some(value => !Number.isFinite(value)))) throw new Error('Invalid tail motion track');
}
await import('../runtime/model-usage.mjs');
await import('../runtime/generation-metrics.mjs');
if (!fs.existsSync(fileURLToPath(new URL('../vendor/codex-usage-dashboard/LICENSE', import.meta.url)))) throw new Error('Usage dashboard license is missing');
for (const name of ['scripts/macos-launcher.command', 'scripts/install-macos.mjs', 'desktop/macos/supervisor.mjs', 'desktop/macos/window-probe.swift']) {
  if (!fs.existsSync(fileURLToPath(new URL('../' + name, import.meta.url)))) throw new Error('macOS dependency missing: ' + name);
}
await import('../runtime/process.mjs');
process.stdout.write('Package v' + version + ' metadata and dependency graph are complete.\n');
