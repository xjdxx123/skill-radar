import { describe, test, expect } from 'vitest';
import { openDb } from '../../src/db/index';
import { statsPayload } from '../../src/server/api';
import type { CoverageOptions } from '../../src/types';

const OPTS: CoverageOptions = { windowDays: 30, underusedStaleDays: 14, now: new Date('2026-06-23T00:00:00.000Z') };

function seed() {
  const db = openDb(':memory:');
  const inv = db.prepare(`INSERT INTO inventory (scanned_at, kind, name, scope, description, triggers, path) VALUES ('t',?,?,?,null,null,'/p')`);
  inv.run('skill', 'graphify', 'user');
  inv.run('skill', 'verify', 'user');
  inv.run('agent', 'Explore', 'user');
  const ev = db.prepare(`INSERT INTO events (ts, session_id, project, agent, kind, name, tool_use_id) VALUES (?,?,?,?,?,?,?)`);
  for (let i = 0; i < 5; i++) ev.run('2026-06-22T00:00:00.000Z', 's', '/p', 'claude-code', 'skill', 'graphify', `g${i}`);
  db.prepare(`INSERT INTO optimizations (created_at, target_kind, target_name, status, overall_confidence, facets, applied) VALUES ('t','skill','verify','never','high','{"facets":[{"facet":"description","diagnosis":"d","suggestion":"s","confidence":"high"}],"overallConfidence":"high","trulyMissed":true,"verdictReasoning":"r"}',0)`).run();
  return db;
}

describe('statsPayload', () => {
  test('summarizes coverage + optimization counts', () => {
    const s = statsPayload(seed(), OPTS);
    expect(s.total).toBe(3);
    expect(s.used).toBe(1);
    expect(s.coveragePct).toBe(33);
    expect(s.ignored).toBe(2);
    expect(s.healthy).toBe(1);
    expect(s.suggestions).toBe(1);
    expect(s.windowDays).toBe(30);
  });

  test('empty db → zeros (no divide-by-zero)', () => {
    const s = statsPayload(openDb(':memory:'), OPTS);
    expect(s).toMatchObject({ total: 0, used: 0, coveragePct: 0, ignored: 0, underused: 0, healthy: 0, suggestions: 0 });
  });
});
