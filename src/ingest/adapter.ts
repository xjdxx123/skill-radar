import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db/index';
import type { InventoryItem, UsageEvent } from '../types';
import { parseTranscript } from './parse';
import { extractPrompts } from './prompts';

export interface IngestResult {
  filesScanned: number;
  inserted: number;
}

/**
 * A pluggable source of usage data. This is a typed placeholder for the Codex
 * adapter added in Plan 2; in Plan 1 only the standalone `ingestClaudeCode`
 * function below is used. Method names match the spec (scanInventory,
 * ingestEvents) so Plan 2 needs no rename.
 */
export interface SourceAdapter {
  readonly agent: string;
  ingestEvents(db: Db, opts: { root: string }): IngestResult;
  scanInventory(opts: Record<string, unknown>): InventoryItem[];
}

function walkJsonl(dir: string): string[] {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkJsonl(full));
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

function insertEvents(db: Db, events: UsageEvent[]): number {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO events (ts, session_id, project, agent, kind, name, trigger, source, tool_use_id, prompt_excerpt)
     VALUES (@ts, @sessionId, @project, @agent, @kind, @name, @trigger, @source, @toolUseId, @promptExcerpt)`,
  );
  let inserted = 0;
  const tx = db.transaction((rows: UsageEvent[]) => {
    for (const r of rows) inserted += stmt.run(r).changes;
  });
  tx(events);
  return inserted;
}

function insertPrompts(db: Db, content: string): void {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO prompts (uuid, session_id, project, ts, text)
     VALUES (@uuid, @sessionId, @project, @ts, @text)`,
  );
  const rows = extractPrompts(content);
  const tx = db.transaction((rs: ReturnType<typeof extractPrompts>) => {
    for (const r of rs) stmt.run(r);
  });
  tx(rows);
}

export function ingestClaudeCode(db: Db, opts: { root: string }): IngestResult {
  const files = walkJsonl(opts.root);
  const getCursor = db.prepare(`SELECT mtime FROM ingest_cursors WHERE file_path = ?`);
  const upsertCursor = db.prepare(
    `INSERT INTO ingest_cursors (file_path, byte_offset, mtime) VALUES (?, 0, ?)
     ON CONFLICT(file_path) DO UPDATE SET mtime = excluded.mtime`,
  );

  let filesScanned = 0;
  let inserted = 0;
  for (const file of files) {
    const mtime = Math.floor(statSync(file).mtimeMs);
    const prev = getCursor.get(file) as { mtime: number } | undefined;
    if (prev && prev.mtime === mtime) continue;
    filesScanned += 1;
    const content = readFileSync(file, 'utf8');
    inserted += insertEvents(db, parseTranscript(content));
    insertPrompts(db, content);
    upsertCursor.run(file, mtime);
  }
  return { filesScanned, inserted };
}
