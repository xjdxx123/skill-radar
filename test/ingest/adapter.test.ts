import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../../src/db/index';
import { ingestClaudeCode } from '../../src/ingest/adapter';

function transcript(sessionId: string): string {
  return [
    JSON.stringify({ type: 'user', sessionId, timestamp: '2026-06-23T10:00:00.000Z', cwd: '/proj', message: { content: 'hi' } }),
    JSON.stringify({ type: 'assistant', sessionId, timestamp: '2026-06-23T10:00:01.000Z', cwd: '/proj', message: { content: [
      { type: 'tool_use', id: `${sessionId}-skill`, name: 'Skill', input: { skill: 'graphify' }, caller: { type: 'direct' } },
    ] } }),
  ].join('\n');
}

let root: string;
let db: Db;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sr-root-'));
  db = openDb(':memory:');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('ingestClaudeCode', () => {
  test('walks nested project dirs, inserts events from each *.jsonl', () => {
    const projDir = join(root, '-Users-x-proj');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, 'a.jsonl'), transcript('sess-a'));
    writeFileSync(join(projDir, 'b.jsonl'), transcript('sess-b'));

    const res = ingestClaudeCode(db, { root });
    expect(res.filesScanned).toBe(2);
    expect(res.inserted).toBe(2);
    const c = db.prepare(`SELECT COUNT(*) AS c FROM events`).get() as { c: number };
    expect(c.c).toBe(2);
  });

  test('is idempotent: re-ingesting an unchanged file inserts nothing new', () => {
    const projDir = join(root, 'p');
    mkdirSync(projDir, { recursive: true });
    const file = join(projDir, 'a.jsonl');
    writeFileSync(file, transcript('sess-a'));
    const past = new Date('2026-06-23T09:00:00.000Z');
    utimesSync(file, past, past);

    const first = ingestClaudeCode(db, { root });
    expect(first.inserted).toBe(1);

    const second = ingestClaudeCode(db, { root });
    expect(second.filesScanned).toBe(0);
    expect(second.inserted).toBe(0);
    const c = db.prepare(`SELECT COUNT(*) AS c FROM events`).get() as { c: number };
    expect(c.c).toBe(1);
  });
});
