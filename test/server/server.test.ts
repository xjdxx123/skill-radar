import { describe, test, expect } from 'vitest';
import { openDb, type Db } from '../../src/db/index';
import { createApp } from '../../src/server/server';

function seed(): Db {
  const db = openDb(':memory:');
  const inv = db.prepare(`INSERT INTO inventory (scanned_at, kind, name, scope, description, triggers, path) VALUES ('t',?,?,?,null,null,'/p')`);
  inv.run('skill', 'graphify', 'user');
  inv.run('skill', 'verify', 'user');
  const ev = db.prepare(`INSERT INTO events (ts, session_id, project, agent, kind, name, tool_use_id) VALUES (?,?,?,?,?,?,?)`);
  for (let i = 0; i < 3; i++) ev.run('2026-06-22T00:00:00.000Z', 's', '/p', 'claude-code', 'skill', 'graphify', `g${i}`);
  db.prepare(`INSERT INTO optimizations (created_at, target_kind, target_name, status, overall_confidence, facets, applied) VALUES ('t','skill','verify','never','high','{"facets":[{"facet":"description","diagnosis":"d","suggestion":"s","confidence":"high"}],"overallConfidence":"high","trulyMissed":true,"verdictReasoning":"r"}',0)`).run();
  return db;
}

const OPTS = { windowDays: 30, underusedStaleDays: 14, now: () => new Date('2026-06-23T00:00:00.000Z') };

describe('createApp routes', () => {
  test('GET /api/stats returns the summary JSON', async () => {
    const app = createApp(seed(), OPTS);
    const res = await app.request('/api/stats');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ total: 2, used: 1, ignored: 1 });
  });

  test('GET /api/coverage returns all coverage rows', async () => {
    const app = createApp(seed(), OPTS);
    const res = await app.request('/api/coverage');
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.find((r: any) => r.name === 'graphify').invocations).toBe(3);
    expect(rows.find((r: any) => r.name === 'verify').status).toBe('never');
  });

  test('GET /api/suggestions returns stored optimization packages', async () => {
    const app = createApp(seed(), OPTS);
    const res = await app.request('/api/suggestions');
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].targetName).toBe('verify');
    expect(rows[0].pkg.facets[0].facet).toBe('description');
  });

  test('unknown route 404s', async () => {
    const app = createApp(seed(), OPTS);
    expect((await app.request('/nope')).status).toBe(404);
  });
});
