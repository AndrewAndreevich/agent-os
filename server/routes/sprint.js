const express = require('express');
const router = express.Router();
const db = require('../db');
const { TASK_STATUS } = require('../../shared/constants');

function safeParse(json, fallback = []) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

// GET /api/sprint/current — tasks grouped by wave with per-wave status counts.
router.get('/current', (req, res) => {
  const rows = db.prepare(`SELECT * FROM tasks ORDER BY wave ASC, rowid ASC`).all();

  const wavesMap = new Map();
  for (const r of rows) {
    const wave = r.wave || 1;
    if (!wavesMap.has(wave)) {
      wavesMap.set(wave, { wave, tasks: [], counts: {}, total: 0, done: 0 });
    }
    const group = wavesMap.get(wave);
    const duration =
      r.completed_at && r.started_at ? Math.round((r.completed_at - r.started_at) / 1000) : null;
    group.tasks.push({
      id: r.id,
      title: r.title,
      status: r.status,
      assigned_agent: r.assigned_agent,
      required_capabilities: safeParse(r.required_capabilities),
      duration_seconds: duration
    });
    group.counts[r.status] = (group.counts[r.status] || 0) + 1;
    group.total += 1;
    if (r.status === TASK_STATUS.DONE) group.done += 1;
  }

  const waves = Array.from(wavesMap.values()).sort((a, b) => a.wave - b.wave);
  const total = rows.length;
  const done = rows.filter((r) => r.status === TASK_STATUS.DONE).length;

  res.json({
    waves,
    progress: { total, done, percent: total ? Math.round((done / total) * 100) : 0 }
  });
});

module.exports = router;
