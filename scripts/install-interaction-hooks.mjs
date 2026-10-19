import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODEX_HOME, DATA_HOME, readJson, writeJson } from '../runtime/paths.mjs';

export function interactionHooks({ node = process.execPath, script = fileURLToPath(new URL('./interaction-hook.mjs', import.meta.url)), dataDir = DATA_HOME } = {}) {
  for (const value of [node, script, dataDir]) if (!path.isAbsolute(value) || /["\r\n]/.test(value)) throw new Error('Hook paths must be absolute and contain no quotes');
  const invoke = process.platform === 'win32' ? '& ' : '';
  const handler = { type: 'command', command: `${invoke}"${node}" "${script}" --data-dir "${dataDir}"`, timeout: 3 };
  return {
    PreToolUse: [{ matcher: '(?:^|[.:/])request_user_input(?:_async)?$', hooks: [handler] }],
    PermissionRequest: [{ hooks: [handler] }],
    PostToolUse: [{ matcher: '^(?:Bash|apply_patch|mcp__.*|(?:.*[.:/])?request_user_input(?:_async)?)$', hooks: [handler] }],
    Stop: [{ hooks: [handler] }], Interrupt: [{ hooks: [handler] }],
    SessionEnd: [{ hooks: [handler] }], UserPromptSubmit: [{ hooks: [handler] }]
  };
}

export function installInteractionHooks({ codexHome = CODEX_HOME, dataDir = DATA_HOME, node = process.execPath } = {}) {
  const file = path.join(codexHome, 'hooks.json'), config = readJson(file, { hooks: {} });
  if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) throw new Error('Invalid hooks.json');
  const additions = interactionHooks({ dataDir, node });
  const script = fileURLToPath(new URL('./interaction-hook.mjs', import.meta.url));
  for (const [event, entries] of Object.entries(additions)) {
    const groups = config.hooks[event] || [];
    if (!Array.isArray(groups)) throw new Error('Invalid hook event groups');
    config.hooks[event] = groups.map(group => ({ ...group, hooks: group.hooks.filter(handler => !handler.command?.includes(`"${script}"`)) }))
      .filter(group => group.hooks.length).concat(entries);
  }
  writeJson(file, config);
  return file;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--data-dir')) throw new Error('Usage: install-interaction-hooks.mjs [--data-dir PATH]');
  const file = installInteractionHooks({ dataDir: args[1] ? path.resolve(args[1]) : DATA_HOME });
  process.stdout.write(`已写入 ${file}\n请在 Codex 的 Hooks 界面信任这组提醒 Hook；不改变审批策略。\n`);
}
