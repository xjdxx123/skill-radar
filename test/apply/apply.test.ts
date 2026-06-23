import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../../src/db/index';
import { applyOptimization } from '../../src/apply/apply';

let dir: string;
let skillPath: string;
const ORIG = '---\nname: verify\ndescription: "old desc"\n---\nrun the app\n';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sr-apply-'));
  skillPath = join(dir, 'SKILL.md');
  writeFileSync(skillPath, ORIG);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function seed(scope = 'user', withOpt = true, descFacet = true): Db {
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO inventory (scanned_at, kind, name, scope, description, triggers, path) VALUES ('t','skill','verify',?,?,null,?)`)
    .run(scope, 'old desc', skillPath);
  if (withOpt) {
    const facets = descFacet
      ? [{ facet: 'description', diagnosis: 'vague', suggestion: 'Use when verifying a fix by running the app', confidence: 'high' },
         { facet: 'triggers', diagnosis: 'missing', suggestion: 'add: confirm the fix works', confidence: 'medium' }]
      : [{ facet: 'triggers', diagnosis: 'missing', suggestion: 'add: confirm the fix works', confidence: 'medium' }];
    db.prepare(`INSERT INTO optimizations (created_at, target_kind, target_name, status, overall_confidence, facets, applied) VALUES ('t','skill','verify','never','high',?,0)`)
      .run(JSON.stringify({ trulyMissed: true, verdictReasoning: 'r', overallConfidence: 'high', facets }));
  }
  return db;
}

describe('applyOptimization', () => {
  test('dry-run reports old→new but does NOT modify the file', () => {
    const db = seed();
    const r = applyOptimization(db, { skill: 'verify', write: false });
    expect(r.status).toBe('dry-run');
    expect(r.oldDescription).toBe('old desc');
    expect(r.newDescription).toBe('Use when verifying a fix by running the app');
    expect(readFileSync(skillPath, 'utf8')).toBe(ORIG);
    expect(existsSync(skillPath + '.bak')).toBe(false);
    expect(r.otherFacets?.some((f) => f.facet === 'triggers')).toBe(true);
  });

  test('--write backs up then rewrites the description', () => {
    const db = seed();
    const r = applyOptimization(db, { skill: 'verify', write: true });
    expect(r.status).toBe('applied');
    expect(r.backupPath).toBe(skillPath + '.bak');
    expect(readFileSync(skillPath + '.bak', 'utf8')).toBe(ORIG);
    const updated = readFileSync(skillPath, 'utf8');
    expect(updated).toContain('description: "Use when verifying a fix by running the app"');
    expect(updated).toContain('name: verify');
    expect(updated).toContain('run the app');
  });

  test('refuses non-user/project scope (plugin skills are not editable)', () => {
    const db = seed('plugin');
    const r = applyOptimization(db, { skill: 'verify', write: true });
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/plugin|user.*project|scope/i);
    expect(readFileSync(skillPath, 'utf8')).toBe(ORIG);
  });

  test('skips when there is no stored optimization', () => {
    const db = seed('user', false);
    const r = applyOptimization(db, { skill: 'verify', write: true });
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/no optimization|analyze/i);
  });

  test('skips when the optimization has no description facet', () => {
    const db = seed('user', true, false);
    const r = applyOptimization(db, { skill: 'verify', write: true });
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/description/i);
  });

  test('skips when the skill is not in inventory', () => {
    const db = seed();
    const r = applyOptimization(db, { skill: 'ghost', write: true });
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/not found|inventory/i);
  });
});
