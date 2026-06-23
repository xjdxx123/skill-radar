# skill-radar Plan 2a — Accuracy + Missed-Invocation Detection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "ignored" set trustworthy by tracking slash-command invocations, build a prompt corpus, and add a deterministic missed-invocation detector that surfaces — with evidence — the prompts where an ignored/underused skill plausibly *should* have fired but didn't. Expose it via a `candidates` CLI command.

**Architecture:** Extends Plan 1. The parser additionally emits `command`-kind events from `<command-name>` records and a full prompt corpus (`prompts` table). The coverage engine bridges slash-command events to skills so `/`-invoked skills no longer read as ignored. A new `missed/` module does high-recall keyword matching of ignored/underused skills' descriptions against prompts in sessions where the skill never fired, ranked by overlap — the evidence layer that Plan 2b's AI loop will adjudicate.

**Tech Stack:** Same as Plan 1 — TypeScript (Node ≥20), `better-sqlite3`, `commander`, `vitest`, `tsx`. Builds on Plan 1's `src/` modules.

**Scope note:** Plan 2a is fully **deterministic — no AI / headless Claude Code** (that is Plan 2b). It produces trustworthy coverage + a ranked candidate list (the "missed-invocation evidence" the user chose to prioritize). It does **not** generate optimization packages or rewrite anything yet.

**Prerequisite:** Plan 1 is merged/available in the working branch (`src/types.ts`, `src/db/*`, `src/ingest/*`, `src/inventory/*`, `src/coverage/*`, `src/cli.ts`).

---

## Grounded schema facts (verified on disk)

- Slash command: `type:'user'` record, top-level `uuid`, `message.content` is a **string** beginning `<command-name>/NAME</command-name>\n<command-message>…</command-message>\n<command-args>…</command-args>`. (`/model`, `/login` are built-ins; `/graphify`, `/code-review` are skills.)
- Normal prompt: `type:'user'` record, top-level `uuid`, `message.content` is a string or an array of `{type:'text',text}` blocks.
- Plan 1's null-id guard skips tool_use blocks with no string `id`; command events sidestep it by using the record `uuid` as `toolUseId` (so `UNIQUE(session_id, tool_use_id)` still gives idempotency).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/types.ts` | modify | add `'command'` to `EventKind`; add `PromptRow`, `MissedCandidate` |
| `src/db/schema.ts` | modify | add `prompts` table |
| `src/ingest/parse.ts` | modify | emit `command` events from `<command-name>` records |
| `src/ingest/prompts.ts` | create | `extractPrompts(content)` — full user-prompt corpus |
| `src/ingest/adapter.ts` | modify | also insert prompts during ingest |
| `src/coverage/engine.ts` | modify | bridge `command` events → skills in `matches()` |
| `src/missed/keywords.ts` | create | `keywordsFor`, `scorePrompt` — pure scoring helpers |
| `src/missed/candidates.ts` | create | `findMissedInvocations(db, opts)` |
| `src/missed/report.ts` | create | `formatCandidates(rows)` |
| `src/cli.ts` | modify | add `candidates` command |
| `test/**` | create | tests per task |

---

## Task 1: Track slash-command invocations in the parser

**Files:**
- Modify: `src/types.ts`, `src/ingest/parse.ts`
- Test: `test/ingest/parse.test.ts` (add cases)

- [ ] **Step 1: Add `'command'` to `EventKind`**

In `src/types.ts`, change:
```ts
export type EventKind = 'skill' | 'tool' | 'subagent';
```
to:
```ts
export type EventKind = 'skill' | 'tool' | 'subagent' | 'command';
```

- [ ] **Step 2: Write the failing tests (append to the existing `describe('parseTranscript', ...)`)**

