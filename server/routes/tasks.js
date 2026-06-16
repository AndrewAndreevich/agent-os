const express = require('express');
const router = express.Router();
const db = require('../db');
const queue = require('../queue');
const dispatcher = require('../dispatcher');

function safeParse(json, fallback = []) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function hydrate(r) {
  return { ...r, required_capabilities: safeParse(r.required_capabilities) };
}

// GET /api/tasks — every task regardless of status.
router.get('/tasks', (req, res) => {
  const rows = db.prepare(`SELECT * FROM tasks ORDER BY wave ASC, rowid ASC`).all();
  res.json(rows.map(hydrate));
});

// GET /api/queue — queued tasks only.
router.get('/queue', (req, res) => {
  res.json(queue.getAll());
});

// POST /api/tasks — create + enqueue a task, then try to dispatch it.
router.post('/tasks', (req, res) => {
  const body = req.body || {};
  if (!body.id) return res.status(400).json({ error: 'id is required' });

  const task = queue.enqueue({
    id: body.id,
    title: body.title || '',
    required_capabilities: body.required_capabilities || [],
    qa_check_type: body.qa_check_type || null,
    qa_artifact_path: body.qa_artifact_path || null,
    qa_expected_output: body.qa_expected_output || null,
    wave: body.wave || 1
  });

  const dispatched = dispatcher.tryDispatch();
  // Return the task fields at the top level (plus dispatch count) so callers
  // can read `id`/`status` directly off the response.
  res.status(201).json({ ...task, dispatched });
});

module.exports = router;
