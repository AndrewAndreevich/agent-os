const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || './data/agentOS.db';

// Ensure the directory for the DB file exists before opening.
const dbDir = path.dirname(DB_PATH);
if (dbDir && !fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    machine_ip TEXT,
    status TEXT DEFAULT 'offline',
    role TEXT,
    capabilities TEXT DEFAULT '[]',
    current_task TEXT,
    last_heartbeat INTEGER,
    registered_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT,
    status TEXT DEFAULT 'queued',
    assigned_agent TEXT,
    required_capabilities TEXT DEFAULT '[]',
    qa_check_type TEXT,
    qa_artifact_path TEXT,
    qa_expected_output TEXT,
    qa_attempts INTEGER DEFAULT 0,
    wave INTEGER DEFAULT 1,
    started_at INTEGER,
    completed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS time_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT,
    agent_id TEXT,
    started_at INTEGER,
    stopped_at INTEGER,
    duration_seconds INTEGER,
    synced_to_youtrack INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tool_installs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT,
    tool TEXT,
    status TEXT DEFAULT 'pending',
    log TEXT DEFAULT '',
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS agent_schedules (
    agent_id TEXT PRIMARY KEY,
    enabled INTEGER DEFAULT 0,
    timezone TEXT DEFAULT 'UTC',
    windows TEXT DEFAULT '[]',
    selfcheck_enabled INTEGER DEFAULT 1,
    selfcheck_max_attempts INTEGER DEFAULT 2,
    token_budget_per_task INTEGER DEFAULT 50000,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS workflow_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    event TEXT NOT NULL,
    meta TEXT DEFAULT '{}',
    timestamp INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    status TEXT NOT NULL,
    task_id TEXT,
    timestamp INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pm_conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    session_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    status TEXT DEFAULT 'active',
    current_wave INTEGER DEFAULT 0,
    youtrack_issues TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS pm_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    meta TEXT DEFAULT '{}'
  );
`);

// SQLite has no "ADD COLUMN IF NOT EXISTS"; attempt the ALTER and ignore the
// error raised when the column is already present.
try {
  db.exec(`ALTER TABLE agents ADD COLUMN scheduled_until INTEGER`);
} catch (e) {
  if (!/duplicate column name/i.test(e.message)) {
    console.error('[db] unexpected ALTER error:', e.message);
  }
}

// Add session_id to tasks for persistent claude CLI sessions.
try {
  db.prepare('ALTER TABLE tasks ADD COLUMN session_id TEXT').run();
} catch {}

module.exports = db;
