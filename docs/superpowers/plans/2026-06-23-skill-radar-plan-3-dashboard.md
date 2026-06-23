# skill-radar Plan 3 — Local Web Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `skill-radar serve` command that starts a local web dashboard showing capability coverage, the ignored/underused panel, usage leaderboards, and the AI optimization-suggestion feed — all read from the local SQLite DB, no network, no build step.

**Architecture:** A tiny [Hono](https://hono.dev) app (`createApp(db, opts)`) exposes JSON endpoints (`/api/stats`, `/api/coverage`, `/api/suggestions`) backed by the existing `computeCoverage` (Plan 1/2a) and `readOptimizations` (Plan 2b), plus a single static `GET /` serving a self-contained vanilla-JS dashboard page. Hono's `app.request()` makes every route unit-testable with no real port; `@hono/node-server` binds the same app to a real port for `serve`. A `now` clock is injectable for deterministic tests.

**Tech Stack:** TypeScript (Node ≥20), `better-sqlite3`, `commander`, `vitest`, `tsx` (unchanged), **+ `hono` and `@hono/node-server`** (only new deps). The dashboard UI is a single hand-written `dashboard.html` (embedded CSS + `fetch`) — **no Vite/React/Tailwind, no build step**.

**Design deviation from the spec:** The design spec listed "Vite + React + Tailwind" as the dashboard stack. This plan deliberately uses a buildless single static HTML page instead: the dashboard is read-only (fetch JSON → render tables/cards), so a build toolchain adds maintenance and a build step for no real benefit. Vanilla HTML/JS fully delivers the spec's intent (a local web dashboard) while keeping the project dependency-light and instantly runnable via `tsx`. The visual structure matches the approved mockup (top metric bar, leaderboard, ignored/underused panel, optimization feed).

**Prerequisite:** Plan 2b merged into `main` (`computeCoverage`, `readOptimizations`, `StoredOptimization`, the `optimizations` table).

**Scope note:** read-only dashboard. No write actions (no apply-rewrite, no triggering `analyze` from the UI) in v1 — those are later. The page polls the JSON endpoints on load (and a manual refresh button); no websockets/live-streaming.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `package.json` | modify | add `hono`, `@hono/node-server` |
| `src/server/api.ts` | create | `statsPayload(db, opts)` — summary aggregation (pure) |
| `src/server/server.ts` | create | `createApp(db, opts)` (routes) + `startServer(db, opts, port)` |
| `src/server/dashboard.html` | create | self-contained vanilla dashboard page |
| `src/cli.ts` | modify | add `serve` command |
| `test/server/**` | create | api + route tests (via `app.request`) |

---

## Task 1: Deps + stats payload

**Files:**
- Modify: `package.json`
- Create: `src/server/api.ts`
- Test: `test/server/api.test.ts`

- [ ] **Step 1: Add deps to `package.json`** (in `"dependencies"`)

```json
    "@hono/node-server": "^1.13.7",
    "better-sqlite3": "^11.8.0",
    "commander": "^12.1.0",
    "hono": "^4.6.14"
```
(Keep the existing `better-sqlite3`/`commander` entries; just add `@hono/node-server` and `hono`.)

- [ ] **Step 2: Install**

Run: `npm install`
Expected: installs `hono` + `@hono/node-server` with no error.

- [ ] **Step 3: Write the failing test**

`test/server/api.test.ts`:
```ts
import { describe, test, expect } from 'vitest';
import { openDb } from '../../src/db/index';
import { statsPayload } from '../../src/server/api';
import type { CoverageOptions } from '../../src/types';

const OPTS: CoverageOptions = { windowDays: 30, underusedStaleDays: 14, now: new Date('2026-06-23T00:00:00.000Z') };

function seed() {
  const db = openDb(':memory:');
  const inv = db.prepare(`INSERT INTO inventory (scanned_at, kind, name, scope, description, triggers, path) VALUES ('t',?,?,?,null,null,'/p')`);
  inv.run('skill', 'graphify', 'user');   // used → healthy
  inv.run('skill', 'verify', 'user');     // never
  inv.run('agent', 'Explore', 'user');    // never
  const ev = db.prepare(`INSERT INTO events (ts, session_id, project, agent, kind, name, tool_use_id) VALUES (?,?,?,?,?,?,?)`);
  for (let i = 0; i < 5; i++) ev.run('2026-06-22T00:00:00.000Z', 's', '/p', 'claude-code', 'skill', 'graphify', `g${i}`);
  db.prepare(`INSERT INTO optimizations (created_at, target_kind, target_name, status, overall_confidence, facets, applied) VALUES ('t','skill','verify','never','high','{"facets":[{"facet":"description","diagnosis":"d","suggestion":"s","confidence":"high"}],"overallConfidence":"high","trulyMissed":true,"verdictReasoning":"r"}',0)`).run();
  return db;
}

describe('statsPayload', () => {
  test('summarizes coverage + optimization counts', () => {
    const s = statsPayload(seed(), OPTS);
    expect(s.total).toBe(3);
    expect(s.used).toBe(1);
    expect(s.coveragePct).toBe(33);
    expect(s.ignored).toBe(2);
    expect(s.healthy).toBe(1);
    expect(s.suggestions).toBe(1);
    expect(s.windowDays).toBe(30);
  });

  test('empty db → zeros (no divide-by-zero)', () => {
    const s = statsPayload(openDb(':memory:'), OPTS);
    expect(s).toMatchObject({ total: 0, used: 0, coveragePct: 0, ignored: 0, underused: 0, healthy: 0, suggestions: 0 });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run test/server/api.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 5: Write `src/server/api.ts`**

```ts
import type { Db } from '../db/index';
import type { CoverageOptions } from '../types';
import { computeCoverage } from '../coverage/engine';

export interface StatsPayload {
  windowDays: number;
  total: number;
  used: number;
  coveragePct: number;
  ignored: number;
  underused: number;
  healthy: number;
  suggestions: number;
}

export function statsPayload(db: Db, opts: CoverageOptions): StatsPayload {
  const rows = computeCoverage(db, opts);
  const total = rows.length;
  const used = rows.filter((r) => r.invocations > 0).length;
  const ignored = rows.filter((r) => r.status === 'never').length;
  const underused = rows.filter((r) => r.status === 'underused').length;
  const healthy = rows.filter((r) => r.status === 'healthy').length;
  const suggestions = (db.prepare(`SELECT COUNT(*) AS c FROM optimizations WHERE target_kind = 'skill'`).get() as { c: number }).c; // match /api/suggestions' filter so the counts can't diverge
  return {
    windowDays: opts.windowDays,
    total,
    used,
    coveragePct: total === 0 ? 0 : Math.round((used / total) * 100),
    ignored,
    underused,
    healthy,
    suggestions,
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/server/api.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/server/api.ts test/server/api.test.ts
git commit -m "feat(server): stats payload + hono deps"
```

---

## Task 2: Hono app + JSON routes

**Files:**
- Create: `src/server/server.ts`
- Test: `test/server/server.test.ts`

- [ ] **Step 1: Write the failing test**

`test/server/server.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/server/server.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/server/server.ts`**

```ts
import { Hono } from 'hono';
import type { Db } from '../db/index';
import type { CoverageOptions } from '../types';
import { computeCoverage } from '../coverage/engine';
import { readOptimizations } from '../analyze/suggestions';
import { statsPayload } from './api';

export interface ServerOptions {
  windowDays: number;
  underusedStaleDays: number;
  now?: () => Date; // injectable clock (default: real time) for deterministic tests
}

function coverageOptions(opts: ServerOptions): CoverageOptions {
  return { windowDays: opts.windowDays, underusedStaleDays: opts.underusedStaleDays, now: (opts.now ?? (() => new Date()))() };
}

export function createApp(db: Db, opts: ServerOptions): Hono {
  const app = new Hono();
  app.get('/api/stats', (c) => c.json(statsPayload(db, coverageOptions(opts))));
  app.get('/api/coverage', (c) => c.json(computeCoverage(db, coverageOptions(opts))));
  app.get('/api/suggestions', (c) => c.json(readOptimizations(db)));
  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/server/server.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/server.ts test/server/server.test.ts
git commit -m "feat(server): hono app with stats/coverage/suggestions routes"
```

---

## Task 3: Dashboard page + static route

**Files:**
- Create: `src/server/dashboard.html`
- Modify: `src/server/server.ts`
- Test: `test/server/server.test.ts` (add a case)

- [ ] **Step 1: Write `src/server/dashboard.html`** (self-contained — embedded CSS + vanilla JS)

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>skill-radar</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 24px; max-width: 1100px; margin: 0 auto; line-height: 1.5; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 2px; }
  .sub { color: #888; font-size: 13px; margin-bottom: 20px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { border: 1px solid rgba(128,128,128,.25); border-radius: 10px; padding: 14px; }
  .card .n { font-size: 26px; font-weight: 700; }
  .card .l { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #888; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .panel { border: 1px solid rgba(128,128,128,.25); border-radius: 10px; padding: 14px; }
  .panel h2 { font-size: 14px; margin: 0 0 10px; }
  .row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dashed rgba(128,128,128,.18); font-size: 13px; }
  .row:last-child { border-bottom: none; }
  .muted { color: #999; }
  .pill { font-size: 10px; padding: 1px 7px; border-radius: 99px; border: 1px solid; }
  .never { color: #e5534b; border-color: #e5534b; }
  .underused { color: #c69026; border-color: #c69026; }
  .sug { border: 1px solid rgba(128,128,128,.25); border-radius: 9px; padding: 10px; margin-bottom: 10px; }
  .sug summary { cursor: pointer; font-weight: 600; }
  .facet { margin: 8px 0 0 8px; font-size: 13px; }
  .facet .k { font-weight: 600; }
  .facet .s { background: rgba(63,185,80,.1); border-radius: 6px; padding: 4px 8px; margin-top: 3px; }
  button { font: inherit; padding: 6px 12px; border-radius: 7px; border: 1px solid rgba(128,128,128,.4); background: transparent; cursor: pointer; }
  .full { grid-column: 1 / -1; }
</style>
</head>
<body>
  <h1>skill-radar</h1>
  <div class="sub" id="sub">loading…</div>
  <div class="cards" id="cards"></div>
  <div class="grid">
    <div class="panel">
      <h2>⚠ Ignored / underused</h2>
      <div id="ignored"></div>
    </div>
    <div class="panel">
      <h2>▲ Top used</h2>
      <div id="topused"></div>
    </div>
    <div class="panel full">
      <h2>💡 Optimization suggestions <button onclick="load()">refresh</button></h2>
      <div id="suggestions"></div>
    </div>
  </div>
<script>
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
async function load() {
  const [stats, coverage, suggestions] = await Promise.all([
    fetch('/api/stats').then((r) => r.json()),
    fetch('/api/coverage').then((r) => r.json()),
    fetch('/api/suggestions').then((r) => r.json()),
  ]);
  document.getElementById('sub').textContent = `capability coverage over the last ${stats.windowDays} days · local-first`;
  document.getElementById('cards').innerHTML = [
    ['coverage', stats.coveragePct + '%', `${stats.used}/${stats.total} used`],
    ['ignored', stats.ignored, 'never used'],
    ['underused', stats.underused, 'rare or stale'],
    ['suggestions', stats.suggestions, 'AI packages'],
  ].map(([l, n, s]) => `<div class="card"><div class="l">${l}</div><div class="n">${esc(n)}</div><div class="muted" style="font-size:12px">${esc(s)}</div></div>`).join('');

  const ignored = coverage.filter((r) => r.status !== 'healthy')
    .sort((a, b) => (a.status === 'never' ? 0 : 1) - (b.status === 'never' ? 0 : 1) || a.name.localeCompare(b.name));
  document.getElementById('ignored').innerHTML = ignored.length
    ? ignored.map((r) => `<div class="row"><span>${esc(r.name)} <span class="muted">${esc(r.scope)} ${esc(r.kind)}</span></span><span class="pill ${r.status}">${r.status === 'never' ? '0 calls' : r.invocations + ' calls'}</span></div>`).join('')
    : '<div class="muted">none</div>';

  const top = coverage.filter((r) => r.invocations > 0).sort((a, b) => b.invocations - a.invocations).slice(0, 15);
  document.getElementById('topused').innerHTML = top.length
    ? top.map((r) => `<div class="row"><span>${esc(r.name)} <span class="muted">${esc(r.kind)}</span></span><span class="muted">${r.invocations}</span></div>`).join('')
    : '<div class="muted">none</div>';

  document.getElementById('suggestions').innerHTML = suggestions.length
    ? suggestions.map((o) => `<details class="sug"><summary>${esc(o.targetName)} — ${esc(o.status)} · confidence ${esc(o.pkg.overallConfidence)}</summary>${o.pkg.verdictReasoning ? `<div class="muted" style="margin:6px 0">${esc(o.pkg.verdictReasoning)}</div>` : ''}${o.pkg.facets.map((f) => `<div class="facet"><span class="k">${esc(f.facet)}</span> <span class="muted">(${esc(f.confidence)})</span><div>${esc(f.diagnosis)}</div><div class="s">${esc(f.suggestion)}</div></div>`).join('')}</details>`).join('')
    : '<div class="muted">No suggestions yet — run <code>skill-radar analyze</code>.</div>';
}
load().catch((e) => { document.getElementById('sub').textContent = 'error: ' + e.message; });
</script>
</body>
</html>
```

- [ ] **Step 2: Write the failing test** (append to `test/server/server.test.ts`)

```ts
describe('static dashboard', () => {
  test('GET / serves the dashboard HTML', async () => {
    const app = createApp(seed(), OPTS);
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain('skill-radar');
    expect(html).toContain('/api/stats'); // the page fetches the API
    expect(html).toContain('id="suggestions"');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/server/server.test.ts`
Expected: the new test FAILS (no `/` route yet).

- [ ] **Step 4: Add the static route to `src/server/server.ts`**

Add imports at the top:
```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
```
Add a module-level constant (after imports) that loads the page once:
```ts
const DASHBOARD_HTML = readFileSync(fileURLToPath(new URL('./dashboard.html', import.meta.url)), 'utf8');
```
And add the route inside `createApp`, before `return app;`:
```ts
  app.get('/', (c) => c.html(DASHBOARD_HTML));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/server/server.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/dashboard.html src/server/server.ts test/server/server.test.ts
git commit -m "feat(server): serve self-contained dashboard page at /"
```

---

## Task 4: `startServer` + `serve` CLI command

**Files:**
- Modify: `src/server/server.ts`, `src/cli.ts`
- Test: (covered by the real smoke test in Step 5; `startServer` is thin I/O over the tested `createApp`)

- [ ] **Step 1: Add `startServer` to `src/server/server.ts`**

Add the import at the top:
```ts
import { serve } from '@hono/node-server';
```
Add at the end of the file:
```ts
export function startServer(db: Db, opts: ServerOptions, port: number): void {
  const app = createApp(db, opts);
  serve({ fetch: app.fetch, port });
}
```

- [ ] **Step 2: Add the `serve` command to `src/cli.ts`**

Add the import near the others:
```ts
import { startServer } from './server/server';
```
Add the command after `suggestions` and before the final parse block (the db stays open for the life of the server, so do NOT wrap in `withDb`):
```ts
program
  .command('serve')
  .description('start the local web dashboard')
  .option('--db <path>', 'database file path')
  .option('--port <n>', 'port', '4319')
  .option('--window <days>', 'window in days', '30')
  .option('--stale <days>', 'underused staleness threshold in days', '14')
  .action((opts) => {
    const port = Number(opts.port);
    const db = openDb(opts.db ?? defaultDbPath());
    startServer(db, { windowDays: Number(opts.window), underusedStaleDays: Number(opts.stale) }, port);
    console.log(`skill-radar dashboard at http://localhost:${port}`);
  });
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: ALL pass (Plan 1 + 2a + 2b + the new server tests).

- [ ] **Step 5: Real end-to-end smoke test**

Run (uses the existing local DB; backgrounds the server, curls it, then kills it):
```bash
npm run radar -- serve --port 4321 & SERVER_PID=$!
sleep 3
echo "--- /api/stats ---"; curl -s http://localhost:4321/api/stats
echo; echo "--- / (first line) ---"; curl -s http://localhost:4321/ | head -1
echo "--- /api/suggestions count ---"; curl -s http://localhost:4321/api/suggestions | head -c 200
kill $SERVER_PID
```
Expected: `/api/stats` returns the coverage summary JSON; `/` returns the HTML doctype; `/api/suggestions` returns the stored packages (if any). Capture the `/api/stats` JSON. If the port is busy, use another.

- [ ] **Step 6: Commit**

```bash
git add src/server/server.ts src/cli.ts
git commit -m "feat(cli): serve command for the local dashboard"
```

---

## Self-Review

**Spec coverage (Plan 3):**
- Local web dashboard (coverage % bar, ignored/underused panel, leaderboard, optimization feed) → `dashboard.html` (Task 3), backed by routes (Task 2) ✓
- Reads `coverage` + `optimizations` from SQLite → `statsPayload`/`computeCoverage`/`readOptimizations` ✓
- Local-first, no telemetry → localhost-only, no external calls ✓
- `serve` CLI → Task 4 ✓
- Deliberately NOT in scope: write actions, websockets, React/build step (documented deviation) ✓

**Placeholder scan:** all steps contain complete code. No TODO/TBD.

**Type consistency:** `ServerOptions` (with injectable `now`) defined in server.ts; `StatsPayload` in api.ts. Routes reuse `computeCoverage` (CoverageOptions), `readOptimizations` (StoredOptimization), `statsPayload`. The injectable clock keeps route tests deterministic regardless of real run date.

**Determinism:** tests pass `now: () => new Date('2026-06-23...')` so seeded 2026-06-22 events are always inside the window — tests do not depend on the wall-clock date.

**Cross-task ordering:** Task 1 (deps+stats) → 2 (routes, needs stats) → 3 (static route + html) → 4 (startServer+CLI, needs createApp). The `/` route is added in Task 3 (after dashboard.html exists) so `createApp` never reads a missing file. Correct.

---

## Execution Handoff

After Plan 3 lands, `skill-radar serve` shows the full picture in a browser. Plan 4 packages everything as a Claude Code plugin (hooks for real-time capture + `/skill-radar:analyze` slash command + an analyst subagent), so the loop runs inside Claude Code itself.
