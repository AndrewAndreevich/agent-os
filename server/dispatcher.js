const registry = require('./registry');
const queue = require('./queue');
const timetracker = require('./timetracker');
const scheduler = require('./scheduler');
const workflow = require('./workflow');
const messages = require('../shared/messages');
const { TASK_STATUS } = require('../shared/constants');

// Role file paths handed to the agent so it can locate its workspace.
function buildPaths(task) {
  return {
    workspace: process.env.WORKSPACE_PATH || './workspace',
    artifact: task.qa_artifact_path || ''
  };
}

// Attempt to match queued tasks to idle agents. Called whenever an
// agent becomes idle or a new task is enqueued. Loops so a single call
// can dispatch multiple ready pairs.
function tryDispatch() {
  let dispatched = 0;

  // Keep dispatching until no more matches are possible in one sweep.
  // We rebuild the idle pool each iteration since markBusy mutates it.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Only consider agents that are idle AND currently inside a work window
    // (agents with no schedule, or a disabled one, are always available).
    const idle = registry
      .getIdleAgents()
      .filter((agent) => scheduler.checkAgentSchedule(agent.id));
    if (idle.length === 0) break;

    let assignedThisRound = false;

    for (const agent of idle) {
      // Skip agents whose socket is not open — a dead/closing connection
      // can't receive an ASSIGN_TASK, so the task must stay queued.
      if (!agent.ws || agent.ws.readyState !== 1) continue;

      // Find a queued task this agent can handle.
      const task = queue.peek(agent.capabilities || []);
      if (!task) continue;

      // Reserve the task and mark the agent busy.
      queue.setStatus(task.id, TASK_STATUS.DISPATCHED, agent.id);
      registry.markBusy(agent.id, task.id);

      db_markStarted(task.id);

      // Ensure the task has a session_id (UUID) so the agent can resume it.
      if (!task.session_id) {
        const { randomUUID } = require('crypto');
        const sid = randomUUID();
        const db = require('./db');
        db.prepare('UPDATE tasks SET session_id = ? WHERE id = ?').run(sid, task.id);
        task.session_id = sid;
      }

      const msg = messages.assignTask(
        task.id,
        task.title,
        task.contract || {},
        agent.role,
        buildPaths(task),
        task.feedback || ''
      );
      msg.session_id = task.session_id;
      // Attach the agent's self-check controls so the client can honor them.
      msg.selfcheck = scheduler.getAgentSelfcheckConfig(agent.id);

      sendToAgent(agent, msg);
      timetracker.startTimer(task.id, agent.id);

      // Record the start of work in the workflow event log.
      workflow.logEvent(task.id, agent.id, 'task_started', { title: task.title });

      registry.broadcastToUI(
        messages.taskStatusChanged(task.id, TASK_STATUS.DISPATCHED, agent.id)
      );
      registry.broadcastToUI(messages.agentStatusChanged(agent.id, 'busy'));

      dispatched++;
      assignedThisRound = true;
      break; // restart sweep with fresh idle pool
    }

    if (!assignedThisRound) break;
  }

  return dispatched;
}

function sendToAgent(agent, msg) {
  const ws = agent.ws || (registry.getAgent(agent.id) || {}).ws;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
  }
}

function db_markStarted(taskId) {
  const db = require('./db');
  db.prepare(`UPDATE tasks SET started_at = ? WHERE id = ? AND started_at IS NULL`)
    .run(Date.now(), taskId);
}

module.exports = { tryDispatch };
