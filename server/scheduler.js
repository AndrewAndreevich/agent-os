// Checks agent schedules and manages SCHEDULED vs IDLE status transitions
// Called every 60 seconds by setInterval in server/index.js

const db = require('./db');
const registry = require('./registry');

function isWithinWindow(windows, timezone) {
  // Get current time in agent's timezone
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short'
  });
  const parts = formatter.formatToParts(now);
  const day = parts.find(p => p.type === 'weekday').value.toUpperCase().slice(0, 3);
  const hour = parseInt(parts.find(p => p.type === 'hour').value);
  const minute = parseInt(parts.find(p => p.type === 'minute').value);
  const currentMinutes = hour * 60 + minute;

  for (const window of windows) {
    if (!window.days.includes(day)) continue;
    const [fromH, fromM] = window.from.split(':').map(Number);
    const [toH, toM] = window.to.split(':').map(Number);
    const fromMinutes = fromH * 60 + fromM;
    const toMinutes = toH * 60 + toM;

    // Handle overnight windows (e.g. 23:00 to 07:00)
    if (fromMinutes > toMinutes) {
      if (currentMinutes >= fromMinutes || currentMinutes <= toMinutes) return true;
    } else {
      if (currentMinutes >= fromMinutes && currentMinutes <= toMinutes) return true;
    }
  }
  return false;
}

function getSchedule(agentId) {
  return db.prepare('SELECT * FROM agent_schedules WHERE agent_id = ?').get(agentId);
}

function setSchedule(agentId, schedule) {
  db.prepare(`
    INSERT INTO agent_schedules (agent_id, enabled, timezone, windows, selfcheck_enabled, selfcheck_max_attempts, token_budget_per_task, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      enabled = excluded.enabled,
      timezone = excluded.timezone,
      windows = excluded.windows,
      selfcheck_enabled = excluded.selfcheck_enabled,
      selfcheck_max_attempts = excluded.selfcheck_max_attempts,
      token_budget_per_task = excluded.token_budget_per_task,
      updated_at = excluded.updated_at
  `).run(
    agentId,
    schedule.enabled ? 1 : 0,
    schedule.timezone || 'UTC',
    JSON.stringify(schedule.windows || []),
    schedule.selfcheck_enabled !== false ? 1 : 0,
    schedule.selfcheck_max_attempts || 2,
    schedule.token_budget_per_task || 50000,
    Date.now()
  );
}

function checkAgentSchedule(agentId) {
  const schedule = getSchedule(agentId);
  if (!schedule || !schedule.enabled) return true; // no schedule = always available

  const windows = JSON.parse(schedule.windows || '[]');
  if (!windows.length) return true;

  return isWithinWindow(windows, schedule.timezone || 'UTC');
}

function getAgentSelfcheckConfig(agentId) {
  const schedule = getSchedule(agentId);
  return {
    enabled: schedule ? !!schedule.selfcheck_enabled : true,
    max_attempts: schedule ? schedule.selfcheck_max_attempts : 2,
    token_budget: schedule ? schedule.token_budget_per_task : 50000
  };
}

function minutesUntilNextWindow(agentId) {
  const schedule = getSchedule(agentId);
  if (!schedule || !schedule.enabled) return 0;
  const windows = JSON.parse(schedule.windows || '[]');
  if (!windows.length) return 0;

  // Try each minute for next 24 hours to find when window opens
  for (let i = 1; i <= 1440; i++) {
    const future = new Date(Date.now() + i * 60000);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: schedule.timezone || 'UTC',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      weekday: 'short'
    });
    const parts = formatter.formatToParts(future);
    const day = parts.find(p => p.type === 'weekday').value.toUpperCase().slice(0, 3);
    const hour = parseInt(parts.find(p => p.type === 'hour').value);
    const minute = parseInt(parts.find(p => p.type === 'minute').value);
    const currentMinutes = hour * 60 + minute;

    for (const window of windows) {
      if (!window.days.includes(day)) continue;
      const [fromH, fromM] = window.from.split(':').map(Number);
      const fromMinutes = fromH * 60 + fromM;
      if (currentMinutes === fromMinutes) return i;
    }
  }
  return null; // no window in next 24h
}

module.exports = { checkAgentSchedule, getAgentSelfcheckConfig, getSchedule, setSchedule, minutesUntilNextWindow };
