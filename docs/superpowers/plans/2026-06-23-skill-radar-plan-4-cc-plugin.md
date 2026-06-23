# skill-radar Plan 4 — Claude Code Plugin Packaging

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package skill-radar as a Claude Code plugin so the loop runs inside Claude Code: a `skill-radar` CLI bin, slash commands (`/skill-radar:report|analyze|dashboard`), a `skill-radar-analyst` subagent, and a SessionStart hook that keeps usage data fresh automatically.

**Architecture:** A tiny buildless `bin/skill-radar.mjs` shim (re-execs `node --import tsx src/cli.ts`) makes a real `skill-radar` command available after `npm link` — with no compile step and no change to the tsx-based dev flow. The `plugin/` directory is a standard Claude Code plugin: `.claude-plugin/plugin.json` manifest, `commands/*.md` prompt templates that drive the CLI, an `agents/skill-radar-analyst.md` subagent, and `hooks/hooks.json` with a guarded, async SessionStart hook that runs `skill-radar ingest && scan` (incremental, fast) — a no-op if `skill-radar` isn't installed, so it never errors.

**Tech Stack:** unchanged (TypeScript, tsx, better-sqlite3, hono, commander, vitest). No new deps. The plugin is config + markdown; the only new code is the bin shim.

**Grounded plugin facts (verified from installed plugins on disk):**
- `.claude-plugin/plugin.json`: `name`, `description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`.
- `commands/<name>.md`: `--- description: ... ---` frontmatter + prompt body → invoked as `/<plugin>:<name>`.
- `agents/<name>.md`: `--- name / description / model ---` frontmatter + body.
- `hooks/hooks.json`: `{ "hooks": { "SessionStart": [ { "matcher": "startup|clear|compact", "hooks": [ { "type": "command", "shell": "bash", "command": "...", "async": true, "timeout": N } ] } ] } }`; `${CLAUDE_PLUGIN_ROOT}` is available; a hook may print `{"continue":true,"suppressOutput":true}`.
- `node --import tsx src/cli.ts <args>` runs the CLI correctly (tsx 4.22.4) — verified.

**Prerequisite:** Plan 3 merged into `main` (the full CLI: `init/ingest/scan/report/candidates/analyze/suggestions/serve`).

**Scope & honesty note:** The plugin drives the `skill-radar` CLI, which must be on PATH (via `npm link` from the cloned repo) because skill-radar is buildless TS with a native dep (`better-sqlite3`) and is not published to npm. The SessionStart hook is **guarded** (`command -v skill-radar` → no-op if absent), so installing the plugin without linking the CLI is harmless. Real-time per-tool-call capture (a PostToolUse `--hook` ingest mode) is **deferred** — the JSONL transcripts already capture everything, and a SessionStart incremental refresh keeps data current with zero new ingest code. README documents the setup honestly.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `bin/skill-radar.mjs` | create | portable CLI shim (`node --import tsx src/cli.ts`) |
| `package.json` | modify | add `bin` field |
| `plugin/.claude-plugin/plugin.json` | create | plugin manifest |
| `plugin/commands/{report,analyze,dashboard}.md` | create | slash commands |
| `plugin/agents/skill-radar-analyst.md` | create | analyst subagent |
| `plugin/hooks/hooks.json` | create | SessionStart auto-refresh hook |
| `README.md` | modify | "Claude Code plugin" section |
| `test/bin/cli-bin.test.ts`, `test/plugin/plugin.test.ts` | create | bin smoke + plugin-structure lint |

---

## Task 1: Portable `skill-radar` CLI bin

**Files:**
- Create: `bin/skill-radar.mjs`
- Modify: `package.json`
- Test: `test/bin/cli-bin.test.ts`

- [ ] **Step 1: Write the failing test**

`test/bin/cli-bin.test.ts`:
```ts
import { describe, test, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const bin = fileURLToPath(new URL('../../bin/skill-radar.mjs', import.meta.url));
const TMP_DB = '/tmp/sr-bin-test.sqlite';
afterAll(() => rmSync(TMP_DB, { force: true }));

function run(args: string[]) {
  // run from a temp cwd (NOT the repo root) so the npm-link-on-PATH reality is exercised:
  // the shim must resolve tsx + the CLI relative to itself, not the cwd.
  return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', cwd: tmpdir() });
}

describe('skill-radar bin shim', () => {
  test('--version prints the CLI version', () => {
    const r = run(['--version']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('0.1.0');
  });

  test('forwards a subcommand (report) against an isolated db', () => {
    const r = run(['report', '--db', TMP_DB]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('coverage report');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/bin/cli-bin.test.ts`
