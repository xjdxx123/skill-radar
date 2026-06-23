import { describe, test, expect } from 'vitest';
import { openDb } from '../../src/db/index';
import { findMissedInvocations } from '../../src/missed/candidates';

const OPTS = { windowDays: 30, underusedStaleDays: 14, now: new Date('2026-06-23T00:00:00.000Z') };

function seed() {
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO inventory (scanned_at, kind, name, scope, description, triggers, path) VALUES ('t','skill','verify','user',?,null,'/v')`)
    .run('Use when asked to verify a fix works by running the app');
  db.prepare(`INSERT INTO inventory (scanned_at, kind, name, scope, description, triggers, path) VALUES ('t','skill','graphify','user','build a knowledge graph',null,'/g')`).run();
  const ev = db.prepare(`INSERT INTO events (ts, session_id, project, agent, kind, name, tool_use_id) VALUES (?,?,?,?,?,?,?)`);
  for (let i = 0; i < 5; i++) ev.run('2026-06-22T00:00:00.000Z', 'sess-x', '/p', 'claude-code', 'skill', 'graphify', `g${i}`);
  const pr = db.prepare(`INSERT INTO prompts (uuid, session_id, project, ts, text) VALUES (?,?,?,?,?)`);
  pr.run('p1', 'sess-1', '/p', '2026-06-22T09:00:00.000Z', 'can you verify the fix works by running the app');
  pr.run('p2', 'sess-2', '/p', '2026-06-22T09:00:00.000Z', 'rename this css class please');
  return db;
}

describe('findMissedInvocations', () => {
  test('flags prompts that match an ignored skill not used in that session', () => {
    const db = seed();
    const rows = findMissedInvocations(db, { ...OPTS, minScore: 2, perSkill: 10, limit: 50 });
    const verifyHits = rows.filter((r) => r.skill === 'verify');
    expect(verifyHits.length).toBe(1);
    expect(verifyHits[0]).toMatchObject({ sessionId: 'sess-1', scope: 'user' });
    expect(verifyHits[0].score).toBeGreaterThanOrEqual(2);
  });

  test('does not flag healthy/used skills, nor unrelated prompts', () => {
    const db = seed();
    const rows = findMissedInvocations(db, { ...OPTS, minScore: 2, perSkill: 10, limit: 50 });
    expect(rows.some((r) => r.skill === 'graphify')).toBe(false);
    expect(rows.some((r) => r.promptText.includes('css class'))).toBe(false);
  });

  test('excludes prompts from sessions where the skill DID fire', () => {
    const db = seed();
    db.prepare(`INSERT INTO events (ts, session_id, project, agent, kind, name, tool_use_id) VALUES ('2026-06-22T09:30:00.000Z','sess-1','/p','claude-code','skill','verify','v1')`).run();
    const rows = findMissedInvocations(db, { ...OPTS, minScore: 2, perSkill: 10, limit: 50 });
    expect(rows.some((r) => r.skill === 'verify')).toBe(false);
  });
});
