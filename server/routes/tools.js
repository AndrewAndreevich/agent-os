const express = require('express');
const router = express.Router();
const db = require('../db');
const registry = require('../registry');
const messages = require('../../shared/messages');
const { TOOLS } = require('../../shared/constants');

// GET /api/tools — available tools and their version-check commands.
router.get('/', (req, res) => {
  res.json(TOOLS);
});

// POST /api/tools/install — bulk install: [{ agent_id, tool }, ...]
router.post('/install', (req, res) => {
  const list = (req.body && req.body.installs) || req.body || [];
  const items = Array.isArray(list) ? list : [];
  const results = [];

  for (const { agent_id, tool } of items) {
    if (!agent_id || !tool) {
      results.push({ agent_id, tool, ok: false, error: 'missing agent_id or tool' });
      continue;
    }
    db.prepare(
      `INSERT INTO tool_installs (agent_id, tool, status, log, created_at) VALUES (?, ?, 'pending', '', ?)`
    ).run(agent_id, tool, Date.now());

    const script = `#!/bin/bash\necho "Installing ${tool} on ${agent_id}..."\necho "${tool} install complete"`;
    const agent = registry.getAgent(agent_id);
    let dispatched = false;
    if (agent && agent.ws && agent.ws.readyState === 1) {
      agent.ws.send(JSON.stringify(messages.installTool(tool, script)));
      dispatched = true;
    }
    results.push({ agent_id, tool, ok: true, dispatched });
  }

  res.json({ results });
});

module.exports = router;
