# AgentOS YouTrack Integration Test Results

Date: 2026-06-16
YouTrack URL: https://libraryabout.youtrack.cloud
Project: PVF

## Credentials
- Source: ~/.claude/tools/yt_config.json (referenced by yt.py; token/url/project auto-extracted)
- Connectivity: PASS

## Step Results
| Step | Name | Result | Notes |
|------|------|--------|-------|
| 0  | Find credentials | PASS | yt.py reads `yt_config.json`; extracted url/token/project (PVF) |
| 1  | Patch .env | PASS | Created `agent-os/.env` with real credentials |
| 2  | Connectivity check | PASS | 10 projects visible: AJI, CON, CT, DEMO, MIS, PLA, PVF, SCA, TRI, VID |
| 3  | Read project issues | PASS | Fetched PVF issues (e.g. 3-186, 3-185, 3-184) |
| 4  | Discover transitions | PASS | **No `/transitions` subresource (404)** — state set via State custom field. States: Submitted, Open, In Progress, To be discussed, Reopened, Can't Reproduce, Duplicate, Fixed, Won't fix, Incomplete, Obsolete, Verified, Needs Review |
| 5  | Discover custom fields | PASS | See list below; QA fields absent → description fallback |
| 6  | Implement youtrack.js | PASS | All 7 methods + createIssue implemented against real API |
| 7  | Implement webhook receiver | PASS | `POST /api/youtrack/webhook` + state→status map |
| 8  | Test getIssue | PASS | Got issue 3-186 |
| 9  | Test addComment | PASS | Comment added to PVF-85 |
| 10 | Test worklog | PASS | Worklog added (author-login fallback: log without author) |
| 11 | Test transition | PASS | PVF-85 → "In Progress" (via State field) |
| 12 | Full webhook flow | PASS | Webhook enqueued PVF-85, dispatched=1, dev agent received task_id PVF-85 |
| 13 | Webhook setup | INFO | Automatic API registration returns HTTP 404 on this instance — manual setup required |
| 14 | Env updated | PASS | `ORCHESTRATOR_WEBHOOK_URL` appended |
| 15 | Smoke test | PASS | validate-env 4/4; /api/agents, /api/tasks, UI all PASS |

## YouTrack State → AgentOS Status Mapping
(defined as `YT_STATE_MAP` at the top of `server/index.js`; keys are lower-cased)

| YouTrack State | AgentOS Status | Webhook Action |
|----------------|----------------|----------------|
| Submitted / Open / Reopened | queued | enqueue + tryDispatch |
| In Progress | in_progress | enqueue + tryDispatch (assign to dev agent) |
| QA Review / Needs Review | qa_review | hand off to a `qa`-role agent (ASSIGN_TASK role=qa) |
| Need Review | need_review | release agent (markIdle) + tryDispatch |
| Fixed / Verified / Done | done | release agent (markIdle) + tryDispatch |
| (anything else) | — | ignored (200, action=ignored) |

Note: this PVF instance uses **"Needs Review"** (not the spec's "QA Review") and
**"Fixed"/"Verified"** (not "Done"). Both the real names and the spec aliases are
mapped, so either naming triggers the correct action.

## Custom Fields Available (project PVF)
- Priority — enum
- Type — enum
- State — state (used for transitions)
- Subsystem — ownedField
- Fix versions / Affected versions — version
- Fixed in build — build
- Assignee — user
- Estimation — period
- Spent time — period
- Calendar Time — period
- **Agent Role** — string
- **Tokens Used** — integer
- Timer time — date and time

**Absent:** `qa_check_type`, `qa_artifact_path`, `qa_expected_output`.
`updateCustomField` and `createIssue` therefore fall back to writing this QA
metadata into the issue **description**.

## Key Implementation Decisions (real-instance adaptations)
1. **Transitions via State field.** The `/issues/{id}/transitions` endpoint 404s on
   this instance. `transitionIssue` instead resolves the canonical state name from
   the project State bundle (case-insensitive) and writes the `State` custom field
   with a `StateBundleElement` value — the same approach as the project's `yt.py`.
2. **Worklog author fallback.** Posting a work item with `author:{login:agentId}`
   fails (HTTP 400 — the agent id isn't a YouTrack user). `addWorklog` retries
   without the author and succeeds; returns null only if time tracking is truly
   unavailable.
3. **QA-field fallback to description.** Since the QA custom fields don't exist,
   `updateCustomField`/`createIssue` append the metadata to the description.
4. **No-throw contract.** Every method is wrapped in try/catch, logs with a
   `[YouTrack]` prefix, and returns null on failure.
5. **Webhook dispatch correctness.** Relies on the dispatcher fixes from the prior
   E2E run (skip dead sockets; heartbeat-driven offline) so a webhook-enqueued
   issue is dispatched to a live, idle agent.

## Modified Files
- `agent-os/.env` — **created**; real YouTrack credentials, PORT, DB_PATH, ORCHESTRATOR_WEBHOOK_URL.
- `agent-os/server/youtrack.js` — **rewritten**; full real API client (getIssue, transitionIssue, addComment, addWorklog, updateCustomField, getSprintIssues, createIssue) with the adaptations above.
- `agent-os/server/index.js` — **added** `YT_STATE_MAP` config and the `POST /api/youtrack/webhook` route.

## Test Side Effects in YouTrack (for manual cleanup if desired)
- Created issue **PVF-85** "[AgentOS Test] Delete me" (has a test comment, a 1-minute worklog, and is in state "In Progress"). Safe to delete.
