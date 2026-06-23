# skill-radar Plan 7 — Real-time PostToolUse Capture

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture skill/subagent invocations the moment they happen via a Claude Code PostToolUse hook, instead of waiting for the SessionStart batch. A `skill-radar ingest --hook` mode reads one PostToolUse payload from stdin and inserts a single event; the plugin's PostToolUse hook fires only for `Skill|Agent|Task` so it stays cheap.

**Architecture:** `parseHookEvent(payloadJson, {now})` reuses the existing `classifyToolUse` to turn a PostToolUse payload into one `UsageEvent`, keyed by the payload's **`tool_use_id`** — the same id the JSONL batch uses — so `INSERT OR IGNORE` on `UNIQUE(session_id, tool_use_id)` **dedups across the real-time and batch paths automatically** (no double-counting). `ingestHookEvent` inserts it. The CLI `ingest --hook` reads stdin and calls it. A PostToolUse hook (matcher `Skill|Agent|Task`, async, guarded) pipes the payload to `skill-radar ingest --hook`.

**Tech Stack:** unchanged. No new deps.

**Grounded facts (verified from installed plugin hook scripts):** the PostToolUse stdin payload carries `session_id`, `cwd`, `tool_name`, `tool_input`, `tool_response`, `hook_event_name`, and **`tool_use_id`** (snake_case; some code also uses `toolUseId`). For the `Skill` tool, `tool_input.skill` holds the skill name; for `Agent`/`Task`, `tool_input.subagent_type`. PostToolUse matchers filter on the tool name.

**Prerequisite:** Plan 6 merged into `main` (full pipeline; `classifyToolUse` in `src/ingest/parse.ts`; plugin `hooks.json` with the SessionStart hook).

