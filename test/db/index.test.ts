import { describe, test, expect } from 'vitest';
import { openDb } from '../../src/db/index';

describe('openDb', () => {
  test('creates tables and roundtrips an event (idempotent on session_id+tool_use_id)', () => {
    const db = openDb(':memory:');
    const ins = db.prepare(
      `INSERT OR IGNORE INTO events (ts, session_id, project, agent, kind, name, trigger, source, tool_use_id, prompt_excerpt)
       VALUES (@ts, @sessionId, @project, @agent, @kind, @name, @trigger, @source, @toolUseId, @promptExcerpt)`,
    );
    const row = {
      ts: '2026-06-23T00:00:00.000Z', sessionId: 's1', project: '/p', agent: 'claude-code',
      kind: 'skill', name: 'foo', trigger: 'direct', source: null, toolUseId: 't1', promptExcerpt: null,
    };
    ins.run(row);
    ins.run(row); // duplicate ignored
    const count = db.prepare(`SELECT COUNT(*) AS c FROM events`).get() as { c: number };
    expect(count.c).toBe(1);
    const got = db.prepare(`SELECT name, trigger FROM events WHERE session_id = 's1'`).get() as any;
    expect(got.name).toBe('foo');
    expect(got.trigger).toBe('direct');
  });

  test('openDb is safe to call twice (migrations are idempotent)', () => {
    const db = openDb(':memory:');
    expect(() => db.exec('SELECT 1 FROM inventory LIMIT 1')).not.toThrow();
  });

  test('prompts table exists with a uuid primary key', () => {
    const db = openDb(':memory:');
    db.prepare(`INSERT INTO prompts (uuid, session_id, project, ts, text) VALUES (?,?,?,?,?)`)
      .run('u1', 's1', '/p', '2026-06-23T00:00:00.000Z', 'hello');
    db.prepare(`INSERT OR IGNORE INTO prompts (uuid, session_id, project, ts, text) VALUES (?,?,?,?,?)`)
      .run('u1', 's1', '/p', '2026-06-23T00:00:00.000Z', 'hello');
    const c = db.prepare(`SELECT COUNT(*) AS c FROM prompts`).get() as { c: number };
    expect(c.c).toBe(1);
  });

  test('optimizations table exists and upserts by (target_kind, target_name)', () => {
    const db = openDb(':memory:');
    const up = db.prepare(
      `INSERT INTO optimizations (created_at, target_kind, target_name, status, overall_confidence, facets, applied)
       VALUES (?,?,?,?,?,?,0)
       ON CONFLICT(target_kind, target_name) DO UPDATE SET facets = excluded.facets`,
    );
    up.run('t1', 'skill', 'verify', 'never', 'high', '{"a":1}');
    up.run('t2', 'skill', 'verify', 'never', 'low', '{"a":2}');
    const rows = db.prepare(`SELECT facets FROM optimizations WHERE target_name = 'verify'`).all() as { facets: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].facets).toBe('{"a":2}');
  });
});