Add to `test/ingest/parse.test.ts`:
```ts
  test('emits a command event from a <command-name> user record (slash invocation)', () => {
    const line = JSON.stringify({
      type: 'user', sessionId: 'sess-1', timestamp: '2026-06-23T10:00:00.000Z', cwd: '/proj', uuid: 'u-cmd-1',
      message: { content: '<command-name>/graphify</command-name>\n<command-message>graphify</command-message>\n<command-args></command-args>' },
    });
    const events = parseTranscript(line);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'command', name: 'graphify', trigger: 'slash', toolUseId: 'u-cmd-1' });
  });

  test('does not let command XML overwrite the real preceding prompt excerpt', () => {
    const fixture = [
      JSON.stringify({ type: 'user', sessionId: 's', timestamp: '2026-06-23T10:00:00.000Z', cwd: '/p', uuid: 'u0',
        message: { content: 'do the thing' } }),
      JSON.stringify({ type: 'user', sessionId: 's', timestamp: '2026-06-23T10:00:00.500Z', cwd: '/p', uuid: 'u1',
        message: { content: '<command-name>/code-review</command-name>\n<command-message>cr</command-message>\n<command-args></command-args>' } }),
      JSON.stringify({ type: 'assistant', sessionId: 's', timestamp: '2026-06-23T10:00:01.000Z', cwd: '/p',
        message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } }),
    ].join('\n');
    const events = parseTranscript(fixture);
    const bash = events.find((e) => e.toolUseId === 't1')!;
    expect(bash.promptExcerpt).toBe('do the thing'); // command XML must NOT replace the real prompt as lastPrompt
    const cmd = events.find((e) => e.kind === 'command')!;
    expect(cmd.name).toBe('code-review');
  });
```

- [ ] **Step 3: Run tests to verify the two new ones fail**

Run: `npx vitest run test/ingest/parse.test.ts`
Expected: the two new tests FAIL (no command events emitted yet); the existing tests still pass.

- [ ] **Step 4: Update the `type === 'user'` branch in `src/ingest/parse.ts`**

Replace the existing user branch:
```ts
    if (rec.type === 'user') {
      const t = userText(msgContent);
      if (t) lastPrompt = t;
      continue;
    }
```
with:
```ts
    if (rec.type === 'user') {
      const raw = typeof msgContent === 'string' ? msgContent : null;
      if (raw && raw.includes('<command-name>')) {
        const m = raw.match(/<command-name>\s*\/?([^<]+?)\s*<\/command-name>/);
        const cmd = m?.[1]?.trim();
        const uuid = typeof rec.uuid === 'string' ? rec.uuid : null;
        if (cmd && uuid) {
          events.push({
            ts: typeof rec.timestamp === 'string' ? rec.timestamp : '',
            sessionId: typeof rec.sessionId === 'string' ? rec.sessionId : '',
            project: typeof rec.cwd === 'string' ? rec.cwd : '',
            agent,
            kind: 'command',
            name: cmd,
            trigger: 'slash',
            source: null,
            toolUseId: uuid,
            promptExcerpt: null,
          });
        }
        continue; // command XML is not a natural-language prompt
      }
      const t = userText(msgContent);
      if (t) lastPrompt = t;
      continue;
    }
```

- [ ] **Step 5: Run tests to verify all pass**

