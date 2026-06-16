// Reports task progress back to YouTrack and streams log lines to the
// orchestrator. Uses a lightweight inline YouTrack client so the file
// works standalone on agent machines.

const YOUTRACK_URL = (process.env.YOUTRACK_URL || '').replace(/\/$/, '');
const YOUTRACK_TOKEN = process.env.YOUTRACK_TOKEN || '';

let connection = null;
let agentId = process.env.AGENT_ID || 'agent';

function attach(conn, id) {
  connection = conn;
  if (id) agentId = id;
}

async function yt(method, pathName, body) {
  if (!YOUTRACK_URL || !YOUTRACK_TOKEN) {
    console.log(`[reporter] (skipped, no YouTrack config) ${method} ${pathName}`);
    return null;
  }
  const res = await fetch(`${YOUTRACK_URL}${pathName}`, {
    method,
    headers: {
      Authorization: `Bearer ${YOUTRACK_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`YouTrack ${method} ${pathName} -> ${res.status}: ${text}`);
  }
  return res.json().catch(() => null);
}

async function addComment(taskId, text) {
  return yt('POST', `/api/issues/${taskId}/comments`, { text });
}

async function setCustomField(taskId, name, value) {
  return yt('POST', `/api/issues/${taskId}`, {
    customFields: [{ name, $type: 'SimpleIssueCustomField', value }]
  });
}

async function transition(taskId, stateName) {
  return yt('POST', `/api/commands`, {
    query: `State ${stateName}`,
    issues: [{ idReadable: taskId }]
  });
}

async function transitionToQAReview(taskId, artifactPath, checkType, expectedOutput) {
  await setCustomField(taskId, 'QA Artifact Path', artifactPath || '');
  await setCustomField(taskId, 'QA Check Type', checkType || '');
  await setCustomField(taskId, 'QA Expected Output', expectedOutput || '');
  await transition(taskId, 'QA Review');
  workflowEvent('qa_sent', { task_id: taskId });
}

// Called when QA bounces a task back to the dev agent.
async function transitionToInProgress(taskId, reason) {
  await transition(taskId, 'In Progress');
  workflowEvent('qa_returned', { reason: reason || '' });
}

// Stream a log line to the orchestrator as install/task progress.
function logLine(line, tool) {
  if (connection) {
    connection.send({
      type: 'INSTALL_PROGRESS',
      agent_id: agentId,
      tool: tool || 'task',
      log_line: line
    });
  } else {
    process.stdout.write(line + '\n');
  }
}

// Emit a workflow event to the orchestrator for live visualization / logging.
function workflowEvent(event, meta = {}) {
  const session = require('./session');
  if (!connection) return;
  connection.send({
    type: 'WORKFLOW_EVENT',
    agent_id: agentId || process.env.AGENT_ID,
    task_id: session.currentTask && session.currentTask.id,
    event,
    meta,
    timestamp: Date.now()
  });
}

module.exports = {
  attach,
  addComment,
  transitionToQAReview,
  transitionToInProgress,
  logLine,
  workflowEvent
};
