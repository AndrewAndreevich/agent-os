require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const db = require('./db'); // initializes tables on require
const registry = require('./registry');
const queue = require('./queue');
const dispatcher = require('./dispatcher');
const heartbeat = require('./heartbeat');
const timetracker = require('./timetracker');

const youtrack = require('./youtrack');
const scheduler = require('./scheduler');
const workflow = require('./workflow');

const messages = require('../shared/messages');
const { WS_TYPES, TASK_STATUS } = require('../shared/constants');

const PORT = process.env.PORT || 3000;

// Map YouTrack workflow state names -> internal AgentOS task statuses.
// Keys are lower-cased state names. Edit this to match the project workflow
// discovered during integration (PVF uses "In Progress" / "Needs Review" /
// "Fixed" / "Verified"; spec aliases "QA Review" / "Done" / "Need Review"
// are included so either naming works).
const YT_STATE_MAP = {
  // AgentOS Workflow states (setup-youtrack-project.js)
  open:            TASK_STATUS.QUEUED,
  'in progress':   TASK_STATUS.IN_PROGRESS,
  'needs qa':      TASK_STATUS.QA_REVIEW,
  'needs review':  TASK_STATUS.NEED_REVIEW,
  'needs fix':     TASK_STATUS.IN_PROGRESS,  // returned to agent
  fixed:           TASK_STATUS.DONE,
  // Legacy / fallback aliases
  submitted:       TASK_STATUS.QUEUED,
  reopened:        TASK_STATUS.QUEUED,
  'qa review':     TASK_STATUS.QA_REVIEW,
  'need review':   TASK_STATUS.NEED_REVIEW,
  verified:        TASK_STATUS.DONE,
  done:            TASK_STATUS.DONE
};

const app = express();
app.use(express.json({ limit: '2mb' }));

// Serve the web UI.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'ui', 'index.html'));
});

// REST routes.
app.use('/api/agents', require('./routes/agents'));
app.use('/api', require('./routes/tasks')); // /api/tasks, /api/queue
app.use('/api/tools', require('./routes/tools'));
app.use('/api/sprint', require('./routes/sprint'));
app.use('/api/agents', require('./routes/schedule')); // /api/agents/:id/schedule
app.use('/api/workflow', require('./routes/workflow'));
app.use('/api/pm', require('./routes/pm'));

app.get('/api/config', (req, res) => {
  res.json({
    youtrack_url: process.env.YOUTRACK_URL || '',
    youtrack_project: process.env.YOUTRACK_PROJECT || ''
  });
});

// --- YouTrack webhook receiver ---
// YouTrack posts here when an issue is created/updated. We translate the new
// State into an AgentOS action: enqueue+dispatch, hand off to QA, or release
// the agent. See YT_STATE_MAP above for the state->status mapping.
app.post('/api/youtrack/webhook', (req, res) => {
  const payload = req.body || {};
  const issue = payload.issue || {};
  const issueId = issue.id;

  // The new state can arrive in `issue.fields` (webhook format) or via
  // `transition`. Prefer the explicit State field.
  const stateField = (issue.fields || []).find((f) => f.name === 'State');
  const stateName =
    (stateField && stateField.value && stateField.value.name) ||
    (payload.state && payload.state.name) ||
    null;

  if (!issueId) {
    return res.status(400).json({ error: 'missing issue id' });
  }
  if (!stateName) {
    return res.status(400).json({ error: 'missing state' });
  }

  const internal = YT_STATE_MAP[String(stateName).toLowerCase()] || null;
  console.log(`[webhook] ${issueId} state="${stateName}" -> ${internal || '(unmapped)'}`);

  switch (internal) {
    case TASK_STATUS.IN_PROGRESS:
    case TASK_STATUS.QUEUED: {
      // Enqueue (idempotent upsert) and try to dispatch to a dev agent.
      queue.enqueue({
        id: issueId,
        title: issue.summary || '',
        required_capabilities: issue.required_capabilities || ['base'],
        wave: issue.wave || 1
      });
      registry.broadcastToUI(messages.taskStatusChanged(issueId, TASK_STATUS.QUEUED, null));
      const dispatched = dispatcher.tryDispatch();
      return res.json({ ok: true, action: 'enqueued', dispatched });
    }

    case TASK_STATUS.QA_REVIEW: {
      // Hand the artifact to a QA agent. Find any registered agent with the
      // qa role and a live socket.
      let qaAgent = null;
      for (const [id, a] of registry.agents) {
        if (a.role === 'qa' && a.ws && a.ws.readyState === 1) {
          qaAgent = { id, ...a };
          break;
        }
      }
      if (qaAgent) {
        qaAgent.ws.send(
          JSON.stringify(
            messages.assignTask(issueId, issue.summary || '', {}, 'qa', {}, '')
          )
        );
        registry.broadcastToUI(
          messages.taskStatusChanged(issueId, TASK_STATUS.QA_REVIEW, qaAgent.id)
        );
        return res.json({ ok: true, action: 'qa_assigned', qa_agent: qaAgent.id });
      }
      registry.broadcastToUI(messages.taskStatusChanged(issueId, TASK_STATUS.QA_REVIEW, null));
      return res.json({ ok: true, action: 'qa_pending', note: 'no qa agent online' });
    }

    case TASK_STATUS.DONE:
    case TASK_STATUS.NEED_REVIEW: {
      const agent = registry.getAgentByTask(issueId);
      queue.setStatus(issueId, internal, agent ? agent.id : null);
      if (agent) {
        registry.markIdle(agent.id);
        registry.broadcastToUI(messages.agentStatusChanged(agent.id, 'idle'));
      }
      registry.broadcastToUI(
        messages.taskStatusChanged(issueId, internal, agent ? agent.id : null)
      );
      const dispatched = dispatcher.tryDispatch();
      return res.json({ ok: true, action: 'released', dispatched });
    }

    default:
      return res.json({ ok: true, action: 'ignored', state: stateName });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.agentId = null;

  // A connection is treated as a UI client until it sends a REGISTER
  // (which only agents do). UI clients identify via the ?ui=1 query.
  const isUI = (req.url || '').includes('ui=1');
  if (isUI) {
    registry.addUIClient(ws);
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handleMessage(ws, msg);
  });

  ws.on('close', () => {
    registry.removeUIClient(ws);
    // We intentionally do NOT mark the agent offline here. A dropped socket
    // is detected and reconciled by the heartbeat monitor once the agent's
    // last_heartbeat goes stale (see heartbeat.js). This keeps an agent's
    // in-flight task/state intact across brief reconnects, and the
    // dispatcher already refuses to assign work to a dead socket.
  });

  ws.on('error', () => {});
});

