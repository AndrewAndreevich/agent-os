const AGENT_STATUS = { ONLINE: 'online', OFFLINE: 'offline', BUSY: 'busy', IDLE: 'idle' };

const TASK_STATUS = {
  QUEUED: 'queued',
  DISPATCHED: 'dispatched',
  IN_PROGRESS: 'in_progress',
  SELFCHECK: 'selfcheck',
  QA_REVIEW: 'qa_review',
  QA_PASSED: 'qa_passed',
  NEED_REVIEW: 'need_review',
  DONE: 'done'
};

const QA_CHECK_TYPE = {
  RUN_SCRIPT: 'run_script',
  COMPILE: 'compile',
  FILE_EXISTS: 'file_exists',
  SCREENSHOT: 'screenshot',
  API_CHECK: 'api_check'
};

const CAPABILITIES = {
  BASE: 'base',
  BLENDER: 'blender',
  UNITY: 'unity',
  COMFYUI: 'comfyui',
  QGIS: 'qgis',
  PLAYWRIGHT: 'playwright',
  DOTNET: 'dotnet',
  MISSION_PLANNER: 'mission_planner'
};

const TOOLS = [
  { name: 'blender', capability: 'blender', version_cmd: 'blender --version' },
  { name: 'unity', capability: 'unity', version_cmd: 'unity -version' },
  { name: 'comfyui', capability: 'comfyui', version_cmd: 'python -c "import comfy; print(comfy.__version__)"' },
  { name: 'qgis', capability: 'qgis', version_cmd: 'qgis --version' },
  { name: 'playwright', capability: 'playwright', version_cmd: 'npx playwright --version' },
  { name: 'dotnet', capability: 'dotnet', version_cmd: 'dotnet --version' }
];

const WS_TYPES = {
  REGISTER: 'REGISTER',
  HEARTBEAT: 'HEARTBEAT',
  TASK_STARTED: 'TASK_STARTED',
  TASK_DONE: 'TASK_DONE',
  TASK_FAILED: 'TASK_FAILED',
  SELFCHECK_PASSED: 'SELFCHECK_PASSED',
  SELFCHECK_FAILED: 'SELFCHECK_FAILED',
  INSTALL_PROGRESS: 'INSTALL_PROGRESS',
  INSTALL_DONE: 'INSTALL_DONE',
  ASSIGN_TASK: 'ASSIGN_TASK',
  INSTALL_TOOL: 'INSTALL_TOOL',
  PING: 'PING',
  PONG: 'PONG',
  REGISTERED: 'REGISTERED',
  AGENT_STATUS_CHANGED: 'AGENT_STATUS_CHANGED',
  TASK_STATUS_CHANGED: 'TASK_STATUS_CHANGED',
  INSTALL_LOG: 'INSTALL_LOG',
  HEARTBEAT_UPDATE: 'HEARTBEAT_UPDATE'
};

module.exports = { AGENT_STATUS, TASK_STATUS, QA_CHECK_TYPE, CAPABILITIES, TOOLS, WS_TYPES };
