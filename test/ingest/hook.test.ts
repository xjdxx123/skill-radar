import { describe, test, expect } from 'vitest';
import { parseHookEvent } from '../../src/ingest/hook';
import { openDb } from '../../src/db/index';
import { ingestHookEvent } from '../../src/ingest/hook';

const NOW = new Date('2026-06-23T12:00:00.000Z');

describe('parseHookEvent', () => {
  test('parses a Skill PostToolUse payload into a skill event keyed by tool_use_id', () => {
    const payload = JSON.stringify({ session_id: 's1', cwd: '/p', hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'graphify' }, tool_use_id: 'tu-1' });
    const ev = parseHookEvent(payload, { now: NOW })!;
    expect(ev).toMatchObject({ kind: 'skill', name: 'graphify', sessionId: 's1', project: '/p', toolUseId: 'tu-1', source: 'hook', trigger: 'hook' });
    expect(ev.ts).toBe('2026-06-23T12:00:00.000Z');
  });

  test('parses an Agent payload into a subagent event', () => {
    const payload = JSON.stringify({ session_id: 's', cwd: '/p', tool_name: 'Agent', tool_input: { subagent_type: 'Explore' }, tool_use_id: 'tu-2' });
    expect(parseHookEvent(payload, { now: NOW })).toMatchObject({ kind: 'subagent', name: 'Explore', toolUseId: 'tu-2' });
  });

  test('parses a plain tool payload', () => {
    const payload = JSON.stringify({ session_id: 's', cwd: '/p', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'tu-3' });
    expect(parseHookEvent(payload, { now: NOW })).toMatchObject({ kind: 'tool', name: 'Bash', toolUseId: 'tu-3' });
  });

  test('accepts the camelCase toolUseId fallback', () => {
    const payload = JSON.stringify({ session_id: 's', cwd: '/p', tool_name: 'Skill', tool_input: { skill: 'x' }, toolUseId: 'tu-4' });
    expect(parseHookEvent(payload, { now: NOW })!.toolUseId).toBe('tu-4');
  });

  test('returns null without a tool_use_id (no dedup key)', () => {
    const payload = JSON.stringify({ session_id: 's', cwd: '/p', tool_name: 'Skill', tool_input: { skill: 'x' } });
    expect(parseHookEvent(payload, { now: NOW })).toBeNull();
  });

  test('returns null for malformed JSON or an untrackable payload', () => {
    expect(parseHookEvent('not json', { now: NOW })).toBeNull();
    expect(parseHookEvent(JSON.stringify({ tool_use_id: 't', tool_name: 'Skill', tool_input: {} }), { now: NOW })).toBeNull();
  });
});

const skillPayload = (id: string) => JSON.stringify({ session_id: 's', cwd: '/p', tool_name: 'Skill', tool_input: { skill: 'graphify' }, tool_use_id: id });

describe('ingestHookEvent', () => {
  test('inserts one event and is idempotent on (session, tool_use_id)', () => {
    const db = openDb(':memory:');
    expect(ingestHookEvent(db, skillPayload('t1'), NOW)).toBe(true);
    expect(ingestHookEvent(db, skillPayload('t1'), NOW)).toBe(false);
    expect((db.prepare(`SELECT COUNT(*) AS c FROM events`).get() as any).c).toBe(1);
  });

  test('dedups against a JSONL-ingested event with the same session + tool_use_id', () => {
    const db = openDb(':memory:');
    db.prepare(`INSERT INTO events (ts, session_id, project, agent, kind, name, tool_use_id) VALUES ('2026-06-22T00:00:00.000Z','s','/p','claude-code','skill','graphify','t1')`).run();
    expect(ingestHookEvent(db, skillPayload('t1'), NOW)).toBe(false);
    expect((db.prepare(`SELECT COUNT(*) AS c FROM events`).get() as any).c).toBe(1);
  });

  test('returns false for an untrackable payload', () => {
    expect(ingestHookEvent(openDb(':memory:'), 'garbage', NOW)).toBe(false);
  });
});
