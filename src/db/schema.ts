export const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  session_id TEXT NOT NULL,
  project TEXT NOT NULL,
  agent TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger TEXT,
  source TEXT,
  tool_use_id TEXT,
  prompt_excerpt TEXT,
  UNIQUE(session_id, tool_use_id)
);
CREATE INDEX IF NOT EXISTS idx_events_kind_name ON events(kind, name);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);

CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scanned_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL,
  description TEXT,
  triggers TEXT,
  path TEXT NOT NULL,
  UNIQUE(kind, name, scope)
);

-- Reserved for Plan 2 (session-level rollups); not written in Plan 1.
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  project TEXT,
  started_at TEXT,
  ended_at TEXT,
  prompt_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ingest_cursors (
  file_path TEXT PRIMARY KEY,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  mtime INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS prompts (
  uuid TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  project TEXT NOT NULL,
  ts TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prompts_session ON prompts(session_id);

CREATE TABLE IF NOT EXISTS optimizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_name TEXT NOT NULL,
  status TEXT NOT NULL,
  overall_confidence TEXT,
  facets TEXT NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0,
  UNIQUE(target_kind, target_name)
);
`;
