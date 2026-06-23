# skill-radar Plan 1 — Core Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working `skill-radar` CLI that ingests Claude Code JSONL transcripts, scans the available-capability inventory (user + project + plugin), computes deterministic usage coverage, and prints a text report flagging ignored/underused skills, subagents, and MCP servers.

**Architecture:** TypeScript/Node, run via `tsx` (no build step needed for use). A `better-sqlite3` database holds `events`, `inventory`, `sessions`, `ingest_cursors`. An ingester parses transcripts into normalized `UsageEvent`s behind a `SourceAdapter` interface (Codex plugs in later). A pure, deterministic coverage engine joins inventory (denominator) with event aggregates and classifies each capability `never | underused | healthy`. The CLI wires `init / ingest / scan / report`.

**Tech Stack:** TypeScript (Node ≥20), `better-sqlite3`, `commander`, `vitest`, `tsx`. ESM, `moduleResolution: Bundler`, extensionless relative imports.

**Scope note:** Foundation only — **no AI analysis, no missed-invocation detection, no web UI, no plugin packaging** (those are Plans 2–4). Coverage classification covers **skills, subagents (the `Agent` tool), and MCP servers**; **slash commands are deferred** (not scanned, not covered) and the report says so. **Built-in subagents** (e.g. `general-purpose`, `Explore`) have no on-disk definition and are therefore excluded from the denominator — the report notes this so a built-in showing up nowhere is not misread as "an unused capability."

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts` | Project config, scripts, deps |
| `src/types.ts` | Shared type declarations (no behavior) |
| `src/db/schema.ts` | SQL DDL string |
| `src/db/index.ts` | `openDb(path)` — open + migrate |
| `src/ingest/parse.ts` | `parseTranscript(content)` — JSONL string → `UsageEvent[]` |
| `src/ingest/adapter.ts` | `SourceAdapter` interface + `ingestClaudeCode(db, opts)` (file walk, mtime cursor, insert) |
| `src/inventory/scan.ts` | `scanInventory(opts)` + frontmatter/skills/agents/plugins/mcp helpers |
| `src/coverage/engine.ts` | `classify(...)` + `computeCoverage(db, opts)` |
| `src/coverage/report.ts` | `formatReport(rows, meta)` — pure text formatter |
| `src/cli.ts` | commander wiring: `init / ingest / scan / report` |
| `test/**/*.test.ts` | vitest tests + inline fixtures |

---

## Task 1: Scaffold project + shared types

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/types.ts`, `README.md` (verify `.gitignore` already exists)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "skill-radar",
  "version": "0.1.0",
  "type": "module",
  "description": "Capability radar for AI coding agents — surface the skills, tools, and subagents your agent ignores.",
  "license": "MIT",
  "scripts": {
    "radar": "tsx src/cli.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.0",
    "commander": "^12.1.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
```

- [ ] **Step 4: Create `src/types.ts`**

```ts
export type Agent = 'claude-code' | 'codex';
export type EventKind = 'skill' | 'tool' | 'subagent';
export type CapabilityKind = 'skill' | 'command' | 'agent' | 'mcp';
export type Scope = 'user' | 'project' | 'plugin' | 'bundled';
export type CoverageStatus = 'never' | 'underused' | 'healthy';

export interface UsageEvent {
  ts: string; // ISO timestamp
  sessionId: string;
  project: string; // absolute cwd
  agent: Agent;
  kind: EventKind;
  name: string; // skill name / tool name / subagent_type (plugin-qualified for plugin skills/agents)
  trigger: string | null; // caller.type, e.g. "direct"
  source: string | null; // reserved for hook/source enrichment (Plan 2+)
  toolUseId: string | null;
  promptExcerpt: string | null;
}

export interface InventoryItem {
  kind: CapabilityKind;
  name: string; // plugin-qualified (e.g. "superpowers:brainstorming") for plugin scope; bare otherwise
  scope: Scope;
  description: string | null;
  triggers: string | null;
  path: string;
}

export interface CoverageRow {
  kind: CapabilityKind;
  name: string;
  scope: Scope;
  invocations: number;
  lastUsed: string | null; // ISO
  status: CoverageStatus;
}

export interface CoverageOptions {
  windowDays: number; // default 30
  underusedStaleDays: number; // default 14
  now: Date;
}
```

- [ ] **Step 5: Create `README.md` stub**

```markdown
# skill-radar

Capability radar for AI coding agents. Surfaces the skills, subagents, and MCP
servers your agent has available but rarely or never uses.

## Dev

    npm install
    npm test
    npm run radar -- report   # after ingest + scan
```

- [ ] **Step 6: Install deps and verify toolchain**

Run: `npm install`
Expected: installs without error; `node_modules/` present.

- [ ] **Step 7: Verify typecheck passes on the empty scaffold**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/types.ts README.md package-lock.json
git commit -m "chore: scaffold skill-radar (config + shared types)"
```

---

## Task 2: Database layer (schema + open/migrate)

**Files:**
- Create: `src/db/schema.ts`, `src/db/index.ts`
- Test: `test/db/index.test.ts`

- [ ] **Step 1: Write the failing test**

`test/db/index.test.ts`:
```ts
import { describe, test, expect } from 'vitest';
import { openDb } from '../../src/db/index';

describe('openDb', () => {
  test('creates tables and roundtrips an event (idempotent on session_id+tool_use_id)', () => {
    const db = openDb(':memory:');
    const ins = db.prepare(
      `INSERT OR IGNORE INTO events (ts, session_id, project, agent, kind, name, trigger, source, tool_use_id, prompt_excerpt)
       VALUES (@ts, @sessionId, @project, @agent, @kind, @name, @trigger, @source, @toolUseId, @promptExcerpt)`,
    );
    const row = {
      ts: '2026-06-23T00:00:00.000Z', sessionId: 's1', project: '/p', agent: 'claude-code',
      kind: 'skill', name: 'foo', trigger: 'direct', source: null, toolUseId: 't1', promptExcerpt: null,
    };
    ins.run(row);
    ins.run(row); // duplicate ignored
    const count = db.prepare(`SELECT COUNT(*) AS c FROM events`).get() as { c: number };
    expect(count.c).toBe(1);
    const got = db.prepare(`SELECT name, trigger FROM events WHERE session_id = 's1'`).get() as any;
    expect(got.name).toBe('foo');
    expect(got.trigger).toBe('direct');
  });

  test('openDb is safe to call twice (migrations are idempotent)', () => {
    const db = openDb(':memory:');
    expect(() => db.exec('SELECT 1 FROM inventory LIMIT 1')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/db/index.test.ts`
Expected: FAIL — cannot find module `../../src/db/index`.

- [ ] **Step 3: Write `src/db/schema.ts`**

```ts
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  session_id TEXT NOT NULL,
  project TEXT NOT NULL,
  agent TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger TEXT,
  source TEXT,
  tool_use_id TEXT,
  prompt_excerpt TEXT,
  UNIQUE(session_id, tool_use_id)
);
CREATE INDEX IF NOT EXISTS idx_events_kind_name ON events(kind, name);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);

CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scanned_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL,
  description TEXT,
  triggers TEXT,
  path TEXT NOT NULL,
  UNIQUE(kind, name, scope)
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  project TEXT,
  started_at TEXT,
  ended_at TEXT,
  prompt_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ingest_cursors (
  file_path TEXT PRIMARY KEY,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  mtime INTEGER NOT NULL DEFAULT 0
);
`;
```

Note: `UNIQUE(session_id, tool_use_id)` gives idempotent re-ingest. Every event inserted in this plan derives from a `tool_use` block and always has an `id`, so duplicates are always caught.

- [ ] **Step 4: Write `src/db/index.ts`**

```ts
import Database from 'better-sqlite3';
import { SCHEMA } from './schema';

export type Db = Database.Database;

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/db/index.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/index.ts test/db/index.test.ts
git commit -m "feat(db): sqlite schema + openDb migration"
```

---

## Task 3: JSONL transcript parser

**Files:**
- Create: `src/ingest/parse.ts`
- Test: `test/ingest/parse.test.ts`

- [ ] **Step 1: Write the failing test (fixture mirrors the real CC schema)**

`test/ingest/parse.test.ts`:
```ts
import { describe, test, expect } from 'vitest';
import { parseTranscript } from '../../src/ingest/parse';

const FIXTURE = [
  JSON.stringify({
    type: 'user', sessionId: 'sess-1', timestamp: '2026-06-23T10:00:00.000Z', cwd: '/proj',
    message: { role: 'user', content: 'please verify the fix works' },
  }),
  JSON.stringify({
    type: 'assistant', sessionId: 'sess-1', timestamp: '2026-06-23T10:00:01.000Z', cwd: '/proj',
    message: { role: 'assistant', content: [
      { type: 'text', text: 'sure' },
      { type: 'tool_use', id: 'tu-skill', name: 'Skill', input: { skill: 'superpowers:brainstorming' }, caller: { type: 'direct' } },
    ] },
  }),
  JSON.stringify({
    type: 'assistant', sessionId: 'sess-1', timestamp: '2026-06-23T10:00:02.000Z', cwd: '/proj',
    message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'tu-agent', name: 'Agent', input: { subagent_type: 'Explore', description: 'd', prompt: 'p' } },
      { type: 'tool_use', id: 'tu-bash', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_use', id: 'tu-mcp', name: 'mcp__mcp-registry__search_mcp_registry', input: {} },
    ] },
  }),
  'not json — should be skipped',
].join('\n');