Run: `npx vitest run test/ingest/parse.test.ts`
Expected: PASS (all parse tests, including the 2 new ones and the Plan-1 null-id test).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/ingest/parse.ts test/ingest/parse.test.ts
git commit -m "feat(ingest): track slash-command invocations as command events"
```

---

## Task 2: Bridge slash-command events to skills in coverage

**Files:**
- Modify: `src/coverage/engine.ts`
- Test: `test/coverage/engine.test.ts` (add a case)

A skill counts as *used* if it was invoked via the `Skill` tool (event kind `skill`) **or** via a slash command (event kind `command`). Plugin skills invoked by their bare slash name (`/brainstorming`) bridge to the qualified inventory name (`superpowers:brainstorming`) via a suffix match — used here only for the command→skill bridge, where recall matters and collision risk is low.

- [ ] **Step 1: Write the failing test (append to `describe('computeCoverage', ...)`)**

Add to `test/coverage/engine.test.ts`:
```ts
  test('a slash-command invocation counts the skill as used (not ignored)', () => {
    const db = openDb(':memory:');
    const inv = db.prepare(
      `INSERT INTO inventory (scanned_at, kind, name, scope, description, triggers, path) VALUES (?,?,?,?,?,?,?)`,
    );
    inv.run('t', 'skill', 'code-review', 'user', null, null, '/cr');
    inv.run('t', 'skill', 'superpowers:brainstorming', 'plugin', null, null, '/b');

    const ev = db.prepare(
      `INSERT INTO events (ts, session_id, project, agent, kind, name, tool_use_id) VALUES (?,?,?,?,?,?,?)`,
    );
    // invoked as /code-review (command kind, exact name)
    ev.run('2026-06-22T00:00:00.000Z', 's', '/p', 'claude-code', 'command', 'code-review', 'c1');
    // invoked as /brainstorming (bare) — bridges to the plugin-qualified inventory name
    ev.run('2026-06-22T00:00:00.000Z', 's', '/p', 'claude-code', 'command', 'brainstorming', 'c2');

    const rows = computeCoverage(db, OPTS);
    expect(rows.find((r) => r.name === 'code-review')!.invocations).toBe(1);
    expect(rows.find((r) => r.name === 'code-review')!.status).not.toBe('never');
    expect(rows.find((r) => r.name === 'superpowers:brainstorming')!.invocations).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/coverage/engine.test.ts`
Expected: the new test FAILS (command events don't match skills yet).

- [ ] **Step 3: Update `matches()` in `src/coverage/engine.ts`**

Replace:
```ts
function matches(item: InvRow, agg: Agg): boolean {
  if (item.kind === 'skill') return agg.kind === 'skill' && agg.name === item.name;
  if (item.kind === 'agent') return agg.kind === 'subagent' && agg.name === item.name;
  if (item.kind === 'mcp') return agg.kind === 'tool' && agg.name.startsWith('mcp__' + normalizeMcp(item.name) + '__');
  return false;
}
```
with:
```ts
function matches(item: InvRow, agg: Agg): boolean {
  if (item.kind === 'skill') {
    if (agg.kind === 'skill' && agg.name === item.name) return true;
    // slash-command bridge: exact, or bare command name matching a plugin-qualified skill
    if (agg.kind === 'command' && (agg.name === item.name || item.name.endsWith(':' + agg.name))) return true;
    return false;
  }
  if (item.kind === 'agent') return agg.kind === 'subagent' && agg.name === item.name;
  if (item.kind === 'mcp') return agg.kind === 'tool' && agg.name.startsWith('mcp__' + normalizeMcp(item.name) + '__');
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/coverage/engine.test.ts`
Expected: PASS (all engine tests, including the new bridge test).

- [ ] **Step 5: Commit**

```bash
git add src/coverage/engine.ts test/coverage/engine.test.ts
git commit -m "feat(coverage): count slash-command invocations toward skill usage"
```

---

## Task 3: Add the `prompts` table

**Files:**
- Modify: `src/db/schema.ts`
- Test: `test/db/index.test.ts` (add a case)

- [ ] **Step 1: Write the failing test**

Add to `test/db/index.test.ts`:
```ts
  test('prompts table exists with a uuid primary key', () => {
    const db = openDb(':memory:');
    db.prepare(`INSERT INTO prompts (uuid, session_id, project, ts, text) VALUES (?,?,?,?,?)`)
      .run('u1', 's1', '/p', '2026-06-23T00:00:00.000Z', 'hello');
    db.prepare(`INSERT OR IGNORE INTO prompts (uuid, session_id, project, ts, text) VALUES (?,?,?,?,?)`)
      .run('u1', 's1', '/p', '2026-06-23T00:00:00.000Z', 'hello'); // dup ignored
    const c = db.prepare(`SELECT COUNT(*) AS c FROM prompts`).get() as { c: number };
    expect(c.c).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/db/index.test.ts`
Expected: the new test FAILS (no `prompts` table).

- [ ] **Step 3: Add the table to `src/db/schema.ts`**

Append inside the `SCHEMA` template string (after the `ingest_cursors` table):
```sql

CREATE TABLE IF NOT EXISTS prompts (
  uuid TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  project TEXT NOT NULL,
  ts TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prompts_session ON prompts(session_id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/db/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts test/db/index.test.ts
git commit -m "feat(db): add prompts table for missed-invocation corpus"
```

---

## Task 4: Extract + store the prompt corpus during ingest

**Files:**
- Modify: `src/types.ts` (add `PromptRow`)
- Create: `src/ingest/prompts.ts`
- Modify: `src/ingest/adapter.ts`
- Test: `test/ingest/prompts.test.ts`, `test/ingest/adapter.test.ts` (add a case)

- [ ] **Step 1: Add `PromptRow` to `src/types.ts`**

```ts
export interface PromptRow {
  uuid: string;
  sessionId: string;
  project: string;
  ts: string;
  text: string;
}
```

- [ ] **Step 2: Write the failing test for `extractPrompts`**

`test/ingest/prompts.test.ts`:
```ts
import { describe, test, expect } from 'vitest';
import { extractPrompts } from '../../src/ingest/prompts';

const FIXTURE = [
  JSON.stringify({ type: 'user', sessionId: 's', timestamp: '2026-06-23T10:00:00.000Z', cwd: '/p', uuid: 'u1',
    message: { content: 'please verify the fix works' } }),
  JSON.stringify({ type: 'user', sessionId: 's', timestamp: '2026-06-23T10:01:00.000Z', cwd: '/p', uuid: 'u2',
    message: { content: [{ type: 'text', text: 'now run the tests' }] } }),
  JSON.stringify({ type: 'user', sessionId: 's', timestamp: '2026-06-23T10:02:00.000Z', cwd: '/p', uuid: 'u3',
    message: { content: '<command-name>/model</command-name>\n<command-message>model</command-message>' } }),
  JSON.stringify({ type: 'assistant', sessionId: 's', timestamp: '2026-06-23T10:03:00.000Z', cwd: '/p',
    message: { content: [{ type: 'text', text: 'ok' }] } }),
  'garbage',
].join('\n');

describe('extractPrompts', () => {
  test('captures natural-language user prompts (string and array forms), with uuid/session/ts', () => {
    const prompts = extractPrompts(FIXTURE);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toMatchObject({ uuid: 'u1', sessionId: 's', project: '/p', text: 'please verify the fix works' });
    expect(prompts[1]).toMatchObject({ uuid: 'u2', text: 'now run the tests' });
  });

  test('skips command records, assistant records, malformed lines, and records without a uuid', () => {
    const prompts = extractPrompts(FIXTURE);
    expect(prompts.some((p) => p.text.includes('command-name'))).toBe(false);
    expect(prompts.some((p) => p.text === 'ok')).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/ingest/prompts.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Write `src/ingest/prompts.ts`**

```ts
import type { PromptRow } from '../types';

const PROMPT_MAX = 2000;

function textOf(content: unknown): string | null {
  if (typeof content === 'string') {
    if (content.includes('<command-name>')) return null; // command, not a prompt
    const t = content.trim();
    return t ? t.slice(0, PROMPT_MAX) : null;
  }
  if (Array.isArray(content)) {
    const t = content
      .filter((b): b is { type: string; text: string } =>
        !!b && typeof b === 'object' && (b as any).type === 'text' && typeof (b as any).text === 'string')
      .map((b) => b.text)
      .join(' ')
      .trim();
    return t ? t.slice(0, PROMPT_MAX) : null;
  }
  return null;
}

export function extractPrompts(content: string): PromptRow[] {
  const prompts: PromptRow[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: any;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!rec || rec.type !== 'user') continue;
    const uuid = typeof rec.uuid === 'string' ? rec.uuid : null;
    if (!uuid) continue;
    const msg = rec.message;
    const text = textOf(msg && typeof msg === 'object' ? (msg as any).content : undefined);
    if (!text) continue;
    prompts.push({
      uuid,
      sessionId: typeof rec.sessionId === 'string' ? rec.sessionId : '',
      project: typeof rec.cwd === 'string' ? rec.cwd : '',
      ts: typeof rec.timestamp === 'string' ? rec.timestamp : '',
      text,
    });
  }
  return prompts;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/ingest/prompts.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Wire prompts into the ingester**

In `src/ingest/adapter.ts`, add the import:
```ts
import { extractPrompts } from './prompts';
```
Add a prompt-insert helper (near `insertEvents`):
```ts
function insertPrompts(db: Db, content: string): void {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO prompts (uuid, session_id, project, ts, text)
     VALUES (@uuid, @sessionId, @project, @ts, @text)`,
  );
  const rows = extractPrompts(content);
  const tx = db.transaction((rs: ReturnType<typeof extractPrompts>) => {
    for (const r of rs) stmt.run(r);
  });
  tx(rows);
}
```
Then, in `ingestClaudeCode`, after the `inserted += insertEvents(...)` line and before `upsertCursor.run(...)`, add:
```ts
    insertPrompts(db, content);
```

- [ ] **Step 7: Write the failing test for ingest-stores-prompts**

Add to `test/ingest/adapter.test.ts` (the `transcript()` helper already includes a user message `{ content: 'hi' }`):
```ts
  test('stores the prompt corpus during ingest', () => {
    const projDir = join(root, 'p');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, 'a.jsonl'), transcript('sess-a'));
    ingestClaudeCode(db, { root });
    const c = db.prepare(`SELECT COUNT(*) AS c FROM prompts`).get() as { c: number };
    expect(c.c).toBe(1);
    const p = db.prepare(`SELECT text FROM prompts LIMIT 1`).get() as { text: string };
    expect(p.text).toBe('hi');
  });
```
Note: the existing `transcript()` helper's user record needs a `uuid` for the prompt to be captured. Update the helper's first line to include a uuid:
```ts
    JSON.stringify({ type: 'user', sessionId, timestamp: '2026-06-23T10:00:00.000Z', cwd: '/proj', uuid: `${sessionId}-u`, message: { content: 'hi' } }),
```

- [ ] **Step 8: Run the ingest tests**

Run: `npx vitest run test/ingest/adapter.test.ts`
Expected: PASS (existing 2 + new prompts test). The event-count assertions are unaffected (prompts are a separate table).

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/ingest/prompts.ts src/ingest/adapter.ts test/ingest/prompts.test.ts test/ingest/adapter.test.ts
git commit -m "feat(ingest): build prompt corpus during ingest"
```

---

## Task 5: Missed-invocation scoring helpers (pure)

**Files:**
- Create: `src/missed/keywords.ts`
- Test: `test/missed/keywords.test.ts`

- [ ] **Step 1: Write the failing test**

`test/missed/keywords.test.ts`:
```ts
import { describe, test, expect } from 'vitest';
import { keywordsFor, scorePrompt } from '../../src/missed/keywords';

describe('keywordsFor', () => {
  test('extracts distinctive lowercase tokens from name + description, dropping stopwords and short tokens', () => {
    const kw = keywordsFor('verify', 'Use when asked to verify a fix works by running the app');
    expect(kw).toContain('verify');
    expect(kw).toContain('running');
    expect(kw).toContain('works'); // 'fix' is 3 chars and dropped by the >=4 filter; 'works' is the kept distinctive token
    expect(kw).not.toContain('the'); // stopword
    expect(kw).not.toContain('to'); // too short / stopword
    expect(kw.every((k) => k === k.toLowerCase())).toBe(true);
  });

  test('splits a plugin-qualified name into useful tokens', () => {
    const kw = keywordsFor('superpowers:systematic-debugging', null);
    expect(kw).toContain('systematic');
    expect(kw).toContain('debugging');
  });
});

describe('scorePrompt', () => {
  test('counts distinct matched keywords (case-insensitive, word-ish)', () => {
    const kw = ['verify', 'running', 'fix'];
    const r = scorePrompt('Can you VERIFY the fix by running it?', kw);
    expect(r.score).toBe(3);
    expect(r.matched.sort()).toEqual(['fix', 'running', 'verify']);
  });

  test('no overlap → score 0', () => {
    expect(scorePrompt('rename this css class', ['verify', 'running']).score).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/missed/keywords.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/missed/keywords.ts`**

```ts
const STOPWORDS = new Set([
  'the', 'and', 'for', 'use', 'when', 'with', 'this', 'that', 'your', 'you', 'are', 'was',
  'will', 'from', 'into', 'not', 'but', 'all', 'any', 'can', 'has', 'have', 'had', 'its',
  'a', 'an', 'to', 'of', 'in', 'on', 'or', 'is', 'it', 'as', 'by', 'be', 'do', 'if', 'so',
  'asked', 'using', 'used', 'via', 'per', 'etc', 'eg', 'ie',
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

export function keywordsFor(name: string, description: string | null): string[] {
  const tokens = [...tokenize(name), ...(description ? tokenize(description) : [])];
  return Array.from(new Set(tokens));
}

export interface PromptScore {
  score: number;
  matched: string[];
}

export function scorePrompt(promptText: string, keywords: string[]): PromptScore {
  const hay = promptText.toLowerCase();
  const matched = keywords.filter((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(hay));
  return { score: matched.length, matched };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/missed/keywords.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/missed/keywords.ts test/missed/keywords.test.ts
git commit -m "feat(missed): keyword extraction + prompt scoring helpers"
```

---

## Task 6: Missed-invocation detector + `candidates` CLI

**Files:**
- Create: `src/missed/candidates.ts`, `src/missed/report.ts`
- Modify: `src/cli.ts`
- Modify: `src/types.ts` (add `MissedCandidate`)
- Test: `test/missed/candidates.test.ts`

- [ ] **Step 1: Add `MissedCandidate` to `src/types.ts`**

```ts
export interface MissedCandidate {
  skill: string;
  scope: string;
  promptText: string;
  sessionId: string;
  ts: string;
  score: number;
  matched: string[];
}
```

- [ ] **Step 2: Write the failing test**

`test/missed/candidates.test.ts`:
```ts
import { describe, test, expect } from 'vitest';
import { openDb } from '../../src/db/index';
import { findMissedInvocations } from '../../src/missed/candidates';

const OPTS = { windowDays: 30, underusedStaleDays: 14, now: new Date('2026-06-23T00:00:00.000Z') };

function seed() {
  const db = openDb(':memory:');
  // ignored skill 'verify' with a useful description; never invoked
  db.prepare(`INSERT INTO inventory (scanned_at, kind, name, scope, description, triggers, path) VALUES ('t','skill','verify','user',?,null,'/v')`)
    .run('Use when asked to verify a fix works by running the app');
  // a healthy skill that IS used (should not appear as a candidate)
  db.prepare(`INSERT INTO inventory (scanned_at, kind, name, scope, description, triggers, path) VALUES ('t','skill','graphify','user','build a knowledge graph',null,'/g')`).run();
  const ev = db.prepare(`INSERT INTO events (ts, session_id, project, agent, kind, name, tool_use_id) VALUES (?,?,?,?,?,?,?)`);
  for (let i = 0; i < 5; i++) ev.run('2026-06-22T00:00:00.000Z', 'sess-x', '/p', 'claude-code', 'skill', 'graphify', `g${i}`);
  const pr = db.prepare(`INSERT INTO prompts (uuid, session_id, project, ts, text) VALUES (?,?,?,?,?)`);
  // a prompt in a session where 'verify' never fired, matching its keywords → candidate
  pr.run('p1', 'sess-1', '/p', '2026-06-22T09:00:00.000Z', 'can you verify the fix works by running the app');
  // an unrelated prompt → not a candidate
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
    expect(rows.some((r) => r.skill === 'graphify')).toBe(false); // healthy, excluded
    expect(rows.some((r) => r.promptText.includes('css class'))).toBe(false); // no keyword overlap
  });

  test('excludes prompts from sessions where the skill DID fire', () => {
    const db = seed();
    // verify fired in sess-1 → that prompt is no longer "missed"
    db.prepare(`INSERT INTO events (ts, session_id, project, agent, kind, name, tool_use_id) VALUES ('2026-06-22T09:30:00.000Z','sess-1','/p','claude-code','skill','verify','v1')`).run();
    const rows = findMissedInvocations(db, { ...OPTS, minScore: 2, perSkill: 10, limit: 50 });
    expect(rows.some((r) => r.skill === 'verify')).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/missed/candidates.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Write `src/missed/candidates.ts`**

```ts
import type { Db } from '../db/index';
import type { CoverageOptions, MissedCandidate } from '../types';
import { computeCoverage } from '../coverage/engine';
import { keywordsFor, scorePrompt } from './keywords';

export interface MissedOptions extends CoverageOptions {
  minScore: number; // minimum keyword overlap to count (default 2)
  perSkill: number; // max candidates per skill (default 5)
  limit: number; // max total candidates (default 50)
}

interface InvSkill { name: string; scope: string; description: string | null; }
interface PromptRowDb { session_id: string; ts: string; text: string; }

export function findMissedInvocations(db: Db, opts: MissedOptions): MissedCandidate[] {
  // 1. ignored/underused skills (the targets) from deterministic coverage
  const coverage = computeCoverage(db, opts);
  const targetNames = new Set(
    coverage.filter((r) => r.kind === 'skill' && r.status !== 'healthy').map((r) => r.name),
  );
  if (targetNames.size === 0) return [];

  const skills = (db.prepare(`SELECT name, scope, description FROM inventory WHERE kind = 'skill'`).all() as InvSkill[])
    .filter((s) => targetNames.has(s.name));

  // 2. per-skill set of sessions where the skill fired (skill or slash-command event)
  const usageRows = db
    .prepare(`SELECT name, session_id FROM events WHERE kind IN ('skill','command')`)
    .all() as { name: string; session_id: string }[];
  const firedSessions = new Map<string, Set<string>>(); // event-name -> sessions
  for (const u of usageRows) {
    if (!firedSessions.has(u.name)) firedSessions.set(u.name, new Set());
    firedSessions.get(u.name)!.add(u.session_id);
  }
  const sessionsWhereFired = (skillName: string): Set<string> => {
    const out = new Set<string>();
    for (const [evName, sessions] of firedSessions) {
      if (evName === skillName || skillName.endsWith(':' + evName)) for (const s of sessions) out.add(s);
    }
    return out;
  };

  // 3. all prompts (corpus)
  const prompts = db.prepare(`SELECT session_id, ts, text FROM prompts`).all() as PromptRowDb[];

  // 4. score
  const out: MissedCandidate[] = [];
  for (const skill of skills) {
    const kw = keywordsFor(skill.name, skill.description);
    if (kw.length === 0) continue;
    const fired = sessionsWhereFired(skill.name);
    const hits: MissedCandidate[] = [];
    for (const p of prompts) {
      if (fired.has(p.session_id)) continue; // skill was used in this session → not missed
      const { score, matched } = scorePrompt(p.text, kw);
      if (score < opts.minScore) continue;
      hits.push({ skill: skill.name, scope: skill.scope, promptText: p.text, sessionId: p.session_id, ts: p.ts, score, matched });
    }
    hits.sort((a, b) => b.score - a.score || b.ts.localeCompare(a.ts));
    out.push(...hits.slice(0, opts.perSkill));
  }

  out.sort((a, b) => b.score - a.score || a.skill.localeCompare(b.skill));
  return out.slice(0, opts.limit);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/missed/candidates.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Write `src/missed/report.ts`**

```ts
import type { MissedCandidate } from '../types';

function truncate(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > n ? oneLine.slice(0, n - 1) + '…' : oneLine;
}

export function formatCandidates(rows: MissedCandidate[]): string {
  if (rows.length === 0) {
    return 'No missed-invocation candidates found (ignored skills had no matching prompts).';
  }
  const lines: string[] = [];
  lines.push(`Missed-invocation candidates: ${rows.length} (ignored/underused skills that a prompt seemingly called for)`);
  lines.push('');
  const bySkill = new Map<string, MissedCandidate[]>();
  for (const r of rows) {
    if (!bySkill.has(r.skill)) bySkill.set(r.skill, []);
    bySkill.get(r.skill)!.push(r);
  }
  for (const [skill, hits] of bySkill) {
    lines.push(`▸ ${skill} (${hits[0].scope}) — ${hits.length} candidate prompt(s)`);
    for (const h of hits) {
      lines.push(`    [score ${h.score}: ${h.matched.join(', ')}]`);
      lines.push(`    "${truncate(h.promptText, 100)}"`);
    }
    lines.push('');
  }
  lines.push('Note: heuristic, high-recall — Plan 2b will have Claude Code adjudicate each and propose fixes.');
  return lines.join('\n');
}
```

- [ ] **Step 7: Add the `candidates` command to `src/cli.ts`**

Add the imports:
```ts
import { findMissedInvocations } from './missed/candidates';
import { formatCandidates } from './missed/report';
```
Add the command (after the `report` command, before `program.parse()`):
```ts
program
  .command('candidates')
  .description('show prompts where an ignored/underused skill seemingly should have fired')
  .option('--db <path>', 'database file path')
  .option('--window <days>', 'window in days', '30')
  .option('--stale <days>', 'underused staleness threshold in days', '14')
  .option('--min-score <n>', 'minimum keyword overlap', '2')
  .option('--per-skill <n>', 'max candidates per skill', '5')
  .option('--limit <n>', 'max total candidates', '50')
  .action((opts) => {
    const out = withDb(opts.db, (db) =>
      formatCandidates(
        findMissedInvocations(db, {
          windowDays: Number(opts.window),
          underusedStaleDays: Number(opts.stale),
          now: new Date(),
          minScore: Number(opts.minScore),
          perSkill: Number(opts.perSkill),
          limit: Number(opts.limit),
        }),
      ),
    );
    console.log(out);
  });
```

- [ ] **Step 8: Manual smoke test on real data**

Run:
```bash
npm run radar -- ingest
npm run radar -- scan
npm run radar -- candidates --limit 15
```
Expected: prints skills that look ignored but whose keywords matched real prompts — the evidence Plan 2b will adjudicate. Also re-run `npm run radar -- report` and confirm slash-invoked skills no longer appear as "ignored" (coverage should be more accurate than the pre-Plan-2a 25%). Report the new coverage line and a couple of candidate examples.

- [ ] **Step 9: Typecheck + full suite**

Run: `npm run typecheck` (expect 0) and `npm test` (expect all pass — Plan 1 tests + all Plan 2a additions).

- [ ] **Step 10: Commit**

```bash
git add src/types.ts src/missed/candidates.ts src/missed/report.ts src/cli.ts test/missed/candidates.test.ts
git commit -m "feat(missed): missed-invocation detector + candidates CLI command"
```

---

## Self-Review

**Spec coverage (Plan 2a portion):**
- Accuracy fix (decision: "fix accuracy first") — slash-command tracking (Task 1) + coverage bridge (Task 2) ✓
- Prompt corpus for evidence — `prompts` table (Task 3) + ingest (Task 4) ✓
- Missed-invocation evidence (decision: "prioritize by missed-invocation evidence") — scoring helpers (Task 5) + detector + CLI (Task 6) ✓
- Deterministic only; no AI/headless-CC (that is Plan 2b) ✓

**Placeholder scan:** every step has complete code. No TODO/TBD.

**Type consistency:** `EventKind` gains `'command'` (Task 1) and every producer/consumer (`parse`, `matches`) handles it. New types `PromptRow`, `MissedCandidate`, `MissedOptions` defined before use. `findMissedInvocations`, `keywordsFor`, `scorePrompt`, `formatCandidates`, `extractPrompts` names are consistent across tasks. `computeCoverage` reused unchanged (Task 6 depends on Tasks 2's matching).

**Cross-task ordering:** Task 1 (command events) must land before Task 2 (bridge) and Task 6 (uses `kind IN ('skill','command')`). Task 3 (table) before Task 4 (insert) before Task 6 (reads prompts). Plan is ordered correctly.

---

## Execution Handoff

After Plan 2a lands (trustworthy coverage + a `candidates` command backed by real prompts), Plan 2b adds the headless-Claude-Code loop that reads each candidate + the skill's SKILL.md and emits the full optimization package (summary / description / triggers / non-goals / disambiguation / name) into an `optimizations` table.
