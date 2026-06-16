# AgentOS Features Test Results

Date: 2026-06-16

## Summary
Steps passed: 7/7
Files created: 4
Files modified: 8

## Test Results
| Test | Name | Result |
|------|------|--------|
| 1 | DB tables | PASS |
| 2 | Schedule set/get | PASS |
| 3 | Overnight window | PASS |
| 4 | Workflow events | PASS |
| 5 | REST endpoints | PASS |
| 6 | YouTrack sync | PASS |
| 7 | Selfcheck config | PASS |

Detail:
- Test 1 — all three tables (`agent_schedules`, `workflow_events`, `agent_status_history`) present.
- Test 2 — selfcheck enabled, max_attempts=2, all-day window reports available. (3/3)
- Test 3 — selfcheck reported disabled per schedule.
- Test 4 — 4 events logged, agent-1 in timeline with correct task, graph 2 nodes / 1 edge. (5/5)
- Test 5 — PUT schedule, GET schedule (enabled), GET timeline, GET graph. (4/4)
- Test 6 — summary sync attempted; YouTrack returned 404 for the non-existent test
  issue, was logged with `[YouTrack]` prefix, did NOT throw, process exited 0.
- Test 7 — selfcheck config disabled + max_attempts=1 read back correctly. (2/2)

## New Files Created
- `server/scheduler.js` — schedule windows, availability checks, self-check config, next-window calc.
- `server/workflow.js` — event log, timeline shaping, workflow graph, YouTrack session summary.
- `server/routes/schedule.js` — GET/PUT `/api/agents/:id/schedule`.
- `server/routes/workflow.js` — GET `/api/workflow/{timeline,graph,events/:taskId,current}`.

## Modified Files
- `server/db.js` — added `agent_schedules`, `workflow_events`, `agent_status_history` tables; added `agents.scheduled_until` via a try/caught `ALTER TABLE` (SQLite has no `ADD COLUMN IF NOT EXISTS`).
- `server/registry.js` — added `markScheduled(agentId, minutesUntilActive)` (updates in-memory map + SQLite) and exported it.
- `server/dispatcher.js` — require scheduler+workflow; filter idle agents by `checkAgentSchedule`; attach `selfcheck` config to ASSIGN_TASK; log `task_started` workflow event.
- `server/index.js` — import scheduler+workflow; mount schedule + workflow routes; 60s schedule sweep (idle⇄scheduled transitions); `WORKFLOW_EVENT` WS handler; `handleMessage` made async; TASK_DONE now logs `task_done` and calls `syncSessionSummaryToYouTrack` (best-effort).
- `client/session.js` — added `setSelfcheckConfig`/`getSelfcheckConfig`; normalize `id` alias from `task_id`.
- `client/selfcheck.js` — rewritten to be config-aware (skip when disabled, loop to `max_attempts`, escalate to QA with notes); async `run`.
- `client/reporter.js` — added `workflowEvent(event, meta)` to emit `WORKFLOW_EVENT` over the connection.
- `client/index.js` — set selfcheck config on ASSIGN_TASK; `await` the new async selfcheck; emit `selfcheck_running` workflow event; removed obsolete `reset()`/`recordFailure()` calls.
- `ui/index.html` — added Timeline / Workflow / Schedule tabs + render logic, `scheduled` agent-card state and dot color, and handling for `WORKFLOW_EVENT` / `SCHEDULE_UPDATED` WS messages.

## UI Tabs Added
- Timeline — canvas, one row per agent, 8-hour span, colored status blocks, hover tooltip, click→task events.
- Workflow Graph — SVG nodes laid out by wave, edges between consecutive waves, color by status, click→event log; polls every 5s.
- Schedule — per-agent card: enable toggle, timezone, self-check toggle + max attempts + token budget, add/remove work windows, Save (PUT); toggle saves immediately.

## Implementation Notes
- SQLite does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; the column add is wrapped in try/catch that ignores the "duplicate column name" error.
- `handleMessage` was promoted to `async` so the TASK_DONE handler can `await` the YouTrack session-summary sync.
- The schedule router is mounted on the same `/api/agents` base as the agents router; Express single-segment `:id` matching keeps `/:id` and `/:id/schedule` from colliding.