async function handleMessage(ws, msg) {
  switch (msg.type) {
    case WS_TYPES.REGISTER: {
      ws.agentId = msg.agent_id;
      registry.registerAgent(msg.agent_id, ws, {
        role: msg.role,
        capabilities: msg.capabilities || [],
        machine_ip: msg.machine_ip || ''
      });
      ws.send(JSON.stringify(messages.registered(msg.agent_id, { port: PORT })));
      registry.broadcastToUI(messages.agentStatusChanged(msg.agent_id, 'idle'));
      dispatcher.tryDispatch();
      break;
    }

    case WS_TYPES.HEARTBEAT: {
      registry.heartbeat(msg.agent_id);
      registry.broadcastToUI(messages.heartbeatUpdate(msg.agent_id, Date.now()));
      break;
    }

    case 'WORKFLOW_EVENT': {
      workflow.logEvent(msg.task_id, msg.agent_id, msg.event, msg.meta || {});
      registry.broadcastToUI({ type: 'WORKFLOW_EVENT', ...msg });
      break;
    }

    case 'REMOVE_CAPABILITY': {
      const agent = registry.getAgent(msg.agent_id);
      if (agent) {
        const current = Array.isArray(agent.capabilities)
          ? agent.capabilities
          : JSON.parse(agent.capabilities || '[]');
        const updated = current.filter((c) => c !== msg.capability);
        registry.updateCapabilities(msg.agent_id, updated);
        registry.broadcastToUI({ type: 'AGENT_CAPABILITIES_CHANGED', agent_id: msg.agent_id, capabilities: updated });
        console.log(`[registry] removed '${msg.capability}' from ${msg.agent_id}`);
      }
      break;
    }

    case WS_TYPES.PONG:
      ws.isAlive = true;
      break;

    case WS_TYPES.TASK_STARTED: {
      queue.setStatus(msg.task_id, TASK_STATUS.IN_PROGRESS, msg.agent_id);
      registry.broadcastToUI(
        messages.taskStatusChanged(msg.task_id, TASK_STATUS.IN_PROGRESS, msg.agent_id)
      );
      break;
    }

    case WS_TYPES.SELFCHECK_PASSED: {
      queue.setStatus(msg.task_id, TASK_STATUS.SELFCHECK, msg.agent_id);
      registry.broadcastToUI(
        messages.taskStatusChanged(msg.task_id, TASK_STATUS.SELFCHECK, msg.agent_id)
      );
      break;
    }

    case WS_TYPES.SELFCHECK_FAILED: {
      // Bump attempt counter; task stays in progress for a retry.
      db.prepare(`UPDATE tasks SET qa_attempts = qa_attempts + 1 WHERE id = ?`).run(msg.task_id);
      queue.setStatus(msg.task_id, TASK_STATUS.IN_PROGRESS, msg.agent_id);
      registry.broadcastToUI(
        messages.taskStatusChanged(msg.task_id, TASK_STATUS.IN_PROGRESS, msg.agent_id)
      );
      break;
    }

    case WS_TYPES.TASK_DONE: {
      // Persist QA contract fields and move into QA review.
      db.prepare(
        `UPDATE tasks SET status = ?, qa_artifact_path = ?, qa_check_type = ?, qa_expected_output = ?, completed_at = ?
         WHERE id = ?`
      ).run(
        TASK_STATUS.QA_REVIEW,
        msg.qa_artifact_path || null,
        msg.qa_check_type || null,
        msg.qa_expected_output || null,
        Date.now(),
        msg.task_id
      );

      timetracker.stopTimer(msg.task_id, msg.agent_id);
      timetracker.syncToYouTrack(msg.task_id).catch(() => {});

      registry.markIdle(msg.agent_id);
      registry.broadcastToUI(
        messages.taskStatusChanged(msg.task_id, TASK_STATUS.QA_REVIEW, msg.agent_id)
      );
      registry.broadcastToUI(messages.agentStatusChanged(msg.agent_id, 'idle'));

      // Record completion in the workflow log and push a session summary to
      // YouTrack (best-effort — never throws).
      workflow.logEvent(msg.task_id, msg.agent_id, 'task_done', {});
      try {
        await workflow.syncSessionSummaryToYouTrack(msg.task_id, msg.agent_id);
      } catch (e) {
        console.error('[workflow] summary sync failed:', e.message);
      }

      dispatcher.tryDispatch();
      break;
    }

    case WS_TYPES.TASK_FAILED: {
      db.prepare(`UPDATE tasks SET qa_attempts = qa_attempts + 1 WHERE id = ?`).run(msg.task_id);
      queue.requeue(msg.task_id);
      timetracker.stopTimer(msg.task_id, msg.agent_id);
      registry.markIdle(msg.agent_id);
      registry.broadcastToUI(messages.taskStatusChanged(msg.task_id, TASK_STATUS.QUEUED, null));
      registry.broadcastToUI(messages.agentStatusChanged(msg.agent_id, 'idle'));
      dispatcher.tryDispatch();
      break;
    }

    case WS_TYPES.INSTALL_PROGRESS: {
      // Append to the install log and stream to the UI.
      db.prepare(
        `UPDATE tool_installs SET log = log || ? , status = 'installing'
         WHERE id = (SELECT id FROM tool_installs WHERE agent_id = ? AND tool = ? ORDER BY id DESC LIMIT 1)`
      ).run((msg.log_line || '') + '\n', msg.agent_id, msg.tool);
      registry.broadcastToUI(messages.installLog(msg.agent_id, msg.tool, msg.log_line || ''));
      break;
    }

    case WS_TYPES.INSTALL_DONE: {
      db.prepare(
        `UPDATE tool_installs SET status = ?
         WHERE id = (SELECT id FROM tool_installs WHERE agent_id = ? AND tool = ? ORDER BY id DESC LIMIT 1)`
      ).run(msg.success ? 'installed' : 'failed', msg.agent_id, msg.tool);
      registry.broadcastToUI(
        messages.installLog(
          msg.agent_id,
          msg.tool,
          msg.success ? `[done] ${msg.tool} installed` : `[fail] ${msg.tool} install failed`
        )
      );
      break;
    }

    default:
      // Unknown message type; ignore.
      break;
  }
}

