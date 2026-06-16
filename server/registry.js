const db = require('./db');
const { AGENT_STATUS } = require('../shared/constants');

// In-memory map of live agent connections.
// agentId -> { ws, status, role, capabilities, current_task, last_heartbeat, machine_ip }
const agents = new Map();

// Set of UI WebSocket connections (tracked separately via ws.isUI flag).
const uiClients = new Set();

const upsertStmt = db.prepare(`
  INSERT INTO agents (id, machine_ip, status, role, capabilities, current_task, last_heartbeat, registered_at)
  VALUES (@id, @machine_ip, @status, @role, @capabilities, @current_task, @last_heartbeat, @registered_at)
  ON CONFLICT(id) DO UPDATE SET
    machine_ip = excluded.machine_ip,
    status = excluded.status,
    role = excluded.role,
    capabilities = excluded.capabilities,
    current_task = excluded.current_task,
    last_heartbeat = excluded.last_heartbeat
`);

const updateStatusStmt = db.prepare(
  `UPDATE agents SET status = ?, current_task = ?, last_heartbeat = ? WHERE id = ?`
);
const updateHeartbeatStmt = db.prepare(`UPDATE agents SET last_heartbeat = ? WHERE id = ?`);

function persist(agentId) {
  const a = agents.get(agentId);
  if (!a) return;
  upsertStmt.run({
    id: agentId,
    machine_ip: a.machine_ip || '',
    status: a.status,
    role: a.role || '',
    capabilities: JSON.stringify(a.capabilities || []),
    current_task: a.current_task || null,
    last_heartbeat: a.last_heartbeat || Date.now(),
    registered_at: a.registered_at || Date.now()
  });
}

function registerAgent(agentId, ws, data = {}) {
  const now = Date.now();
  const existing = agents.get(agentId) || {};
  const agent = {
    ws,
    status: AGENT_STATUS.IDLE,
    role: data.role || existing.role || '',
    capabilities: data.capabilities || existing.capabilities || [],
    current_task: null,
    machine_ip: data.machine_ip || existing.machine_ip || '',
    claude_path: data.claude_path || existing.claude_path || 'claude',
    claude_available: data.claude_available !== undefined
      ? data.claude_available !== false
      : (existing.claude_available !== false),
    last_heartbeat: now,
    registered_at: existing.registered_at || now
  };
  agents.set(agentId, agent);
  persist(agentId);
  return agent;
}

function markBusy(agentId, taskId) {
  const a = agents.get(agentId);
  if (!a) return;
  a.status = AGENT_STATUS.BUSY;
  a.current_task = taskId;
  updateStatusStmt.run(a.status, taskId, Date.now(), agentId);
}

function markIdle(agentId) {
  const a = agents.get(agentId);
  if (!a) return;
  a.status = AGENT_STATUS.IDLE;
  a.current_task = null;
  updateStatusStmt.run(a.status, null, Date.now(), agentId);
}

function markScheduled(agentId, minutesUntilActive) {
  const a = agents.get(agentId);
  if (a) {
    a.status = 'scheduled';
    a.minutes_until_active = minutesUntilActive;
  }
  db.prepare(`UPDATE agents SET status = ? WHERE id = ?`).run('scheduled', agentId);
}

function markOffline(agentId) {
  const a = agents.get(agentId);
  if (!a) {
    db.prepare(`UPDATE agents SET status = ?, current_task = NULL WHERE id = ?`)
      .run(AGENT_STATUS.OFFLINE, agentId);
    return;
  }
  a.status = AGENT_STATUS.OFFLINE;
  const prevTask = a.current_task;
  a.current_task = null;
  updateStatusStmt.run(a.status, null, a.last_heartbeat || Date.now(), agentId);
  return prevTask;
}

function heartbeat(agentId) {
  const a = agents.get(agentId);
  if (!a) return;
  a.last_heartbeat = Date.now();
  if (a.status === AGENT_STATUS.OFFLINE) {
    a.status = AGENT_STATUS.IDLE;
    updateStatusStmt.run(a.status, a.current_task || null, a.last_heartbeat, agentId);
  } else {
    updateHeartbeatStmt.run(a.last_heartbeat, agentId);
  }
}

function getIdleAgents(requiredCapabilities = []) {
  const req = requiredCapabilities || [];
  const result = [];
  for (const [id, a] of agents) {
    if (a.status !== AGENT_STATUS.IDLE) continue;
    const caps = a.capabilities || [];
    const hasAll = req.every((c) => caps.includes(c));
    if (hasAll) result.push({ id, ...a });
  }
  return result;
}

function getAgentByTask(taskId) {
  for (const [id, a] of agents) {
    if (a.current_task === taskId) return { id, ...a };
  }
  return null;
}

function getAgent(agentId) {
  const a = agents.get(agentId);
  return a ? { id: agentId, ...a } : null;
}

function updateCapabilities(agentId, capabilities) {
  const agent = agents.get(agentId);
  if (agent) {
    agent.capabilities = capabilities;
  }
  db.prepare('UPDATE agents SET capabilities = ? WHERE id = ?')
    .run(JSON.stringify(capabilities), agentId);
}

function getAll() {
  // Merge live map with DB rows so the UI sees agents that registered
  // in a previous run but aren't currently connected.
  const rows = db.prepare(`SELECT * FROM agents`).all();
  const out = new Map();
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      machine_ip: r.machine_ip,
      status: r.status,
      role: r.role,
      capabilities: safeParse(r.capabilities),
      current_task: r.current_task,
      last_heartbeat: r.last_heartbeat,
      registered_at: r.registered_at
    });
  }
  for (const [id, a] of agents) {
    out.set(id, {
      id,
      machine_ip: a.machine_ip,
      status: a.status,
      role: a.role,
      capabilities: a.capabilities || [],
      current_task: a.current_task,
      last_heartbeat: a.last_heartbeat,
      registered_at: a.registered_at
    });
  }
  return Array.from(out.values());
}

function safeParse(json, fallback = []) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

// --- UI connection tracking ---
function addUIClient(ws) {
  ws.isUI = true;
  uiClients.add(ws);
}

function removeUIClient(ws) {
  uiClients.delete(ws);
}

function broadcastToUI(message) {
  const payload = JSON.stringify(message);
  for (const ws of uiClients) {
    if (ws.readyState === 1 /* OPEN */) {
      try {
        ws.send(payload);
      } catch {
        /* ignore broken pipe */
      }
    }
  }
}

function getAgentsAfterOfflineSweep(thresholdMs) {
  // Used by heartbeat module: list agents that haven't pinged recently.
  const cutoff = Date.now() - thresholdMs;
  const stale = [];
  for (const [id, a] of agents) {
    if (a.status !== AGENT_STATUS.OFFLINE && (a.last_heartbeat || 0) < cutoff) {
      stale.push({ id, ...a });
    }
  }
  return stale;
}

module.exports = {
  agents,
  registerAgent,
  markBusy,
  markIdle,
  markScheduled,
  markOffline,
  heartbeat,
  getIdleAgents,
  getAgentByTask,
  getAgent,
  updateCapabilities,
  getAll,
  addUIClient,
  removeUIClient,
  broadcastToUI,
  getAgentsAfterOfflineSweep
};
