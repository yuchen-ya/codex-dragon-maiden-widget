'use strict';

// Close a companion even when its renderer has stopped answering. Each stage
// gets a bounded share of the overall deadline; the main-process state cache
// remains usable when reading the renderer fails.
async function shutdownCompanion(operations, { timeoutMs = 6000, rendererMs = 400, stateMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs, stages = [];
  async function run(name, operation, allowance = Infinity) {
    const remaining = Math.max(1, Math.min(allowance, deadline - Date.now()));
    let timer;
    const outcome = await Promise.race([
      Promise.resolve().then(operation).then(value => ({ status: 'complete', value }), () => ({ status: 'failed' })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ status: 'timeout' }), remaining); }),
    ]);
    clearTimeout(timer);
    stages.push({ name, status: outcome.status });
    return outcome;
  }
  const state = await run('renderer-state', operations.readRenderer, rendererMs);
  if (state.status === 'complete' && state.value != null) {
    try { operations.saveRenderer(state.value); } catch {}
  }
  await run('state-flush', operations.flushState, stateMs);
  await run('bridge-close', operations.closeBridge, 500);
  await run('service-close', operations.closeDispatcher);
  return { clean: stages.every(stage => stage.status === 'complete'), stages };
}

module.exports = { shutdownCompanion };
