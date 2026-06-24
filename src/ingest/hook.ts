import type { Agent, UsageEvent } from '../types';
import type { Db } from '../db/index';
import { classifyToolUse } from './parse';

export function parseHookEvent(payloadJson: string, opts: { now: Date; agent?: Agent }): UsageEvent | null {
  let p: any;
  try {
    p = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (!p || typeof p !== 'object') return null;

  // PostToolUse's tool_use_id is the SAME id Claude Code writes to the JSONL tool_use block
  // (the unique id of the tool call). Keying on it lets INSERT OR IGNORE on
  // UNIQUE(session_id, tool_use_id) dedup this real-time event against the later batch ingest.
  const toolUseId =
    typeof p.tool_use_id === 'string' ? p.tool_use_id : typeof p.toolUseId === 'string' ? p.toolUseId : null;
  if (!toolUseId) return null; // no shared dedup key → skip rather than risk a double-count

  const cls = classifyToolUse({ name: p.tool_name, input: p.tool_input ?? {} });
  if (!cls) return null;

  return {
    ts: opts.now.toISOString(),
    sessionId: typeof p.session_id === 'string' ? p.session_id : '',
    project: typeof p.cwd === 'string' ? p.cwd : '',
    agent: opts.agent ?? 'claude-code',
    kind: cls.kind,
    name: cls.name,
    trigger: 'hook',
    source: 'hook',
    toolUseId,
    promptExcerpt: null,
  };
}

export function ingestHookEvent(db: Db, payloadJson: string, now: Date): boolean {
  const ev = parseHookEvent(payloadJson, { now });
  if (!ev) return false;
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO events (ts, session_id, project, agent, kind, name, trigger, source, tool_use_id, prompt_excerpt)
     VALUES (@ts, @sessionId, @project, @agent, @kind, @name, @trigger, @source, @toolUseId, @promptExcerpt)`,
  );
  return stmt.run(ev).changes > 0;
}