// Liveness ping for socket-level dead-connection detection.
const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try {
      ws.send(JSON.stringify(messages.ping()));
    } catch {
      /* ignore */
    }
  });
}, 30 * 1000);

wss.on('close', () => clearInterval(pingInterval));

// Check agent schedules every 60 seconds and flip agents between idle and
// scheduled depending on whether they are inside a configured work window.
setInterval(() => {
  const allAgents = registry.getAll();
  allAgents.forEach((agent) => {
    if (agent.status === 'idle' || agent.status === 'scheduled') {
      const available = scheduler.checkAgentSchedule(agent.id);
      if (available && agent.status === 'scheduled') {
        registry.markIdle(agent.id);
        dispatcher.tryDispatch();
        registry.broadcastToUI({ type: 'AGENT_STATUS_CHANGED', agent_id: agent.id, status: 'idle' });
      } else if (!available && agent.status === 'idle') {
        const minutesLeft = scheduler.minutesUntilNextWindow(agent.id);
        registry.markScheduled(agent.id, minutesLeft);
        registry.broadcastToUI({
          type: 'AGENT_STATUS_CHANGED',
          agent_id: agent.id,
          status: 'scheduled',
          minutes_until_active: minutesLeft
        });
      }
    }
  });
}, 60000);

heartbeat.start();

server.listen(PORT, () => {
  console.log(`AgentOS server listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
});

module.exports = { app, server };
