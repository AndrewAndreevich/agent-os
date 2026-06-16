const express = require('express');
const router = express.Router();
const workflowModule = require('../workflow');
const db = require('../db');

// GET /api/workflow/timeline
router.get('/timeline', (req, res) => {
  res.json(workflowModule.getTimeline());
});

// GET /api/workflow/graph
router.get('/graph', (req, res) => {
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY wave ASC, id ASC').all();
  res.json(workflowModule.buildWorkflowGraph(tasks));
});

// GET /api/workflow/events/:taskId
router.get('/events/:taskId', (req, res) => {
  res.json(workflowModule.getTaskEvents(req.params.taskId));
});

// GET /api/workflow/current
router.get('/current', (req, res) => {
  res.json(workflowModule.getCurrentWaveEvents());
});

module.exports = router;
