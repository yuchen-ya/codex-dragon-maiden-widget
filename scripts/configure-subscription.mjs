import { ConfigStore } from '../runtime/config.mjs';

new ConfigStore().save({ provider: 'none' });
process.stdout.write('Codex subscription quota enabled; API balance queries disabled.\n');
