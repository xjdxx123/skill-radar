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
`;
