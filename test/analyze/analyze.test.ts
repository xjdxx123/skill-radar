import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../../src/db/index';
import { analyzeSkills } from '../../src/analyze/analyze';

const VALID = JSON.stringify({
  trulyMissed: true, verdictReasoning: 'matched', overallConfidence: 'high',
  facets: [{ facet: 'description', diagnosis: 'too vague', suggestion: 'Use when verifying a fix by running the app', confidence: 'high' }],
});

let dir: string;
let skillPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sr-an-'));
  skillPath = join(dir, 'SKILL.md');
  writeFileSync(skillPath, '---\nname: verify\ndescription: verify a change\n---\nrun the app');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function seed(): Db {
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO inventory (scanned_at, kind, name, scope, description, triggers, path) VALUES ('t','skill','verify','user',?,null,?)`)
    .run('verify a change by running the app', skillPath);
  db.prepare(`INSERT INTO inventory (scanned_at, kind, name, scope, description, triggers, path) VALUES ('t','skill','code-review','user','review code',null,'/cr')`).run();
  db.prepare(`INSERT INTO prompts (uuid, session_id, project, ts, text) VALUES ('p1','s1','/p','2026-06-22T09:00:00.000Z',?)`)
    .run('can you verify the fix works by running the app');
  return db;
}

const BASE = { windowDays: 30, underusedStaleDays: 14, now: new Date('2026-06-23T00:00:00.000Z'),
  minScore: 2, perSkill: 5, candidateLimit: 50, maxPromptsPerSkill: 4, limit: 5 };

describe('analyzeSkills', () => {
  test('runs the runner for an ignored candidate skill and stores the parsed package', async () => {
    const db = seed();
    let capturedPrompt = '';
    const runner = async (p: string) => { capturedPrompt = p; return VALID; };
    const res = await analyzeSkills(db, { ...BASE, runner });
    expect(res.analyzed).toBe(1);
    expect(res.stored).toBe(1);
    expect(res.skipped).toBe(0);
    expect(capturedPrompt).toContain('verify');
    expect(capturedPrompt).toContain('can you verify the fix works by running the app');
    expect(capturedPrompt).toContain('code-review');
    const row = db.prepare(`SELECT target_name, status, overall_confidence, facets FROM optimizations`).get() as any;
    expect(row.target_name).toBe('verify');
    expect(row.overall_confidence).toBe('high');
    expect(JSON.parse(row.facets).facets[0].facet).toBe('description');
  });

  test('skips (no store, no throw) when the runner returns unparseable output', async () => {
    const db = seed();
    const res = await analyzeSkills(db, { ...BASE, runner: async () => 'sorry, I cannot help' });
    expect(res.analyzed).toBe(1);
    expect(res.stored).toBe(0);
    expect(res.skipped).toBe(1);
    expect((db.prepare(`SELECT COUNT(*) AS c FROM optimizations`).get() as any).c).toBe(0);
  });

  test('skips (no throw) when the runner rejects', async () => {
    const db = seed();
    const res = await analyzeSkills(db, { ...BASE, runner: async () => { throw new Error('claude exited 1'); } });
    expect(res.stored).toBe(0);
    expect(res.skipped).toBe(1);
  });

  test('analyzes nothing when there are no candidates', async () => {
    const db = openDb(':memory:');
    const res = await analyzeSkills(db, { ...BASE, runner: async () => VALID });
    expect(res).toEqual({ analyzed: 0, stored: 0, skipped: 0 });
  });

  test('respects --limit (analyzes at most `limit` skills)', async () => {
    const db = seed();
    db.prepare(`INSERT INTO inventory (scanned_at, kind, name, scope, description, triggers, path) VALUES ('t','skill','deploy','user','deploy the running application to production',null,?)`).run(skillPath);
    db.prepare(`INSERT INTO prompts (uuid, session_id, project, ts, text) VALUES ('p2','s2','/p','2026-06-22T09:00:00.000Z','please deploy the running application to production')`).run();
    let calls = 0;
    const res = await analyzeSkills(db, { ...BASE, limit: 1, runner: async () => { calls += 1; return VALID; } });
    expect(res.analyzed).toBe(1);
    expect(calls).toBe(1);
    expect((db.prepare(`SELECT COUNT(*) AS c FROM optimizations`).get() as any).c).toBe(1);
  });
});