**Scope / design notes:**
- **Dedup is the whole point:** the hook event uses the payload's `tool_use_id`, so when the SessionStart batch later parses the same call from JSONL (same `session_id` + `tool_use_id`), `INSERT OR IGNORE` skips it. Verified the payload provides this key.
- **Only `Skill|Agent|Task`** are hooked (matcher) — these are the high-value, low-frequency calls. Tools (Bash/Read/…) remain captured by the batch; we don't spawn a process on every tool call.
- The hook is **guarded** (`command -v skill-radar` → no-op if absent) and **async** (never blocks the agent). `ts` is the hook time (real-time); `source='hook'`, `trigger='hook'`; no prompt excerpt (the batch path supplies prompts/scenarios).
- A payload without a `tool_use_id` is skipped (no safe dedup key).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/ingest/parse.ts` | modify | `export` `classifyToolUse` |
| `src/ingest/hook.ts` | create | `parseHookEvent` + `ingestHookEvent` |
| `src/cli.ts` | modify | `ingest --hook` (read stdin → one event) |
| `plugin/hooks/hooks.json` | modify | add PostToolUse hook (matcher `Skill|Agent|Task`) |
| `README.md` | modify | note real-time capture |
| `test/ingest/hook.test.ts` | create | parse + ingest + dedup tests |
| `test/plugin/plugin.test.ts` | modify | assert the PostToolUse hook |

---

## Task 1: `parseHookEvent` (reuse `classifyToolUse`)

**Files:**
- Modify: `src/ingest/parse.ts` (export `classifyToolUse`)
- Create: `src/ingest/hook.ts`
- Test: `test/ingest/hook.test.ts`

- [ ] **Step 1: Export `classifyToolUse`** in `src/ingest/parse.ts` — change `function classifyToolUse(` to `export function classifyToolUse(`. (No other change; `parseTranscript` keeps using it.)

- [ ] **Step 2: Write the failing test**

`test/ingest/hook.test.ts`:
```ts
import { describe, test, expect } from 'vitest';
import { parseHookEvent } from '../../src/ingest/hook';

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
    expect(parseHookEvent(JSON.stringify({ tool_use_id: 't', tool_name: 'Skill', tool_input: {} }), { now: NOW })).toBeNull(); // Skill with no skill name
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/ingest/hook.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Write `src/ingest/hook.ts`** (parse only for this task; `ingestHookEvent` is added in Task 2)

```ts
import type { Agent, UsageEvent } from '../types';
import { classifyToolUse } from './parse';

export function parseHookEvent(payloadJson: string, opts: { now: Date; agent?: Agent }): UsageEvent | null {
  let p: any;
  try {
    p = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (!p || typeof p !== 'object') return null;

  // PostToolUse's tool_use_id is the SAME id Claude Code writes to the JSONL tool_use block
  // (the unique id of the tool call). Keying on it lets INSERT OR IGNORE on
  // UNIQUE(session_id, tool_use_id) dedup this real-time event against the later batch ingest.
  const toolUseId =
    typeof p.tool_use_id === 'string' ? p.tool_use_id : typeof p.toolUseId === 'string' ? p.toolUseId : null;
  if (!toolUseId) return null; // no shared dedup key → skip rather than risk a double-count

  const cls = classifyToolUse({ name: p.tool_name, input: p.tool_input ?? {} });
  if (!cls) return null;

  return {
    ts: opts.now.toISOString(),
    sessionId: typeof p.session_id === 'string' ? p.session_id : '',
    project: typeof p.cwd === 'string' ? p.cwd : '',
    agent: opts.agent ?? 'claude-code',
    kind: cls.kind,
    name: cls.name,
    trigger: 'hook',
    source: 'hook',
    toolUseId,
    promptExcerpt: null,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/ingest/hook.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/ingest/parse.ts src/ingest/hook.ts test/ingest/hook.test.ts
git commit -m "feat(ingest): parse a PostToolUse hook payload into one event"
```

---

## Task 2: `ingestHookEvent` + `ingest --hook` CLI

**Files:**
- Modify: `src/ingest/hook.ts` (add `ingestHookEvent`), `src/cli.ts`
- Test: `test/ingest/hook.test.ts` (add cases)

- [ ] **Step 1: Add the failing tests** (append to `test/ingest/hook.test.ts`)

```ts
import { openDb } from '../../src/db/index';
import { ingestHookEvent } from '../../src/ingest/hook';

const skillPayload = (id: string) => JSON.stringify({ session_id: 's', cwd: '/p', tool_name: 'Skill', tool_input: { skill: 'graphify' }, tool_use_id: id });

describe('ingestHookEvent', () => {
  test('inserts one event and is idempotent on (session, tool_use_id)', () => {
    const db = openDb(':memory:');
    expect(ingestHookEvent(db, skillPayload('t1'), NOW)).toBe(true);
    expect(ingestHookEvent(db, skillPayload('t1'), NOW)).toBe(false); // duplicate ignored
    expect((db.prepare(`SELECT COUNT(*) AS c FROM events`).get() as any).c).toBe(1);
  });

  test('dedups against a JSONL-ingested event with the same session + tool_use_id', () => {
    const db = openDb(':memory:');
    db.prepare(`INSERT INTO events (ts, session_id, project, agent, kind, name, tool_use_id) VALUES ('2026-06-22T00:00:00.000Z','s','/p','claude-code','skill','graphify','t1')`).run();
    expect(ingestHookEvent(db, skillPayload('t1'), NOW)).toBe(false); // same (s, t1) → ignored
    expect((db.prepare(`SELECT COUNT(*) AS c FROM events`).get() as any).c).toBe(1);
  });

  test('returns false for an untrackable payload', () => {
    expect(ingestHookEvent(openDb(':memory:'), 'garbage', NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ingest/hook.test.ts`
Expected: the new `ingestHookEvent` tests FAIL (export missing).

- [ ] **Step 3: Add `ingestHookEvent` to `src/ingest/hook.ts`** (append; add the `Db` import)

At the top, add:
```ts
import type { Db } from '../db/index';
```
At the end, add:
```ts
export function ingestHookEvent(db: Db, payloadJson: string, now: Date): boolean {
  const ev = parseHookEvent(payloadJson, { now });
  if (!ev) return false;
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO events (ts, session_id, project, agent, kind, name, trigger, source, tool_use_id, prompt_excerpt)
     VALUES (@ts, @sessionId, @project, @agent, @kind, @name, @trigger, @source, @toolUseId, @promptExcerpt)`,
  );
  return stmt.run(ev).changes > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ingest/hook.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Wire `--hook` into the `ingest` CLI command** in `src/cli.ts`

Add the imports (with the others):
```ts
import { readFileSync } from 'node:fs';
import { ingestHookEvent } from './ingest/hook';
```
(If `node:fs` is already imported for `mkdirSync`, add `readFileSync` to that import instead of duplicating.)

In the `ingest` command, add the option and a `--hook` branch at the top of the action:
```ts
  .option('--hook', 'ingest a single PostToolUse payload from stdin (real-time)', false)
```
```ts
  .action((opts) => {
    if (opts.hook) {
      // read the piped payload from fd 0; guard against a TTY (readFileSync(0) blocks forever
      // with no EOF on an interactive terminal — a manual `ingest --hook` with no pipe no-ops).
      let payload = '';
      if (!process.stdin.isTTY) {
        try { payload = readFileSync(0, 'utf8'); } catch { payload = ''; }
      }
      const inserted = withDb(opts.db, (db) => ingestHookEvent(db, payload, new Date()));
      console.log(inserted ? 'Ingested 1 event from hook.' : 'No event ingested (duplicate or untracked).');
      return;
    }
    const root = opts.projectsDir ?? join(homedir(), '.claude', 'projects');
    const res = withDb(opts.db, (db) => ingestClaudeCode(db, { root }));
    console.log(`Ingested: ${res.inserted} new event(s) from ${res.filesScanned} changed file(s).`);
  });
```
(Keep the existing `--db` / `--projects-dir` options.)

- [ ] **Step 6: Manual smoke (CLI `--hook`)**

Run:
```bash
printf '%s' '{"session_id":"s","cwd":"/p","tool_name":"Skill","tool_input":{"skill":"graphify"},"tool_use_id":"smoke-1"}' | npm run radar -- ingest --hook --db /tmp/sr-hook.sqlite
printf '%s' '{"session_id":"s","cwd":"/p","tool_name":"Skill","tool_input":{"skill":"graphify"},"tool_use_id":"smoke-1"}' | npm run radar -- ingest --hook --db /tmp/sr-hook.sqlite
rm -f /tmp/sr-hook.sqlite*
```
Expected: first prints `Ingested 1 event from hook.`, second prints `No event ingested (duplicate or untracked).` (dedup works). Report the output.

- [ ] **Step 7: Commit**

```bash
git add src/ingest/hook.ts src/cli.ts test/ingest/hook.test.ts
git commit -m "feat(cli): ingest --hook for real-time PostToolUse capture"
```

---

## Task 3: Plugin PostToolUse hook + README + smoke

**Files:**
- Modify: `plugin/hooks/hooks.json`, `README.md`
- Test: `test/plugin/plugin.test.ts` (add a case)

- [ ] **Step 1: Add the failing test** (append to `test/plugin/plugin.test.ts`)

```ts
describe('PostToolUse hook', () => {
  test('hooks.json defines a guarded PostToolUse hook scoped to Skill/Agent/Task', () => {
    const h = JSON.parse(read('hooks/hooks.json'));
    const post = h.hooks?.PostToolUse;
    expect(Array.isArray(post)).toBe(true);
    const entry = post[0];
    expect(entry.matcher).toMatch(/Skill/);
    expect(entry.matcher).toMatch(/Agent/);
    const cmd = entry.hooks[0];
    expect(cmd.command).toContain('command -v skill-radar');
    expect(cmd.command).toContain('ingest --hook');
    expect(cmd.async).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/plugin/plugin.test.ts`
Expected: the new test FAILS (no PostToolUse hook yet).

- [ ] **Step 3: Add the PostToolUse hook to `plugin/hooks/hooks.json`** — add a `PostToolUse` key alongside `SessionStart` (keep SessionStart unchanged):

```json
    "PostToolUse": [
      {
        "matcher": "Skill|Agent|Task",
        "hooks": [
          {
            "type": "command",
            "shell": "bash",
            "command": "export PATH=\"$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH\"; if command -v skill-radar >/dev/null 2>&1; then skill-radar ingest --hook >/dev/null 2>&1; fi; echo '{\"continue\":true,\"suppressOutput\":true}'",
            "async": true,
            "timeout": 30
          }
        ]
      }
    ]
```
(The resulting file has both `SessionStart` and `PostToolUse` under `hooks`. Ensure valid JSON — a comma between the two arrays.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/plugin/plugin.test.ts`
Expected: PASS (all plugin tests incl. the new PostToolUse case).

- [ ] **Step 5: Update `README.md`** — in the Claude Code plugin section's hook description, note the PostToolUse real-time capture. Add one bullet under "What you get" (or amend the SessionStart line):

``- **PostToolUse hook** — captures `Skill`/`Agent`/`Task` invocations in real time via `skill-radar ingest --hook` (deduped against the batch by `tool_use_id`; guarded + async; no-op without the CLI).``

- [ ] **Step 6: Real smoke test**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('plugin/hooks/hooks.json','utf8')); console.log('hooks.json OK')"
printf '%s' '{"session_id":"s","cwd":"/p","tool_name":"Agent","tool_input":{"subagent_type":"Explore"},"tool_use_id":"sm-2"}' | node bin/skill-radar.mjs ingest --hook --db /tmp/sr-hook2.sqlite
rm -f /tmp/sr-hook2.sqlite*
```
Expected: `hooks.json OK`, then `Ingested 1 event from hook.`. Report output.

- [ ] **Step 7: Typecheck + full suite**

Run: `npm run typecheck` (0) and `npm test` (ALL pass).

- [ ] **Step 8: Commit**

```bash
git add plugin/hooks/hooks.json test/plugin/plugin.test.ts README.md
git commit -m "feat(plugin): PostToolUse real-time capture hook (Skill/Agent/Task)"
```

---

## Self-Review

**Spec coverage (Plan 7):**
- Real-time PostToolUse capture → `ingest --hook` + plugin PostToolUse hook (Tasks 1–3) ✓
- Dedup across real-time + batch → shared `tool_use_id` key + `INSERT OR IGNORE` (verified by the cross-path dedup test) ✓
- Efficient → matcher limited to `Skill|Agent|Task`; async; guarded ✓
- Reuses `classifyToolUse` (no parsing duplication) ✓

**Placeholder scan:** complete code throughout. No TODO/TBD.

**Type consistency:** `parseHookEvent`/`ingestHookEvent` in `hook.ts` reuse `classifyToolUse` (now exported) and produce a `UsageEvent` matching the `events` columns. `--hook` reads fd 0 only when stdin is piped (guarded by `!process.stdin.isTTY`), so a manual invocation with no pipe no-ops instead of hanging; the real hook path always pipes a closed-stdin payload.

**Dedup assumption (documented):** the design keys on the PostToolUse `tool_use_id` being identical to the JSONL tool_use block `id` (the CC tool-call id) — a Claude Code contract. If that ever broke, the impact is a *bounded* double-count of `Skill|Agent|Task` calls (INSERT OR IGNORE never corrupts), not data loss. Worth a one-time live-payload capture to confirm if ever in doubt.

**Safety:** the hook is guarded (no-op without the CLI), async (never blocks), and only fires for `Skill|Agent|Task`. A payload without `tool_use_id` is skipped (no unsafe insert). No double-counting — the batch path's identical event is ignored by the UNIQUE constraint.

**Cross-task ordering:** Task 1 (parse + export) → 2 (ingest + CLI) → 3 (plugin hook + docs). Correct.

---

## Execution Handoff

After Plan 7, skill/subagent usage lands in the DB the instant it happens (deduped against the batch). Remaining future work: npm publish, active-eval benchmark, Codex adapter.
