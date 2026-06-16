require('dotenv').config();

const Connection = require('./connection');
const session = require('./session');
const executor = require('./executor');
const selfcheck = require('./selfcheck');
const reporter = require('./reporter');
const Installer = require('./installer');
const git = require('./git');

const { WS_TYPES } = require('../shared/constants');
const { CLAUDE_PATH, CLAUDE_AVAILABLE } = require('../shared/claude-path');

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'ws://localhost:3000/ws';
const AGENT_ID = process.env.AGENT_ID || 'agent-1';
const AGENT_ROLE = process.env.AGENT_ROLE || 'dev';
const CAPABILITIES = (process.env.CAPABILITIES || 'base')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const connection = new Connection(ORCHESTRATOR_URL);
const installer = new Installer(connection, AGENT_ID);

reporter.attach(connection, AGENT_ID);

let heartbeatTimer = null;
let busy = false;

connection.onOpen(() => {
  // Register on every (re)connect.
  connection.send({
    type: WS_TYPES.REGISTER,
    agent_id: AGENT_ID,
    role: AGENT_ROLE,
    capabilities: CAPABILITIES,
    machine_ip: getLocalIp(),
    claude_path: CLAUDE_PATH,
    claude_available: CLAUDE_AVAILABLE
  });

  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    connection.send({ type: WS_TYPES.HEARTBEAT, agent_id: AGENT_ID });
  }, 20 * 1000);
});

connection.onMessage(async (msg) => {
  switch (msg.type) {
    case WS_TYPES.REGISTERED:
      console.log(`[client] registered as ${AGENT_ID} (${AGENT_ROLE})`);
      break;

    case WS_TYPES.PING:
      connection.send({ type: WS_TYPES.PONG, agent_id: AGENT_ID });
      break;

    case WS_TYPES.ASSIGN_TASK:
      await handleTask(msg);
      break;

    case WS_TYPES.INSTALL_TOOL:
      installer.receive(msg.tool, msg.script);
      break;

    default:
      break;
  }
});

async function handleTask(taskMsg) {
  if (busy) {
    console.log('[client] received task while busy; ignoring');
    return;
  }
  busy = true;

  console.log(`[client] task assigned: ${taskMsg.task_id} — ${taskMsg.title}`);
  session.setTask(taskMsg);
  if (taskMsg.selfcheck) session.setSelfcheckConfig(taskMsg.selfcheck);

  // Mark the moment the agent received the assignment.
  reporter.workflowEvent('task_received', { task_id: taskMsg.task_id, title: taskMsg.title });

  connection.send({
    type: WS_TYPES.TASK_STARTED,
    agent_id: AGENT_ID,
    task_id: taskMsg.task_id
  });

  try {
    // Prepare a working branch for the task.
    try {
      git.setup();
      git.createBranch(taskMsg.task_id, taskMsg.role || AGENT_ROLE);
    } catch (e) {
      console.log('[client] git branch setup skipped:', e.message);
    }

    // Run the task via the claude CLI using a persistent session.
    reporter.workflowEvent('implementation_started', {});
    const result = await new Promise((resolve) => {
      executor.run(
        {
          id: taskMsg.task_id,
          title: taskMsg.title,
          contract: taskMsg.contract,
          paths: taskMsg.paths,
          feedback: taskMsg.feedback,
          qa_artifact_path: (taskMsg.paths && taskMsg.paths.artifact) || '',
          qa_expected_output: (taskMsg.contract && taskMsg.contract.done_when) || '',
          session_id: taskMsg.session_id,
          resumed: false
        },
        session.getPrompt(),
        (chunk) => reporter.logLine(chunk),
        (done) => resolve({ success: true, output: done.output }),
        (err) => resolve({ success: false, output: err })
      );
    });
    reporter.workflowEvent('implementation_done', { success: result.success });

    // Run self-validation against the task contract (config-aware, async).
    // selfcheck.js emits its own per-attempt selfcheck_running / passed /
    // escalated workflow events.
    const check = await selfcheck.run({
      qa_check_type: taskMsg.contract && taskMsg.contract.qa_check_type,
      qa_artifact_path: (taskMsg.paths && taskMsg.paths.artifact) || '',
      contract: taskMsg.contract,
      paths: taskMsg.paths
    });

    if (check.pass) {
      connection.send({
        type: WS_TYPES.SELFCHECK_PASSED,
        agent_id: AGENT_ID,
        task_id: taskMsg.task_id
      });
    } else {
      connection.send({
        type: WS_TYPES.SELFCHECK_FAILED,
        agent_id: AGENT_ID,
        task_id: taskMsg.task_id,
        reason: check.reason
      });
    }

    try {
      git.commitAll(`task ${taskMsg.task_id}: ${taskMsg.title}`);
    } catch (e) {
      console.log('[client] commit skipped:', e.message);
    }

    if (result.success) {
      connection.send({
        type: WS_TYPES.TASK_DONE,
        agent_id: AGENT_ID,
        task_id: taskMsg.task_id,
        qa_artifact_path: (taskMsg.paths && taskMsg.paths.artifact) || '',
        qa_check_type: (taskMsg.contract && taskMsg.contract.qa_check_type) || '',
        qa_expected_output: (taskMsg.contract && taskMsg.contract.done_when) || ''
      });
    } else {
      connection.send({
        type: WS_TYPES.TASK_FAILED,
        agent_id: AGENT_ID,
        task_id: taskMsg.task_id,
        error: (result.output || '').slice(-1000)
      });
    }
  } catch (err) {
    connection.send({
      type: WS_TYPES.TASK_FAILED,
      agent_id: AGENT_ID,
      task_id: taskMsg.task_id,
      error: err.message
    });
  } finally {
    session.clear();
    busy = false;
  }
}

function getLocalIp() {
  const os = require('os');
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

connection.connect();

console.log(`[client] starting ${AGENT_ID} -> ${ORCHESTRATOR_URL}`);
console.log(`[client] claude: ${CLAUDE_PATH} (available: ${CLAUDE_AVAILABLE})`);
