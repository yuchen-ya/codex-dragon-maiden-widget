import { parentPort, workerData } from 'node:worker_threads';
import { SessionReader } from './session-monitor.mjs';
import { acceptInteractionHook } from './interaction-notices.mjs';

let enabled = workerData.enabled !== false, initial = true, events = [], rootEnds = [];
let recoveryReported = false;
const reader = new SessionReader({ ...workerData,
  onStart: meta => events.push({ type: 'start', meta }),
  onEnd: meta => events.push({ type: 'end', meta }),
  onUpdate: meta => events.push({ type: 'update', meta }),
  onInteraction: input => { if (workerData.interactionDataDir) acceptInteractionHook(workerData.interactionDataDir, input); },
});
function tick() {
  events = [];
  if (enabled) { reader.tick(initial); initial = false; }
  // Child records precede root endings discovered in the same scan, so the
  // final estimate can include each child's independently recorded usage.
  rootEnds.push(...events.filter(x => x.type === 'end' && !x.meta.isSubagent));
  const endingIds = new Set(events.filter(x => x.type === 'end').map(x => x.meta.id));
  const latestUpdates = new Map(events.filter(x => x.type === 'update').map(x => [x.meta.id, x]));
  const rest = events.filter(x => (x.type !== 'end' || x.meta.isSubagent) &&
    (x.type !== 'update' || (!endingIds.has(x.meta.id) && latestUpdates.get(x.meta.id) === x)));
  const status = reader.status();
  const recoveryComplete = enabled && !initial && !status.error && !status.catchingUp && !recoveryReported;
  if (recoveryComplete) recoveryReported = true;
  parentPort.postMessage({ status, recoveryComplete, events: status.catchingUp ? rest : [...rest, ...rootEnds] });
  if (!status.catchingUp) rootEnds = [];
  else if (enabled) setImmediate(tick);
}
parentPort.on('message', state => { enabled = state.enabled !== false; reader.defaultModel = state.defaultModel || ''; });
tick();
setInterval(tick, workerData.intervalMs).unref();
