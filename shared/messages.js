const { WS_TYPES } = require('./constants');

// Factory helpers that build well-formed protocol messages.
// Keeping construction centralized avoids typos in `type` fields across
// the server and client codebases.

// --- Client -> Server ---
const register = (agentId, role, capabilities, machineIp) => ({
  type: WS_TYPES.REGISTER,
  agent_id: agentId,
  role,
  capabilities: capabilities || [],
  machine_ip: machineIp || ''
});

const heartbeat = (agentId) => ({ type: WS_TYPES.HEARTBEAT, agent_id: agentId });

const taskStarted = (agentId, taskId) => ({
  type: WS_TYPES.TASK_STARTED,
  agent_id: agentId,
  task_id: taskId
});

const taskDone = (agentId, taskId, qaArtifactPath, qaCheckType, qaExpectedOutput) => ({
  type: WS_TYPES.TASK_DONE,
  agent_id: agentId,
  task_id: taskId,
  qa_artifact_path: qaArtifactPath || '',
  qa_check_type: qaCheckType || '',
  qa_expected_output: qaExpectedOutput || ''
});

const taskFailed = (agentId, taskId, error) => ({
  type: WS_TYPES.TASK_FAILED,
  agent_id: agentId,
  task_id: taskId,
  error: error || ''
});

const selfcheckPassed = (agentId, taskId) => ({
  type: WS_TYPES.SELFCHECK_PASSED,
  agent_id: agentId,
  task_id: taskId
});

const selfcheckFailed = (agentId, taskId, reason) => ({
  type: WS_TYPES.SELFCHECK_FAILED,
  agent_id: agentId,
  task_id: taskId,
  reason: reason || ''
});

const installProgress = (agentId, tool, logLine) => ({
  type: WS_TYPES.INSTALL_PROGRESS,
  agent_id: agentId,
  tool,
  log_line: logLine
});

const installDone = (agentId, tool, success) => ({
  type: WS_TYPES.INSTALL_DONE,
  agent_id: agentId,
  tool,
  success: !!success
});

// --- Server -> Client ---
const assignTask = (taskId, title, contract, role, paths, feedback) => ({
  type: WS_TYPES.ASSIGN_TASK,
  task_id: taskId,
  title: title || '',
  contract: contract || {},
  role: role || '',
  paths: paths || {},
  feedback: feedback || ''
});

const installTool = (tool, script) => ({
  type: WS_TYPES.INSTALL_TOOL,
  tool,
  script
});

const ping = () => ({ type: WS_TYPES.PING });
const pong = () => ({ type: WS_TYPES.PONG });

const registered = (agentId, config) => ({
  type: WS_TYPES.REGISTERED,
  agent_id: agentId,
  config: config || {}
});

// --- Server -> UI ---
const agentStatusChanged = (agentId, status) => ({
  type: WS_TYPES.AGENT_STATUS_CHANGED,
  agent_id: agentId,
  status
});

const taskStatusChanged = (taskId, status, agentId) => ({
  type: WS_TYPES.TASK_STATUS_CHANGED,
  task_id: taskId,
  status,
  agent_id: agentId || null
});

const installLog = (agentId, tool, logLine) => ({
  type: WS_TYPES.INSTALL_LOG,
  agent_id: agentId,
  tool,
  log_line: logLine
});

const heartbeatUpdate = (agentId, timestamp) => ({
  type: WS_TYPES.HEARTBEAT_UPDATE,
  agent_id: agentId,
  timestamp
});

module.exports = {
  register,
  heartbeat,
  taskStarted,
  taskDone,
  taskFailed,
  selfcheckPassed,
  selfcheckFailed,
  installProgress,
  installDone,
  assignTask,
  installTool,
  ping,
  pong,
  registered,
  agentStatusChanged,
  taskStatusChanged,
  installLog,
  heartbeatUpdate
};
