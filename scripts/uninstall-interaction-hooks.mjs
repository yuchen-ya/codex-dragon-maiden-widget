import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { CODEX_HOME, readJson, writeJson } from '../runtime/paths.mjs';

const file = path.join(CODEX_HOME, 'hooks.json');
if (fs.existsSync(file)) {
  const config = readJson(file);
  const script = fileURLToPath(new URL('./interaction-hook.mjs', import.meta.url));
  for (const [event, groups] of Object.entries(config.hooks)) {
    config.hooks[event] = groups.map(group => ({ ...group, hooks: group.hooks.filter(handler => !handler.command?.includes(`"${script}"`)) }))
      .filter(group => group.hooks.length);
    if (!config.hooks[event].length) delete config.hooks[event];
  }
  writeJson(file, config);
}