Expected: FAIL (bin file does not exist → spawn ENOENT / non-zero).

- [ ] **Step 3: Write `bin/skill-radar.mjs`**

```js
#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Buildless launcher: run the TypeScript CLI directly via tsx, forwarding args + stdio.
// Resolve tsx + the CLI relative to THIS file (a bare 'tsx' specifier on --import would resolve
// against the cwd, which breaks when `skill-radar` is invoked from any dir other than the repo root).
const require = createRequire(import.meta.url);
const tsx = pathToFileURL(require.resolve('tsx')).href;
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const result = spawnSync(process.execPath, ['--import', tsx, cli, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
```

- [ ] **Step 4: Add the `bin` field to `package.json`** (top level, e.g. after `"license"`)

```json
  "bin": {
    "skill-radar": "./bin/skill-radar.mjs"
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/bin/cli-bin.test.ts`
Expected: PASS (2 tests). (The shim re-execs `node --import tsx src/cli.ts`; verified working with tsx 4.22.4.)

- [ ] **Step 6: Mark the shim executable + commit** (the npm-link'd `skill-radar` runs the file via its shebang, which needs the +x bit; git tracks the mode)

```bash
chmod +x bin/skill-radar.mjs
git add bin/skill-radar.mjs package.json test/bin/cli-bin.test.ts
git commit -m "feat(bin): portable skill-radar CLI shim (buildless, via tsx)"
```

---

## Task 2: Plugin manifest, commands, and analyst subagent

**Files:**
- Create: `plugin/.claude-plugin/plugin.json`, `plugin/commands/report.md`, `plugin/commands/analyze.md`, `plugin/commands/dashboard.md`, `plugin/agents/skill-radar-analyst.md`
- Test: `test/plugin/plugin.test.ts`

- [ ] **Step 1: Write the failing test**

`test/plugin/plugin.test.ts`:
```ts
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../plugin/', import.meta.url));
const read = (p: string) => readFileSync(root + p, 'utf8');

describe('plugin manifest', () => {
  test('plugin.json is valid and well-formed', () => {
    const m = JSON.parse(read('.claude-plugin/plugin.json'));
    expect(m.name).toBe('skill-radar');
    expect(typeof m.description).toBe('string');
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.license).toBe('MIT');
  });
});

describe('commands', () => {
  test.each(['report', 'analyze', 'dashboard'])('%s.md has a description frontmatter', (name) => {
    const md = read(`commands/${name}.md`);
    expect(md.startsWith('---')).toBe(true);
    expect(md).toMatch(/\ndescription:\s*\S+/);
  });
});

describe('analyst subagent', () => {
  test('has name + description frontmatter', () => {
    const md = read('agents/skill-radar-analyst.md');
    expect(md).toMatch(/\nname:\s*skill-radar-analyst/);
    expect(md).toMatch(/\ndescription:\s*\S+/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/plugin/plugin.test.ts`
Expected: FAIL (files do not exist).

- [ ] **Step 3: Create `plugin/.claude-plugin/plugin.json`**

```json
{
  "name": "skill-radar",
  "description": "Surface the skills, subagents, and MCP servers your agent ignores — and get AI-generated routing fixes. Local-first.",
  "version": "0.1.0",
  "author": { "name": "skill-radar contributors" },
  "homepage": "https://github.com/xjdxx123/skill-radar",
  "repository": "https://github.com/xjdxx123/skill-radar",
  "license": "MIT",
  "keywords": ["skills", "analytics", "observability", "optimization", "claude-code"]
}
```

- [ ] **Step 4: Create `plugin/commands/report.md`**

```markdown
---
description: Show skill-radar coverage — which installed skills, subagents, and MCP servers are ignored or underused.
---

Run the skill-radar coverage report:

- If the `skill-radar` CLI is on PATH, run: `skill-radar report`
- Otherwise run from the skill-radar repo: `npm run radar -- report`

Then summarize for the user: the overall capability-coverage %, the most notable **ignored** capabilities (0 invocations), and any **underused** ones worth revisiting. Keep it concise — surface the signal, not the whole list.
```

- [ ] **Step 5: Create `plugin/commands/analyze.md`**

```markdown
---
description: Run skill-radar's AI optimization pass over ignored skills and present the suggestions.
---

Refresh data, then run the AI optimization loop:

1. `skill-radar ingest` then `skill-radar scan` (refresh usage + inventory)
2. `skill-radar analyze --limit 5` — a headless Claude Code pass that diagnoses why ignored skills aren't firing and drafts description/trigger/non-goal rewrites. (This incurs token cost.)
3. `skill-radar suggestions`

Present the top optimization packages: for each skill, why it's being ignored and the concrete suggested rewrite. Offer to apply a rewrite to the skill's SKILL.md if the user wants (skill-radar does not auto-apply).
```

- [ ] **Step 6: Create `plugin/commands/dashboard.md`**

```markdown
---
description: Launch the local skill-radar web dashboard.
---

Start the local dashboard: run `skill-radar serve` (or `npm run radar -- serve` from the repo).

It binds to http://localhost:4319 (local-only) and shows coverage, the ignored/underused panel, the top-used leaderboard, and the AI optimization-suggestion feed. Tell the user the URL; the server runs until they stop it (Ctrl-C).
```

- [ ] **Step 7: Create `plugin/agents/skill-radar-analyst.md`**

```markdown
---
name: skill-radar-analyst
description: Diagnoses why a Claude Code skill/subagent is being ignored and proposes concrete routing fixes (description, triggers, non-goals, disambiguation). Use when optimizing an underused capability.
model: inherit
---

# skill-radar analyst

You optimize how Claude Code selects its installed Skills. A skill is invoked when the model judges, from its
frontmatter `description`, that it applies. Your job: given a skill that is available but ignored, diagnose why its
wording fails to get it selected, and propose concrete fixes — conservatively, only where there is a real improvement.

## Inputs you gather
- The target skill's `SKILL.md` (read it).
- Prompts where it seemingly should have fired but did not (run `skill-radar candidates` and read the entries for this skill, or read the report).
- Sibling skills it might collide with.

## Output (per skill)
A short, structured recommendation covering the facets that need work:
- **summary** — one-line capability statement.
- **description** — the frontmatter routing line, rewritten for clarity + trigger coverage.
- **triggers** — "use when" phrases mined from the real prompts.
- **non-goals** — "do NOT use when" boundaries to prevent overlap suppression.
- **disambiguation** — how to choose this vs the colliding sibling skills.
- **name** — only if a rename reduces collision.

For each facet: state the diagnosis (why current wording fails) and the concrete suggested replacement. Do not invent
prompts or evidence; ground every claim in the skill's actual definition and the user's actual prompts. Never apply
changes without the user's confirmation.
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run test/plugin/plugin.test.ts`
Expected: PASS (manifest + 3 command + agent tests).

- [ ] **Step 9: Commit**

```bash
git add plugin/.claude-plugin/plugin.json plugin/commands plugin/agents test/plugin/plugin.test.ts
git commit -m "feat(plugin): manifest, slash commands, analyst subagent"
```

---

## Task 3: SessionStart auto-refresh hook + README + smoke

**Files:**
- Create: `plugin/hooks/hooks.json`
- Modify: `test/plugin/plugin.test.ts` (add a case), `README.md`

- [ ] **Step 1: Add the failing test** (append to `test/plugin/plugin.test.ts`)

```ts
describe('hooks', () => {
  test('hooks.json defines a guarded SessionStart command', () => {
    const h = JSON.parse(read('hooks/hooks.json'));
    const sessionStart = h.hooks?.SessionStart;
    expect(Array.isArray(sessionStart)).toBe(true);
    const cmd = sessionStart[0].hooks[0];
    expect(cmd.type).toBe('command');
    expect(cmd.command).toContain('command -v skill-radar'); // guarded: no-op if not installed
    expect(cmd.command).toContain('skill-radar ingest');
    expect(cmd.async).toBe(true); // must not block session startup
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/plugin/plugin.test.ts`
Expected: the new test FAILS (no hooks.json).

- [ ] **Step 3: Create `plugin/hooks/hooks.json`**

```json
{
  "description": "skill-radar: refresh usage data at session start (no-op if the skill-radar CLI is not installed)",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear",
        "hooks": [
          {
            "type": "command",
            "shell": "bash",
            "command": "export PATH=\"$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH\"; if command -v skill-radar >/dev/null 2>&1; then skill-radar ingest >/dev/null 2>&1; skill-radar scan >/dev/null 2>&1; fi; echo '{\"continue\":true,\"suppressOutput\":true}'",
            "async": true,
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/plugin/plugin.test.ts`
Expected: PASS (all plugin tests incl. the hook case).

- [ ] **Step 5: Add a "Claude Code plugin" section to `README.md`** (after the Usage section)

Append the section below to `README.md`. The `~~~markdown` wrapper is **presentation only — do NOT copy the `~~~markdown`/`~~~` wrapper lines**; append only the inner content (from `## Claude Code plugin` onward), preserving the inner ` ```bash ` fence verbatim:

~~~markdown
## Claude Code plugin

skill-radar ships as a Claude Code plugin (`plugin/`): slash commands, an analyst subagent, and a SessionStart hook
that keeps usage data fresh automatically.

### Install

```bash
git clone https://github.com/xjdxx123/skill-radar && cd skill-radar
npm install
npm link   # puts the `skill-radar` command on your PATH (used by the plugin's commands + hook)
```

Then add the plugin to Claude Code by pointing it at this repo's `plugin/` directory (e.g. via a local marketplace
entry). The SessionStart hook is **guarded** — if `skill-radar` is not on your PATH it is a silent no-op, so
installing the plugin without `npm link` does no harm.

### What you get

- **`/skill-radar:report`** — coverage summary (ignored / underused / top-used).
- **`/skill-radar:analyze`** — headless AI optimization pass + suggestions.
- **`/skill-radar:dashboard`** — launch the local web dashboard.
- **`skill-radar-analyst`** subagent — diagnoses why a skill is ignored and proposes routing fixes.
- **SessionStart hook** — runs `skill-radar ingest && scan` (incremental, async) so your data stays current.
~~~

- [ ] **Step 6: Real smoke test**

Run (verifies the bin works and every plugin JSON/markdown file is well-formed):
```bash
node bin/skill-radar.mjs --version
node -e "JSON.parse(require('fs').readFileSync('plugin/.claude-plugin/plugin.json','utf8')); JSON.parse(require('fs').readFileSync('plugin/hooks/hooks.json','utf8')); console.log('plugin json OK')"
ls plugin/commands plugin/agents
```
Expected: prints `0.1.0`, then `plugin json OK`, then the command/agent files. Report the output.

- [ ] **Step 7: Typecheck + full suite**

Run: `npm run typecheck` (0) and `npm test` (ALL pass — everything + the new bin/plugin tests).

- [ ] **Step 8: Commit**

```bash
git add plugin/hooks/hooks.json test/plugin/plugin.test.ts README.md
git commit -m "feat(plugin): SessionStart auto-refresh hook + install docs"
```

---

## Self-Review

**Spec coverage (Plan 4):**
- Claude Code plugin packaging (hooks + slash command + analyst subagent) → Tasks 2–3 ✓
- Portable CLI so the plugin can drive skill-radar → bin shim (Task 1) ✓
- Auto-capture → SessionStart incremental ingest+scan hook (reuses Plan 1 ingester; per-tool real-time deferred & documented) ✓
- Local-first, safe-by-default → guarded hook (no-op without the CLI), no new deps ✓

**Placeholder scan:** all files have complete content. No TODO/TBD.

**Type consistency:** the only TS is the bin shim (no new types). Tests reference real file paths via `import.meta.url`.

**Honesty:** the README states plainly that the plugin needs `npm link` (buildless TS + native dep, not published), and the hook is guarded so it can't error. Real-time per-tool capture is explicitly deferred with the rationale (JSONL already captures everything).

**Cross-task ordering:** Task 1 (bin) → 2 (manifest/commands/agent) → 3 (hook + README + smoke). The plugin lint test grows across Tasks 2 and 3. Correct.

---

## Execution Handoff

After Plan 4 lands, skill-radar is a complete, installable Claude Code plugin: ingest → scan → analyze → serve, with slash commands, an analyst subagent, and automatic refresh. The roadmap (Plans 1–4) is done; remaining deferred items (Codex adapter, active-eval benchmark, auto-apply rewrites, npm publish for zero-setup install) are future enhancements.
