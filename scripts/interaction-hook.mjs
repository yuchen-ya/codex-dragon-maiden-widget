import { acceptInteractionHook } from '../runtime/interaction-notices.mjs';
import { DATA_HOME } from '../runtime/paths.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--data-dir')) throw new Error('Usage: interaction-hook.mjs [--data-dir PATH]');
let input = '';
try {
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 1024 * 1024) throw new Error('Hook input is too large');
  }
  acceptInteractionHook(args[1] || DATA_HOME, JSON.parse(input));
  // Empty stdout is deliberate: this hook never approves, denies or rewrites.
} catch {
  process.stderr.write('小龙娘提醒未能记录本次事件，请检查挂件数据目录。\n');
  process.exitCode = 1;
}
