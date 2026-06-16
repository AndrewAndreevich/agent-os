const registry = require('./registry');
const queue = require('./queue');
const dispatcher = require('./dispatcher');
const messages = require('../shared/messages');

const CHECK_INTERVAL_MS = 30 * 1000;
const OFFLINE_THRESHOLD_MS = 90 * 1000;

// Periodically sweep for agents whose last heartbeat is too old, mark
// them offline, and return any in-flight task to the queue.
function start() {
  return setInterval(() => {
    const stale = registry.getAgentsAfterOfflineSweep(OFFLINE_THRESHOLD_MS);
    for (const agent of stale) {
      const prevTask = registry.markOffline(agent.id);
      if (prevTask) {
        queue.requeue(prevTask);
        registry.broadcastToUI(messages.taskStatusChanged(prevTask, 'queued', null));
      }
      registry.broadcastToUI(messages.agentStatusChanged(agent.id, 'offline'));
      console.log(`[heartbeat] agent ${agent.id} marked offline`);
    }
    if (stale.length > 0) {
      // Freed-up tasks may now match other idle agents.
      dispatcher.tryDispatch();
    }
  }, CHECK_INTERVAL_MS);
}

module.exports = { start, OFFLINE_THRESHOLD_MS, CHECK_INTERVAL_MS };
