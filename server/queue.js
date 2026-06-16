const db = require('./db');
const { TASK_STATUS } = require('../shared/constants');

// SQLite-backed task queue. Tasks with status=queued are considered
// pending dispatch. Capability matching is done in JS because the
// required_capabilities column stores a JSON array.

const insertStmt = db.prepare(`
  INSERT INTO tasks (id, title, status, assigned_agent, required_capabilities,
                     qa_check_type, qa_artifact_path, qa_expected_output,
                     qa_attempts, wave, started_at, completed_at)
  VALUES (@id, @title, @status, @assigned_agent, @required_capabilities,
          @qa_check_type, @qa_artifact_path, @qa_expected_output,
          @qa_attempts, @wave, @started_at, @completed_at)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    required_capabilities = excluded.required_capabilities,
    qa_check_type = excluded.qa_check_type,
    wave = excluded.wave
`);

const updateStatusStmt = db.prepare(
  `UPDATE tasks SET status = ?, assigned_agent = ? WHERE id = ?`
);

function safeParse(json, fallback = []) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function enqueue(task) {
  const row = {
    id: task.id,
    title: task.title || '',
    status: TASK_STATUS.QUEUED,
    assigned_agent: null,
    required_capabilities: JSON.stringify(task.required_capabilities || []),
    qa_check_type: task.qa_check_type || null,
    qa_artifact_path: task.qa_artifact_path || null,
    qa_expected_output: task.qa_expected_output || null,
    qa_attempts: task.qa_attempts || 0,
    wave: task.wave || 1,
    started_at: null,
    completed_at: null
  };
  insertStmt.run(row);
  return getById(task.id);
}

function getById(id) {
  const r = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  return r ? hydrate(r) : null;
}

function hydrate(r) {
  return { ...r, required_capabilities: safeParse(r.required_capabilities) };
}

function matches(task, agentCaps) {
  const req = safeParse(task.required_capabilities);
  return req.every((c) => agentCaps.includes(c));
}

// Find the first queued task whose required capabilities are a subset
// of the supplied capability list. Does not modify state.
function peek(requiredCapabilities = []) {
  const caps = requiredCapabilities || [];
  const rows = db
    .prepare(`SELECT * FROM tasks WHERE status = ? ORDER BY wave ASC, rowid ASC`)
    .all(TASK_STATUS.QUEUED);
  for (const r of rows) {
    if (matches(r, caps)) return hydrate(r);
  }
  return null;
}

// Same as peek but marks the task as dispatched.
function dequeue(requiredCapabilities = []) {
  const task = peek(requiredCapabilities);
  if (!task) return null;
  updateStatusStmt.run(TASK_STATUS.DISPATCHED, null, task.id);
  return getById(task.id);
}

function setStatus(taskId, status, assignedAgent = null) {
  updateStatusStmt.run(status, assignedAgent, taskId);
}

function getAll() {
  return db
    .prepare(`SELECT * FROM tasks WHERE status = ? ORDER BY wave ASC, rowid ASC`)
    .all(TASK_STATUS.QUEUED)
    .map(hydrate);
}

// Return a queued task to the front of the queue (e.g. agent died).
function requeue(taskId) {
  updateStatusStmt.run(TASK_STATUS.QUEUED, null, taskId);
}

module.exports = { enqueue, dequeue, peek, getAll, getById, setStatus, requeue };
