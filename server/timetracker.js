const db = require('./db');
const youtrack = require('./youtrack');

// Tracks per-task work time and syncs durations to YouTrack worklogs.

const insertStmt = db.prepare(
  `INSERT INTO time_logs (task_id, agent_id, started_at, stopped_at, duration_seconds, synced_to_youtrack)
   VALUES (?, ?, ?, NULL, NULL, 0)`
);

function startTimer(taskId, agentId) {
  const now = Date.now();
  insertStmt.run(taskId, agentId, now);
  return now;
}

function stopTimer(taskId, agentId) {
  // Stop the most recent open timer for this task/agent.
  const row = db
    .prepare(
      `SELECT * FROM time_logs WHERE task_id = ? AND agent_id = ? AND stopped_at IS NULL
       ORDER BY id DESC LIMIT 1`
    )
    .get(taskId, agentId);
  if (!row) return null;
  const now = Date.now();
  const elapsedMs = now - row.started_at;
  // Track at one-second granularity; any task that actually ran logs at
  // least one second so completed work never records as zero time.
  const duration = elapsedMs <= 0 ? 0 : Math.max(1, Math.round(elapsedMs / 1000));
  db.prepare(`UPDATE time_logs SET stopped_at = ?, duration_seconds = ? WHERE id = ?`)
    .run(now, duration, row.id);
  return duration;
}

async function syncToYouTrack(taskId) {
  const rows = db
    .prepare(
      `SELECT * FROM time_logs WHERE task_id = ? AND synced_to_youtrack = 0 AND stopped_at IS NOT NULL`
    )
    .all(taskId);

  const markSynced = db.prepare(`UPDATE time_logs SET synced_to_youtrack = 1 WHERE id = ?`);

  for (const row of rows) {
    const minutes = Math.max(1, Math.round((row.duration_seconds || 0) / 60));
    try {
      await youtrack.addWorklog(
        taskId,
        row.agent_id,
        minutes,
        `Work logged by agent ${row.agent_id}`
      );
      markSynced.run(row.id);
    } catch (err) {
      console.error(`[timetracker] failed to sync worklog ${row.id}:`, err.message);
    }
  }
}

function getLogsForTask(taskId) {
  return db.prepare(`SELECT * FROM time_logs WHERE task_id = ? ORDER BY id ASC`).all(taskId);
}

module.exports = { startTimer, stopTimer, syncToYouTrack, getLogsForTask };
