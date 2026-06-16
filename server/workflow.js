const db = require('./db');

function logEvent(taskId, agentId, event, meta = {}) {
  db.prepare(
    'INSERT INTO workflow_events (task_id, agent_id, event, meta, timestamp) VALUES (?, ?, ?, ?, ?)'
  ).run(taskId, agentId, event, JSON.stringify(meta), Date.now());
}

function getTaskEvents(taskId) {
  // Order by timestamp, then id (insertion order) so events fired within the
  // same millisecond still come back in the order they were logged.
  return db.prepare(
    'SELECT * FROM workflow_events WHERE task_id = ? ORDER BY timestamp ASC, id ASC'
  ).all(taskId).map(e => ({ ...e, meta: JSON.parse(e.meta || '{}') }));
}

function getCurrentWaveEvents() {
  // Get all events for tasks in current sprint/wave (last 7 days)
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return db.prepare(
    'SELECT * FROM workflow_events WHERE timestamp > ? ORDER BY timestamp ASC, id ASC'
  ).all(since).map(e => ({ ...e, meta: JSON.parse(e.meta || '{}') }));
}

function getTimeline() {
  // Returns data shaped for timeline visualization.
  // Each agent gets a list of time blocks { task_id, start, end, status }.
  //
  // Event -> block mapping:
  //   task_received / task_started   = start of a block (status 'in_progress')
  //   implementation_started         = status 'implementing'
  //   selfcheck_running              = status 'selfcheck'
  //   committed                      = status 'committed'
  //   qa_sent / task_done            = end of the block (status = the event)
  // Other events (implementation_done, selfcheck_passed, committing, pushed,
  // pr_created, qa_returned, …) carry no block-state change.
  const events = getCurrentWaveEvents();
  const timeline = {};

  for (const e of events) {
    if (!timeline[e.agent_id]) timeline[e.agent_id] = [];
    const openBlock = () => timeline[e.agent_id].find(b => b.task_id === e.task_id && !b.end);

    switch (e.event) {
      case 'task_received':
      case 'task_started': {
        // Start a new block only if one isn't already open for this task.
        if (!openBlock()) {
          timeline[e.agent_id].push({ task_id: e.task_id, start: e.timestamp, end: null, status: 'in_progress' });
        }
        break;
      }
      case 'implementation_started': {
        const b = openBlock();
        if (b) b.status = 'implementing';
        break;
      }
      case 'selfcheck_running': {
        const b = openBlock();
        if (b) b.status = 'selfcheck';
        break;
      }
      case 'committed': {
        const b = openBlock();
        if (b) b.status = 'committed';
        break;
      }
      case 'qa_sent':
      case 'task_done': {
        const b = openBlock();
        if (b) { b.end = e.timestamp; b.status = e.event; }
        break;
      }
      default:
        break;
    }
  }

  return timeline;
}

function buildWorkflowGraph(tasks) {
  // Returns nodes and edges for graph visualization
  const nodes = tasks.map(t => ({
    id: t.id,
    label: t.title,
    status: t.status,
    agent: t.assigned_agent,
    wave: t.wave
  }));

  // Edges based on depends_on field or wave ordering
  const edges = [];
  const byWave = {};
  tasks.forEach(t => {
    if (!byWave[t.wave]) byWave[t.wave] = [];
    byWave[t.wave].push(t.id);
  });

  const waves = Object.keys(byWave).sort((a, b) => a - b);
  for (let i = 1; i < waves.length; i++) {
    const prevWave = byWave[waves[i - 1]];
    const currWave = byWave[waves[i]];
    prevWave.forEach(src => {
      currWave.forEach(dst => {
        edges.push({ from: src, to: dst });
      });
    });
  }

  return { nodes, edges };
}

async function syncSessionSummaryToYouTrack(taskId, agentId) {
  const events = getTaskEvents(taskId);
  if (!events.length) return;

  const yt = require('./youtrack');
  const start = events[0];
  const end = events[events.length - 1];
  const selfcheckEvents = events.filter(e => e.event === 'selfcheck_running');
  const commitEvent = events.find(e => e.event === 'committed');

  const duration = end.timestamp - start.timestamp;
  const minutes = Math.round(duration / 60000);

  const summary = [
    `[AgentOS] Session summary — ${agentId}`,
    `Started: ${new Date(start.timestamp).toISOString()}`,
    `Completed: ${new Date(end.timestamp).toISOString()}`,
    `Duration: ${minutes} min`,
    `Steps: ${events.map(e => e.event).join(' → ')}`,
    commitEvent ? `Commit: ${commitEvent.meta.hash || 'n/a'} (${commitEvent.meta.files_changed || 0} files)` : '',
    `Self-check attempts: ${selfcheckEvents.length}`
  ].filter(Boolean).join('\n');

  await yt.addComment(taskId, summary);
}

module.exports = { logEvent, getTaskEvents, getCurrentWaveEvents, getTimeline, buildWorkflowGraph, syncSessionSummaryToYouTrack };