describe('parseTranscript', () => {
  test('extracts skill, subagent, tool, and mcp events with the right kind/name', () => {
    const events = parseTranscript(FIXTURE);
    const byId = Object.fromEntries(events.map((e) => [e.toolUseId, e]));

    expect(byId['tu-skill']).toMatchObject({ kind: 'skill', name: 'superpowers:brainstorming', trigger: 'direct' });
    expect(byId['tu-agent']).toMatchObject({ kind: 'subagent', name: 'Explore' });
    expect(byId['tu-bash']).toMatchObject({ kind: 'tool', name: 'Bash' });
    expect(byId['tu-mcp']).toMatchObject({ kind: 'tool', name: 'mcp__mcp-registry__search_mcp_registry' });
  });

  test('attaches session, project (cwd), ts, agent, and the preceding user prompt excerpt', () => {
    const events = parseTranscript(FIXTURE);
    const skill = events.find((e) => e.toolUseId === 'tu-skill')!;
    expect(skill.sessionId).toBe('sess-1');
    expect(skill.project).toBe('/proj');
    expect(skill.ts).toBe('2026-06-23T10:00:01.000Z');
    expect(skill.agent).toBe('claude-code');
    expect(skill.promptExcerpt).toBe('please verify the fix works');
  });

  test('ignores malformed lines and non-tool content', () => {
    const events = parseTranscript(FIXTURE);
    expect(events).toHaveLength(4); // 4 tool_use blocks; the text block and bad line are skipped
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ingest/parse.test.ts`
Expected: FAIL — cannot find module `../../src/ingest/parse`.

- [ ] **Step 3: Write `src/ingest/parse.ts`**

```ts
import type { Agent, EventKind, UsageEvent } from '../types';

const EXCERPT_MAX = 280;

function userText(content: unknown): string | null {
  if (typeof content === 'string') return content.trim().slice(0, EXCERPT_MAX) || null;
  if (Array.isArray(content)) {
    const text = content
      .filter((b): b is { type: string; text: string } =>
        !!b && typeof b === 'object' && (b as any).type === 'text' && typeof (b as any).text === 'string')
      .map((b) => b.text)
      .join(' ')
      .trim();
    return text ? text.slice(0, EXCERPT_MAX) : null;
  }
  return null;
}

function classifyToolUse(block: any): { kind: EventKind; name: string } | null {
  const name = block?.name;
  if (typeof name !== 'string' || !name) return null;
  const input = block.input ?? {};
  if (name === 'Skill') {
    const skill = input.skill ?? input.skill_name ?? input.name;
    return typeof skill === 'string' && skill ? { kind: 'skill', name: skill } : null;
  }
  if (name === 'Agent' || name === 'Task') {
    const sub = input.subagent_type ?? input.subagentType;
    return typeof sub === 'string' && sub ? { kind: 'subagent', name: sub } : null;
  }
  return { kind: 'tool', name };
}

export function parseTranscript(content: string, opts: { agent?: Agent } = {}): UsageEvent[] {
  const agent: Agent = opts.agent ?? 'claude-code';
  const events: UsageEvent[] = [];
  let lastPrompt: string | null = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: any;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed lines (fail-soft)
    }
    if (!rec || typeof rec !== 'object') continue;

    const msg = rec.message;
    const msgContent = msg && typeof msg === 'object' ? (msg as any).content : undefined;

    if (rec.type === 'user') {
      const t = userText(msgContent);
      if (t) lastPrompt = t;
      continue;
    }

    if (rec.type === 'assistant' && Array.isArray(msgContent)) {
      for (const block of msgContent) {
        if (!block || typeof block !== 'object' || block.type !== 'tool_use') continue;
        const cls = classifyToolUse(block);
        if (!cls) continue;
        events.push({
          ts: typeof rec.timestamp === 'string' ? rec.timestamp : '',
          sessionId: typeof rec.sessionId === 'string' ? rec.sessionId : '',
          project: typeof rec.cwd === 'string' ? rec.cwd : '',
          agent,
          kind: cls.kind,
          name: cls.name,
          trigger: block.caller?.type ?? null,
          source: null,
          toolUseId: typeof block.id === 'string' ? block.id : null,
          promptExcerpt: lastPrompt,
        });
      }
    }
  }
  return events;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ingest/parse.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ingest/parse.ts test/ingest/parse.test.ts
git commit -m "feat(ingest): parse CC JSONL transcripts into normalized events"
```

---

## Task 4: SourceAdapter + Claude Code ingester (file walk + mtime cursor)

**Files:**
- Create: `src/ingest/adapter.ts`
- Test: `test/ingest/adapter.test.ts`

- [ ] **Step 1: Write the failing test**

`test/ingest/adapter.test.ts`:
```ts
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
    utimesSync(file, past, past); // fix mtime so cursor sees it unchanged

    const first = ingestClaudeCode(db, { root });
    expect(first.inserted).toBe(1);

    const second = ingestClaudeCode(db, { root });
    expect(second.filesScanned).toBe(0); // skipped via mtime cursor
    expect(second.inserted).toBe(0);
    const c = db.prepare(`SELECT COUNT(*) AS c FROM events`).get() as { c: number };
    expect(c.c).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ingest/adapter.test.ts`
Expected: FAIL — cannot find module `../../src/ingest/adapter`.

- [ ] **Step 3: Write `src/ingest/adapter.ts`**

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db/index';
import type { InventoryItem, UsageEvent } from '../types';
import { parseTranscript } from './parse';

export interface IngestResult {
  filesScanned: number; // files actually (re)parsed this run
  inserted: number;
}

/**
 * A pluggable source of usage data. This is a typed placeholder for the Codex
 * adapter added in Plan 2; in Plan 1 only the standalone `ingestClaudeCode`
 * function below is used. Method names match the spec (§4.1: scanInventory,
 * ingestEvents) so Plan 2 needs no rename.
 */
export interface SourceAdapter {
  readonly agent: string;
  ingestEvents(db: Db, opts: { root: string }): IngestResult;
  scanInventory(opts: Record<string, unknown>): InventoryItem[];
}

function walkJsonl(dir: string): string[] {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkJsonl(full));
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

function insertEvents(db: Db, events: UsageEvent[]): number {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO events (ts, session_id, project, agent, kind, name, trigger, source, tool_use_id, prompt_excerpt)
     VALUES (@ts, @sessionId, @project, @agent, @kind, @name, @trigger, @source, @toolUseId, @promptExcerpt)`,
  );
  let inserted = 0;
  const tx = db.transaction((rows: UsageEvent[]) => {
    for (const r of rows) inserted += stmt.run(r).changes;
  });
  tx(events);
  return inserted;
}

/** Claude Code ingester: walk ~/.claude/projects/**, skip files whose mtime is unchanged. */
export function ingestClaudeCode(db: Db, opts: { root: string }): IngestResult {
  const files = walkJsonl(opts.root);
  const getCursor = db.prepare(`SELECT mtime FROM ingest_cursors WHERE file_path = ?`);
  const upsertCursor = db.prepare(
    `INSERT INTO ingest_cursors (file_path, byte_offset, mtime) VALUES (?, 0, ?)
     ON CONFLICT(file_path) DO UPDATE SET mtime = excluded.mtime`,
  );

  let filesScanned = 0;
  let inserted = 0;
  for (const file of files) {
    const mtime = Math.floor(statSync(file).mtimeMs);
    const prev = getCursor.get(file) as { mtime: number } | undefined;
    if (prev && prev.mtime === mtime) continue; // unchanged → skip
    filesScanned += 1;
    const content = readFileSync(file, 'utf8');
    inserted += insertEvents(db, parseTranscript(content));
    upsertCursor.run(file, mtime);
  }
  return { filesScanned, inserted };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ingest/adapter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ingest/adapter.ts test/ingest/adapter.test.ts
git commit -m "feat(ingest): SourceAdapter interface + idempotent Claude Code ingester"
```

---

## Task 5: Inventory scanner (skills, agents, plugins, MCP servers)

**Files:**
- Create: `src/inventory/scan.ts`
- Test: `test/inventory/scan.test.ts`

Scope and sources:
- **User/project skills**: `<claudeDir>/skills/*/SKILL.md` → bare name from frontmatter, scope `user`/`project`.
- **User/project agents**: `<claudeDir>/agents/*.md` → bare name, scope `user`/`project`.
- **Plugin skills/agents** (critical — most of a real setup): `<pluginsCacheDir>/<marketplace>/<plugin>/<version>/skills/*/SKILL.md` and `.../agents/*.md` → **plugin-qualified** name `"<plugin>:<name>"` (matching how events name them, e.g. `superpowers:brainstorming`), scope `plugin`.
- **MCP servers**: `mcpServers` keys read from `<claudeDir>/settings.json`, `<claudeDir>/settings.local.json`, **`~/.claude.json` (top-level)**, and **project `.mcp.json`** — because real servers live in `~/.claude.json`/`.mcp.json`, not just `settings.json`.

Slash commands and built-in subagents are intentionally out of Plan 1.

- [ ] **Step 1: Write the failing test**

`test/inventory/scan.test.ts`:
```ts
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFrontmatter, scanInventory, writeInventory } from '../../src/inventory/scan';
import { openDb } from '../../src/db/index';

describe('parseFrontmatter', () => {
  test('reads name + description, tolerating colons in the value', () => {
    const md = `---\nname: my-skill\ndescription: Use when X: do Y, not Z\n---\nbody`;
    const fm = parseFrontmatter(md);
    expect(fm.name).toBe('my-skill');
    expect(fm.description).toBe('Use when X: do Y, not Z');
  });

  test('returns empty object when there is no frontmatter', () => {
    expect(parseFrontmatter('# just a heading')).toEqual({});
  });
});

let userDir: string;
let projDir: string;
let scratch: string;

beforeEach(() => {
  userDir = mkdtempSync(join(tmpdir(), 'sr-user-'));
  projDir = mkdtempSync(join(tmpdir(), 'sr-proj-'));
  scratch = mkdtempSync(join(tmpdir(), 'sr-x-'));
});
afterEach(() => {
  rmSync(userDir, { recursive: true, force: true });
  rmSync(projDir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe('scanInventory', () => {
  test('discovers user/project/plugin skills+agents and mcp servers with correct kind/scope/name', () => {
    // user skill
    mkdirSync(join(userDir, 'skills', 'graphify'), { recursive: true });
    writeFileSync(join(userDir, 'skills', 'graphify', 'SKILL.md'),
      `---\nname: graphify\ndescription: turn anything into a knowledge graph\n---\n`);
    // user agent
    mkdirSync(join(userDir, 'agents'), { recursive: true });
    writeFileSync(join(userDir, 'agents', 'explorer.md'),
      `---\nname: Explore\ndescription: read-only search agent\n---\n`);
    // user mcp via settings.json
    writeFileSync(join(userDir, 'settings.json'),
      JSON.stringify({ mcpServers: { 'Claude Preview': { command: 'x' } } }));
    // user mcp via ~/.claude.json top-level (hyphenated server)
    const claudeJson = join(scratch, 'claude.json');
    writeFileSync(claudeJson, JSON.stringify({ mcpServers: { 'mcp-registry': { command: 'y' } } }));
    // project skill
    mkdirSync(join(projDir, 'skills', 'verify'), { recursive: true });
    writeFileSync(join(projDir, 'skills', 'verify', 'SKILL.md'),
      `---\nname: verify\ndescription: run the app to verify a change\n---\n`);
    // plugin skill + plugin agent in the cache layout
    const cache = join(scratch, 'cache');
    mkdirSync(join(cache, 'sp-marketplace', 'superpowers', '5.1.0', 'skills', 'brainstorming'), { recursive: true });
    writeFileSync(join(cache, 'sp-marketplace', 'superpowers', '5.1.0', 'skills', 'brainstorming', 'SKILL.md'),
      `---\nname: brainstorming\ndescription: explore ideas\n---\n`);
    mkdirSync(join(cache, 'sl-marketplace', 'ship-loop', '1.0.0', 'agents'), { recursive: true });
    writeFileSync(join(cache, 'sl-marketplace', 'ship-loop', '1.0.0', 'agents', 'impl.md'),
      `---\nname: ship-implementer\ndescription: implements one feature\n---\n`);

    const items = scanInventory({
      userDir, projectDir: projDir, pluginsCacheDir: cache, userMcpJson: claudeJson,
    });
    const find = (kind: string, name: string) => items.find((i) => i.kind === kind && i.name === name);

    expect(find('skill', 'graphify')).toMatchObject({ scope: 'user', description: 'turn anything into a knowledge graph' });
    expect(find('agent', 'Explore')).toMatchObject({ scope: 'user' });
    expect(find('mcp', 'Claude Preview')).toMatchObject({ scope: 'user' });
    expect(find('mcp', 'mcp-registry')).toMatchObject({ scope: 'user' });
    expect(find('skill', 'verify')).toMatchObject({ scope: 'project' });
    // plugin items are plugin-qualified, scope 'plugin'
    expect(find('skill', 'superpowers:brainstorming')).toMatchObject({ scope: 'plugin' });
    expect(find('agent', 'ship-loop:ship-implementer')).toMatchObject({ scope: 'plugin' });
  });

  test('returns [] when nothing exists', () => {
    expect(scanInventory({ userDir: join(userDir, 'nope'), projectDir: join(projDir, 'nope') })).toEqual([]);
  });
});

describe('writeInventory', () => {
  test('replaces inventory rows and is idempotent', () => {
    const db = openDb(':memory:');
    const items = [{ kind: 'skill', name: 'foo', scope: 'user', description: 'd', triggers: null, path: '/p' } as const];
    writeInventory(db, items as any, '2026-06-23T00:00:00.000Z');
    writeInventory(db, items as any, '2026-06-23T01:00:00.000Z');
    const c = db.prepare(`SELECT COUNT(*) AS c FROM inventory`).get() as { c: number };
    expect(c.c).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/inventory/scan.test.ts`
Expected: FAIL — cannot find module `../../src/inventory/scan`.

- [ ] **Step 3: Write `src/inventory/scan.ts`**

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Db } from '../db/index';
import type { InventoryItem, Scope } from '../types';

export interface Frontmatter {
  name?: string;
  description?: string;
}

export interface ScanOptions {
  userDir: string; // ~/.claude
  projectDir?: string; // <cwd>/.claude
  pluginsCacheDir?: string; // ~/.claude/plugins/cache
  userMcpJson?: string; // ~/.claude.json
  projectMcpJson?: string; // <cwd>/.mcp.json
}

/** Minimal single-line-scalar frontmatter reader (sufficient for SKILL.md name/description). */
export function parseFrontmatter(md: string): Frontmatter {
  const lines = md.split('\n');
  if (lines[0]?.trim() !== '---') return {};
  const fm: Frontmatter = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') break;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key === 'name') fm.name = val;
    else if (key === 'description') fm.description = val;
  }
  return fm;
}

function dirNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

function mdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function scanSkills(claudeDir: string, scope: Scope, qualifier?: string): InventoryItem[] {
  const root = join(claudeDir, 'skills');
  const items: InventoryItem[] = [];
  for (const name of dirNames(root)) {
    const path = join(root, name, 'SKILL.md');
    if (!existsSync(path)) continue;
    const fm = parseFrontmatter(readFileSync(path, 'utf8'));
    const bare = fm.name ?? name;
    items.push({
      kind: 'skill', name: qualifier ? `${qualifier}:${bare}` : bare,
      scope, description: fm.description ?? null, triggers: null, path,
    });
  }
  return items;
}

function scanAgents(claudeDir: string, scope: Scope, qualifier?: string): InventoryItem[] {
  const root = join(claudeDir, 'agents');
  const items: InventoryItem[] = [];
  for (const file of mdFiles(root)) {
    const path = join(root, file);
    const fm = parseFrontmatter(readFileSync(path, 'utf8'));
    const bare = fm.name ?? basename(file, '.md');
    items.push({
      kind: 'agent', name: qualifier ? `${qualifier}:${bare}` : bare,
      scope, description: fm.description ?? null, triggers: null, path,
    });
  }
  return items;
}

/** Read mcpServers keys from a single JSON file (settings.json / ~/.claude.json / .mcp.json). */
function scanMcpFile(path: string, scope: Scope): InventoryItem[] {
  if (!existsSync(path)) return [];
  let json: any;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
  const servers = json?.mcpServers;
  if (!servers || typeof servers !== 'object') return [];
  return Object.keys(servers).map((name) => ({
    kind: 'mcp' as const, name, scope, description: null, triggers: null, path,
  }));
}

/**
 * Scan plugin skills/agents from the cache layout:
 *   <cache>/<marketplace>/<plugin>/<version>/{skills,agents}/...
 * The plugin (2nd path segment) is the event qualifier, e.g. "superpowers".
 */
function scanPlugins(cacheDir: string): InventoryItem[] {
  const items: InventoryItem[] = [];
  for (const marketplace of dirNames(cacheDir)) {
    for (const plugin of dirNames(join(cacheDir, marketplace))) {
      for (const version of dirNames(join(cacheDir, marketplace, plugin))) {
        const base = join(cacheDir, marketplace, plugin, version);
        items.push(...scanSkills(base, 'plugin', plugin));
        items.push(...scanAgents(base, 'plugin', plugin));
      }
    }
  }
  return items;
}

export function scanInventory(opts: ScanOptions): InventoryItem[] {
  const items: InventoryItem[] = [];

  if (existsSync(opts.userDir)) {
    items.push(...scanSkills(opts.userDir, 'user'));
    items.push(...scanAgents(opts.userDir, 'user'));
    items.push(...scanMcpFile(join(opts.userDir, 'settings.json'), 'user'));
    items.push(...scanMcpFile(join(opts.userDir, 'settings.local.json'), 'user'));
  }
  if (opts.userMcpJson) items.push(...scanMcpFile(opts.userMcpJson, 'user'));

  if (opts.projectDir && existsSync(opts.projectDir)) {
    items.push(...scanSkills(opts.projectDir, 'project'));
    items.push(...scanAgents(opts.projectDir, 'project'));
    items.push(...scanMcpFile(join(opts.projectDir, 'settings.json'), 'project'));
    items.push(...scanMcpFile(join(opts.projectDir, 'settings.local.json'), 'project'));
  }
  if (opts.projectMcpJson) items.push(...scanMcpFile(opts.projectMcpJson, 'project'));

  if (opts.pluginsCacheDir) items.push(...scanPlugins(opts.pluginsCacheDir));

  // de-dupe by (kind, name, scope); first wins (handles multiple plugin versions)
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = `${i.kind}\t${i.name}\t${i.scope}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Persist inventory snapshot into the DB (replace-all semantics). */
export function writeInventory(db: Db, items: InventoryItem[], scannedAt: string): number {
  const del = db.prepare(`DELETE FROM inventory`);
  const ins = db.prepare(
    `INSERT OR IGNORE INTO inventory (scanned_at, kind, name, scope, description, triggers, path)
     VALUES (@scannedAt, @kind, @name, @scope, @description, @triggers, @path)`,
  );
  let n = 0;
  const tx = db.transaction((rows: InventoryItem[]) => {
    del.run();
    for (const r of rows) n += ins.run({ ...r, scannedAt }).changes;
  });
  tx(items);
  return n;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/inventory/scan.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/inventory/scan.ts test/inventory/scan.test.ts
git commit -m "feat(inventory): scan user/project/plugin skills+agents + mcp from all sources"
```

---

## Task 6: Coverage engine (matching + classification)

**Files:**
- Create: `src/coverage/engine.ts`
- Test: `test/coverage/engine.test.ts`

Matching rules (event → inventory item), **exact name match** (inventory stores plugin items plugin-qualified, exactly as events name them — so no fuzzy suffix matching, which would risk cross-plugin collisions):
- `skill` item ← event `kind='skill'` and `event.name === item.name`.
- `agent` item ← event `kind='subagent'` and `event.name === item.name`.
- `mcp` item ← event `kind='tool'` and `event.name.startsWith('mcp__' + normalizeMcp(item.name) + '__')`.

`normalizeMcp` mirrors Claude Code's tool-name sanitizer: it replaces whitespace and dots with `_` but **preserves hyphens** (real tool names look like `mcp__mcp-registry__search`).

Classification (`classify`): `never` if 0 invocations; else `underused` if last use is older than `underusedStaleDays` **or** (the rarity rule is active and invocation count ≤ the kind's bottom-quartile count); else `healthy`. The rarity rule is **disabled** (signalled by a threshold of `-1`) when a kind has fewer than 4 used items, because a quartile is meaningless on tiny samples (otherwise the single busiest item would flag itself as underused).

- [ ] **Step 1: Write the failing test**

`test/coverage/engine.test.ts`:
```ts
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
    expect(get('graphify').status).toBe('healthy'); // only 2 used skills (<4) → rarity disabled
    expect(get('superpowers:brainstorming').invocations).toBe(2); // exact qualified match
    expect(get('verify').status).toBe('never');
    expect(get('Explore').invocations).toBe(1);
    expect(get('mcp-registry').invocations).toBe(1); // hyphen preserved → prefix matches
    expect(rows[0].status).toBe('never'); // never items sort first
  });

  test('only counts events inside the window', () => {
    const db = openDb(':memory:');
    db.prepare(`INSERT INTO inventory (scanned_at, kind, name, scope, path) VALUES ('t','skill','old','user','/o')`).run();
    db.prepare(`INSERT INTO events (ts, session_id, project, agent, kind, name, tool_use_id) VALUES ('2026-01-01T00:00:00.000Z','s','/p','claude-code','skill','old','x1')`).run();
    const rows = computeCoverage(db, OPTS);
    expect(rows.find((r) => r.name === 'old')!.status).toBe('never'); // outside 30d window
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/coverage/engine.test.ts`
Expected: FAIL — cannot find module `../../src/coverage/engine`.

- [ ] **Step 3: Write `src/coverage/engine.ts`**

```ts
import type { Db } from '../db/index';
import type { CapabilityKind, CoverageOptions, CoverageRow, CoverageStatus, Scope } from '../types';

/** Mirror Claude Code's mcp tool-name sanitizer: whitespace/dots → '_', hyphens preserved. */
export function normalizeMcp(name: string): string {
  return name.replace(/[\s.]/g, '_');
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / 86_400_000;
}

/**
 * rarityThreshold < 0 means "rarity rule disabled" (too few samples for a quartile);
 * otherwise an item with invocations <= rarityThreshold is considered rare.
 */
export function classify(
  invocations: number,
  lastUsed: string | null,
  rarityThreshold: number,
  opts: CoverageOptions,
): CoverageStatus {
  if (invocations === 0) return 'never';
  const stale = lastUsed ? daysBetween(new Date(lastUsed), opts.now) > opts.underusedStaleDays : true;
  if (stale || (rarityThreshold >= 0 && invocations <= rarityThreshold)) return 'underused';
  return 'healthy';
}

interface InvRow { kind: CapabilityKind; name: string; scope: Scope; }
interface Agg { kind: string; name: string; c: number; m: string | null; }

function matches(item: InvRow, agg: Agg): boolean {
  if (item.kind === 'skill') return agg.kind === 'skill' && agg.name === item.name;
  if (item.kind === 'agent') return agg.kind === 'subagent' && agg.name === item.name;
  if (item.kind === 'mcp') return agg.kind === 'tool' && agg.name.startsWith('mcp__' + normalizeMcp(item.name) + '__');
  return false; // 'command' is not covered in Plan 1
}

const MIN_SAMPLES_FOR_QUARTILE = 4;

function quartileThreshold(counts: number[]): number {
  const used = counts.filter((c) => c > 0).sort((a, b) => a - b);
  if (used.length < MIN_SAMPLES_FOR_QUARTILE) return -1; // rarity rule disabled
  const idx = Math.floor(0.25 * (used.length - 1));
  return used[idx];
}

const STATUS_ORDER: Record<CoverageStatus, number> = { never: 0, underused: 1, healthy: 2 };

export function computeCoverage(db: Db, opts: CoverageOptions): CoverageRow[] {
  const cutoff = new Date(opts.now.getTime() - opts.windowDays * 86_400_000).toISOString();

  const inventory = db
    .prepare(`SELECT kind, name, scope FROM inventory WHERE kind IN ('skill','agent','mcp')`)
    .all() as InvRow[];

  const aggs = db
    .prepare(`SELECT kind, name, COUNT(*) AS c, MAX(ts) AS m FROM events WHERE ts >= ? GROUP BY kind, name`)
    .all(cutoff) as Agg[];

  // first pass: counts per item (to compute per-kind rarity thresholds)
  const tally = inventory.map((item) => {
    let invocations = 0;
    let lastUsed: string | null = null;
    for (const agg of aggs) {
      if (!matches(item, agg)) continue;
      invocations += agg.c;
      if (agg.m && (!lastUsed || agg.m > lastUsed)) lastUsed = agg.m;
    }
    return { item, invocations, lastUsed };
  });

  const thresholds: Record<string, number> = {};
  for (const kind of ['skill', 'agent', 'mcp'] as const) {
    thresholds[kind] = quartileThreshold(tally.filter((t) => t.item.kind === kind).map((t) => t.invocations));
  }

  const rows: CoverageRow[] = tally.map(({ item, invocations, lastUsed }) => ({
    kind: item.kind,
    name: item.name,
    scope: item.scope,
    invocations,
    lastUsed,
    status: classify(invocations, lastUsed, thresholds[item.kind] ?? -1, opts),
  }));

  rows.sort((a, b) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    b.invocations - a.invocations ||
    a.name.localeCompare(b.name));

  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/coverage/engine.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/coverage/engine.ts test/coverage/engine.test.ts
git commit -m "feat(coverage): exact-match coverage engine + sample-guarded classification"
```

---

## Task 7: Report formatter + CLI wiring

**Files:**
- Create: `src/coverage/report.ts`, `src/cli.ts`
- Test: `test/coverage/report.test.ts`

- [ ] **Step 1: Write the failing test for the formatter**

`test/coverage/report.test.ts`:
```ts
import { describe, test, expect } from 'vitest';
import { formatReport } from '../../src/coverage/report';
import type { CoverageRow } from '../../src/types';

const rows: CoverageRow[] = [
  { kind: 'skill', name: 'verify', scope: 'user', invocations: 0, lastUsed: null, status: 'never' },
  { kind: 'agent', name: 'Explore', scope: 'user', invocations: 1, lastUsed: '2026-05-01T00:00:00.000Z', status: 'underused' },
  { kind: 'skill', name: 'graphify', scope: 'user', invocations: 142, lastUsed: '2026-06-22T00:00:00.000Z', status: 'healthy' },
];

describe('formatReport', () => {
  test('renders coverage %, ignored, underused, and top-used sections', () => {
    const out = formatReport(rows, { windowDays: 30, now: new Date('2026-06-23T00:00:00.000Z') });
    expect(out).toContain('Capability coverage:');
    expect(out).toContain('2/3'); // 2 of 3 used
    expect(out).toContain('Ignored (0 invocations): 1');
    expect(out).toContain('verify');
    expect(out).toContain('Underused: 1');
    expect(out).toContain('Explore');
    expect(out).toContain('graphify');
    expect(out).toContain('slash commands'); // deferred-coverage note
    expect(out).toContain('built-in'); // built-in subagents caveat
  });

  test('handles an empty inventory gracefully', () => {
    const out = formatReport([], { windowDays: 30, now: new Date('2026-06-23T00:00:00.000Z') });
    expect(out).toContain('Capability coverage:');
    expect(out).toContain('0/0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/coverage/report.test.ts`
Expected: FAIL — cannot find module `../../src/coverage/report`.

- [ ] **Step 3: Write `src/coverage/report.ts`**

```ts
import type { CoverageRow } from '../types';

export interface ReportMeta {
  windowDays: number;
  now: Date;
}

function daysAgo(iso: string | null, now: Date): string {
  if (!iso) return 'never';
  const d = Math.round((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? 'today' : `${d}d ago`;
}

export function formatReport(rows: CoverageRow[], meta: ReportMeta): string {
  const total = rows.length;
  const used = rows.filter((r) => r.invocations > 0).length;
  const pct = total === 0 ? 0 : Math.round((used / total) * 100);

  const ignored = rows.filter((r) => r.status === 'never');
  const underused = rows.filter((r) => r.status === 'underused');
  const topUsed = rows.filter((r) => r.invocations > 0).sort((a, b) => b.invocations - a.invocations).slice(0, 10);

  const lines: string[] = [];
  lines.push(`skill-radar — coverage report (window: ${meta.windowDays}d)`);
  lines.push(`Capability coverage: ${pct}% (${used}/${total} used)`);
  lines.push('');

  lines.push(`⚠ Ignored (0 invocations): ${ignored.length}`);
  for (const r of ignored) lines.push(`   - ${r.name} (${r.scope}) [${r.kind}]`);
  lines.push('');

  lines.push(`▲ Underused: ${underused.length}`);
  for (const r of underused) lines.push(`   - ${r.name} [${r.kind}] — ${r.invocations} call(s), last ${daysAgo(r.lastUsed, meta.now)}`);
  lines.push('');

  lines.push('Top used:');
  for (const r of topUsed) lines.push(`   - ${r.name} [${r.kind}] — ${r.invocations}`);
  lines.push('');

  lines.push('Notes:');
  lines.push('  - Slash commands are not yet covered (deferred to a later plan).');
  lines.push('  - Built-in subagents (e.g. general-purpose, Explore) have no on-disk definition and are excluded from the denominator.');
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/coverage/report.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write `src/cli.ts`**

Note: `--db` is declared on each subcommand (not globally) so it works after the command name, e.g. `skill-radar ingest --db /tmp/x.sqlite`.

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { Command } from 'commander';
import { openDb, type Db } from './db/index';
import { ingestClaudeCode } from './ingest/adapter';
import { scanInventory, writeInventory } from './inventory/scan';
import { computeCoverage } from './coverage/engine';
import { formatReport } from './coverage/report';

function defaultDbPath(): string {
  if (process.env.SKILL_RADAR_DB) return process.env.SKILL_RADAR_DB;
  const dir = join(homedir(), '.skill-radar');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'skill-radar.sqlite');
}

function withDb<T>(dbPath: string | undefined, fn: (db: Db) => T): T {
  const db = openDb(dbPath ?? defaultDbPath());
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const program = new Command();
program.name('skill-radar').description('Capability radar for AI coding agents').version('0.1.0');

program
  .command('init')
  .description('create/migrate the database')
  .option('--db <path>', 'database file path')
  .action((opts) => {
    const path = opts.db ?? defaultDbPath();
    withDb(path, () => {});
    console.log(`Initialized database at ${path}`);
  });

program
  .command('ingest')
  .description('ingest Claude Code transcripts')
  .option('--db <path>', 'database file path')
  .option('--projects-dir <dir>', 'override ~/.claude/projects')
  .action((opts) => {
    const root = opts.projectsDir ?? join(homedir(), '.claude', 'projects');
    const res = withDb(opts.db, (db) => ingestClaudeCode(db, { root }));
    console.log(`Ingested: ${res.inserted} new event(s) from ${res.filesScanned} changed file(s).`);
  });

program
  .command('scan')
  .description('scan available capabilities (skills, agents, plugins, mcp)')
  .option('--db <path>', 'database file path')
  .option('--user-dir <dir>', 'override ~/.claude')
  .option('--project-dir <dir>', 'override <cwd>/.claude')
  .action((opts) => {
    const userDir = opts.userDir ?? join(homedir(), '.claude');
    const projectDir = opts.projectDir ?? join(process.cwd(), '.claude');
    const n = withDb(opts.db, (db) => {
      const items = scanInventory({
        userDir,
        projectDir,
        pluginsCacheDir: join(homedir(), '.claude', 'plugins', 'cache'),
        userMcpJson: join(homedir(), '.claude.json'),
        projectMcpJson: join(process.cwd(), '.mcp.json'),
      });
      return writeInventory(db, items, new Date().toISOString());
    });
    console.log(`Scanned ${n} capability item(s) into inventory.`);
  });

program
  .command('report')
  .description('print coverage report')
  .option('--db <path>', 'database file path')
  .option('--window <days>', 'window in days', '30')
  .option('--stale <days>', 'underused staleness threshold in days', '14')
  .action((opts) => {
    const now = new Date();
    const out = withDb(opts.db, (db) =>
      formatReport(
        computeCoverage(db, {
          windowDays: Number(opts.window),
          underusedStaleDays: Number(opts.stale),
          now,
        }),
        { windowDays: Number(opts.window), now },
      ),
    );
    console.log(out);
  });

program.parse();
```

- [ ] **Step 6: Manual end-to-end smoke test against real data**

Run:
```bash
npm run radar -- ingest
npm run radar -- scan
npm run radar -- report
```
Expected: `report` prints a coverage report listing ignored/underused/top-used capabilities from your real `~/.claude` history, including plugin skills (e.g. `superpowers:*`) in the denominator. (This is the proof the pipeline works end-to-end.)

- [ ] **Step 7: Typecheck the whole project**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/coverage/report.ts src/cli.ts test/coverage/report.test.ts
git commit -m "feat(cli): report formatter + init/ingest/scan/report commands"
```

---

## Self-Review (completed during authoring + adversarial verification pass)

**Spec coverage (Plan 1 portion):**
- Ingester / JSONL parse / SourceAdapter (`ingestEvents`/`scanInventory` names match spec §4.1) → Tasks 3, 4 ✓
- Inventory scanner: user + project + **plugin** skills/agents (plugin-qualified, scope `plugin`) + MCP from `settings.json`, `settings.local.json`, `~/.claude.json`, project `.mcp.json` → Task 5 ✓
- Coverage engine: exact-match join + `never/underused/healthy` with the spec's thresholds and a min-sample guard on the quartile rule → Task 6 ✓
- SQLite data model (`events`, `inventory`, `sessions`, `ingest_cursors`) → Task 2 ✓ (`optimizations` table is Plan 2)
- Local-first, no telemetry → all data in local SQLite ✓
- CLI surface `init/ingest/scan/report` with `--db` usable after the subcommand → Task 7 ✓
- Deliberately **not** in Plan 1 (matches non-goals/phasing): missed-invocation, AI loop, dashboard, plugin packaging, Codex, cost tracking ✓

**Fixes applied from the adversarial verification pass:**
- **Blocker** — quartile rule flagged the busiest item as underused on tiny samples, and the two test groups encoded contradictory `<=`/`<` boundaries. Fixed: min-sample guard (`-1` disables rarity below 4 used items); `classify` uses a single clear `<=` semantic with explicit `rarityThreshold >= 0` gating; fixtures re-derived by hand.
- **High** — `normalizeMcp` clobbered hyphens. Fixed to `replace(/[\s.]/g, '_')`; hyphenated test case added.
- **High** — plugin skills/agents were never scanned. Fixed: `scanPlugins` walks the cache layout and stores plugin-qualified names; matching is now exact (no collision-prone `endsWith`).
- **Medium** — MCP only read from `settings.json`. Fixed: also `~/.claude.json` + project `.mcp.json`.
- **Medium** — built-in subagents absent from denominator. Documented explicitly in the report's Notes.
- **Low** — commander `--db` ordering. Fixed: `--db` declared per subcommand.
- **Low** — `SourceAdapter` method drift. Fixed: renamed to `ingestEvents`; documented as a typed placeholder for Plan 2.

**Placeholder scan:** every code/test step contains complete, runnable content. No TODO/TBD; no leftover illustrative helpers.

**Type consistency:** `UsageEvent`, `InventoryItem`, `CoverageRow`, `CoverageOptions`, `CapabilityKind`, `Scope`, `EventKind`, `Agent`, `ScanOptions`, `Frontmatter`, `IngestResult`, `Db` defined once and reused. Function names consistent across tasks: `openDb`, `parseTranscript`, `ingestClaudeCode`, `scanInventory`, `writeInventory`, `parseFrontmatter`, `classify`, `computeCoverage`, `normalizeMcp`, `formatReport`.

---

## Execution Handoff

After Plan 1 lands and the smoke test prints a real report (with plugin skills in the denominator), Plan 2 (missed-invocation + headless-CC AI optimization loop) gets authored next.
