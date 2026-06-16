const express = require('express');
const router = express.Router();
const scheduler = require('../scheduler');
const registry = require('../registry');

// GET /api/agents/:id/schedule
router.get('/:id/schedule', (req, res) => {
  const schedule = scheduler.getSchedule(req.params.id);
  res.json(schedule || { agent_id: req.params.id, enabled: false, timezone: 'UTC', windows: [], selfcheck_enabled: true, selfcheck_max_attempts: 2, token_budget_per_task: 50000 });
});

// PUT /api/agents/:id/schedule
router.put('/:id/schedule', (req, res) => {
  scheduler.setSchedule(req.params.id, req.body);
  registry.broadcastToUI({ type: 'SCHEDULE_UPDATED', agent_id: req.params.id, schedule: req.body });
  res.json({ ok: true });
});

module.exports = router;
