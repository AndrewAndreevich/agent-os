const express = require('express');
const router = express.Router();
const db = require('../db');
const registry = require('../registry');
const messages = require('../../shared/messages');
const { TOOLS } = require('../../shared/constants');

// GET /api/agents — full agent list for the dashboard.
router.get('/', (req, res) => {
  res.json(registry.getAll());
});

// GET /api/agents/:id — single agent plus its recent task history.
router.get('/:id', (req, res) => {
  const id = req.params.id;
  const all = registry.getAll();
  const agent = all.find((a) => a.id === id);
  if (!agent) return res.status(404).json({ error: 'agent not found' });

  const tasks = db
    .prepare(
      `SELECT id, title, status, started_at, completed_at
       FROM tasks WHERE assigned_agent = ? ORDER BY rowid DESC LIMIT 10`
    )
    .all(id);

  const installs = db
    .prepare(`SELECT tool, status, created_at FROM tool_installs WHERE agent_id = ? ORDER BY id DESC`)
    .all(id);

  res.json({ ...agent, tasks, installs });
});

// POST /api/agents/:id/install — queue a tool install and push the
// install script to the agent over its WebSocket.
router.post('/:id/install', (req, res) => {
  const id = req.params.id;
  const { tool, script } = req.body || {};
  if (!tool) return res.status(400).json({ error: 'tool is required' });

  const toolDef = TOOLS.find((t) => t.name === tool);
  const installScript = script || (toolDef ? defaultScript(tool) : `echo "no script for ${tool}"`);

  db.prepare(
    `INSERT INTO tool_installs (agent_id, tool, status, log, created_at) VALUES (?, ?, 'pending', '', ?)`
  ).run(id, tool, Date.now());

  const agent = registry.getAgent(id);
  if (agent && agent.ws && agent.ws.readyState === 1) {
    agent.ws.send(JSON.stringify(messages.installTool(tool, installScript)));
    res.json({ ok: true, dispatched: true });
  } else {
    res.json({ ok: true, dispatched: false, note: 'agent offline; install queued' });
  }
});

function defaultScript(tool) {
  // Minimal placeholder install scripts; real installs are platform-specific.
  return `#!/bin/bash\necho "Installing ${tool}..."\n# TODO: real install steps for ${tool}\necho "${tool} install complete"`;
}

module.exports = router;
