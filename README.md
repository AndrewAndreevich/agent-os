# AgentOS

A distributed AI agent management system. A central **orchestrator** dispatches
tasks to **agent** machines over WebSocket, tracks heartbeats and time, runs
self-validation and QA workflows, and reports progress to YouTrack. A vanilla
HTML/CSS/JS dashboard gives live visibility into agents, the task queue, sprint
waves, and per-machine tool installs.

## Architecture

```
┌────────────┐      WebSocket /ws       ┌──────────────────────┐
│  Web UI    │◀────────broadcasts───────│   Orchestrator        │
│ (browser)  │                          │   (server/)           │
└────────────┘                          │  Express + ws + SQLite│
                                        └──────────┬───────────┘
                                                   │ ASSIGN_TASK / INSTALL_TOOL
                                                   ▼
                                        ┌──────────────────────┐
                                        │  Agent client(s)      │
                                        │  (client/)            │
                                        │  executor / git / QA  │
                                        └──────────────────────┘
```

- **Server** (`server/`): Express REST API, WebSocket hub, SQLite persistence,
  task queue, dispatcher, heartbeat monitor, YouTrack + time tracking.
- **Client** (`client/`): connects to the orchestrator, registers, receives
  tasks, runs them via the Claude CLI, self-validates, commits to git, and
  reports results. Also receives and runs tool-install scripts.
- **UI** (`ui/index.html`): single-file dashboard. Connects to `/ws?ui=1`.

## Requirements

- Node.js 18+ (uses the global `fetch`)
- Python 3 (for `validate-env` and `compile`/`run_script` self-checks)
- PM2 (process manager)
- The `claude` CLI on agent machines (override with `CLAUDE_CMD`)

## Install

```bash
cd agent-os
npm install
cp .env.example .env   # fill in values
```

## Run the orchestrator

```bash
npm run server
# or with PM2:
pm2 start ecosystem.config.js --only agentOS-server
```

Open the dashboard at <http://localhost:3000>.

## Run an agent

On each agent machine, set the client variables in `.env`
(`ORCHESTRATOR_URL`, `AGENT_ID`, `AGENT_ROLE`, `CAPABILITIES`, …), then:

```bash
npm run client
# or with PM2:
pm2 start ecosystem.config.js --only agentOS-client
```

Or use the bootstrap script (Linux): `REPO_URL=... bash scripts/bootstrap.sh`.

## REST API

| Method | Path                      | Description                              |
|--------|---------------------------|------------------------------------------|
| GET    | `/api/agents`             | All agents                               |
| GET    | `/api/agents/:id`         | One agent + task history + installs      |
| POST   | `/api/agents/:id/install` | Install a tool on an agent               |
| GET    | `/api/tasks`              | All tasks                                |
| GET    | `/api/queue`              | Queued tasks                             |
| POST   | `/api/tasks`              | Create + enqueue a task                  |
| GET    | `/api/tools`              | Available tools                          |
| POST   | `/api/tools/install`      | Bulk tool install                        |
| GET    | `/api/sprint/current`     | Tasks grouped by wave with progress      |

### Create a task

```bash
curl -X POST http://localhost:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"id":"PVF-1","title":"Build service","required_capabilities":["base"],
       "qa_check_type":"file_exists","qa_artifact_path":"./out.txt","wave":1}'
```

## WebSocket protocol

All messages are JSON with a `type` field. See `shared/constants.js` (`WS_TYPES`)
and `shared/messages.js` for the full set of client→server, server→client, and
server→UI message factories.

## Task lifecycle

```
queued → dispatched → in_progress → selfcheck → qa_review → need_review/done
```

The dispatcher matches the first queued task whose `required_capabilities` are a
subset of an idle agent's capabilities. If an agent's heartbeat is older than
90s, it is marked offline and its in-flight task is returned to the queue.

## Project layout

```
server/   orchestrator (Express + ws + SQLite)
client/   agent runtime (executor, git, selfcheck, installer, roles)
ui/       single-file dashboard
shared/   constants + message factories (used by both sides)
scripts/  bootstrap, env validation, manual registration
```

## Roles

`client/roles/{dev,qa,pm}.md` define the system prompts handed to the executor
for development, QA, and planning agents respectively.
