import { describe, test, expect } from 'vitest';
import { openDb } from '../../src/db/index';
import { classify, computeCoverage, normalizeMcp } from '../../src/coverage/engine';
import type { CoverageOptions } from '../../src/types';

const OPTS: CoverageOptions = {
  windowDays: 30,
  underusedStaleDays: 14,
  now: new Date('2026-06-23T00:00:00.000Z'),
};

describe('classify', () => {
  test('0 invocations → never', () => {
    expect(classify(0, null, 0, OPTS)).toBe('never');
  });
  test('recent + above rarity threshold → healthy', () => {
    expect(classify(10, '2026-06-22T00:00:00.000Z', 1, OPTS)).toBe('healthy');
  });
  test('stale last-use → underused', () => {
    expect(classify(10, '2026-05-01T00:00:00.000Z', 1, OPTS)).toBe('underused');
  });
  test('recent but at/below rarity threshold → underused', () => {
    expect(classify(1, '2026-06-22T00:00:00.000Z', 1, OPTS)).toBe('underused');
  });
  test('rarity disabled (threshold -1) → recent item stays healthy', () => {
    expect(classify(1, '2026-06-22T00:00:00.000Z', -1, OPTS)).toBe('healthy');
  });
});

describe('normalizeMcp', () => {
  test('replaces whitespace/dots with underscore but preserves hyphens', () => {
    expect(normalizeMcp('Claude Preview')).toBe('Claude_Preview');
    expect(normalizeMcp('codegraph')).toBe('codegraph');
    expect(normalizeMcp('mcp-registry')).toBe('mcp-registry');
  });
});

describe('computeCoverage', () => {
  test('classifies skills (incl. plugin-qualified), subagents, and hyphenated mcp from event aggregates', () => {
    const db = openDb(':memory:');
    const inv = db.prepare(
      `INSERT INTO inventory (scanned_at, kind, name, scope, description, triggers, path) VALUES (?,?,?,?,?,?,?)`,
    );
    inv.run('t', 'skill', 'graphify', 'user', null, null, '/g');
    inv.run('t', 'skill', 'superpowers:brainstorming', 'plugin', null, null, '/b');
    inv.run('t', 'skill', 'verify', 'user', null, null, '/v');
    inv.run('t', 'agent', 'Explore', 'user', null, null, '/e');
    inv.run('t', 'mcp', 'mcp-registry', 'user', null, null, '/m');

    const ev = db.prepare(
      `INSERT INTO events (ts, session_id, project, agent, kind, name, tool_use_id) VALUES (?,?,?,?,?,?,?)`,
    );
    for (let i = 0; i < 3; i++) ev.run('2026-06-22T00:00:00.000Z', 's', '/p', 'claude-code', 'skill', 'graphify', `g${i}`);
    for (let i = 0; i < 2; i++) ev.run('2026-06-22T00:00:00.000Z', 's', '/p', 'claude-code', 'skill', 'superpowers:brainstorming', `b${i}`);
    ev.run('2026-06-22T00:00:00.000Z', 's', '/p', 'claude-code', 'subagent', 'Explore', 'e1');
    ev.run('2026-06-22T00:00:00.000Z', 's', '/p', 'claude-code', 'tool', 'mcp__mcp-registry__search_mcp_registry', 'm1');

    const rows = computeCoverage(db, OPTS);
    const get = (name: string) => rows.find((r) => r.name === name)!;

    expect(get('graphify').invocations).toBe(3);
    expect(get('graphify').status).toBe('healthy');
    expect(get('superpowers:brainstorming').invocations).toBe(2);
    expect(get('verify').status).toBe('never');
    expect(get('Explore').invocations).toBe(1);
    expect(get('mcp-registry').invocations).toBe(1);
    expect(rows[0].status).toBe('never');
  });

  test('only counts events inside the window', () => {
    const db = openDb(':memory:');
    db.prepare(`INSERT INTO inventory (scanned_at, kind, name, scope, path) VALUES ('t','skill','old','user','/o')`).run();
    db.prepare(`INSERT INTO events (ts, session_id, project, agent, kind, name, tool_use_id) VALUES ('2026-01-01T00:00:00.000Z','s','/p','claude-code','skill','old','x1')`).run();
    const rows = computeCoverage(db, OPTS);
    expect(rows.find((r) => r.name === 'old')!.status).toBe('never');
  });
});
