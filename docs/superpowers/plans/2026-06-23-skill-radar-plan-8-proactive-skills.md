# skill-radar Plan 8 — Proactive Agent Skills

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude Code invoke skill-radar **proactively** (on intent, not only via an explicit slash command) — mirroring understand-anything. Add bundled plugin **skills** (`skills/<name>/SKILL.md`) whose descriptions trigger the Skill tool when the user asks about their skill usage or wants the dashboard; retire the now-redundant manual `commands/`.

**Architecture:** Claude Code surfaces a plugin's `skills/<name>/SKILL.md` (frontmatter `name` + `description` + optional `argument-hint`) to itself and invokes them via the Skill tool when the description matches the user's intent (they also work as `/<plugin>:<name>`). This is exactly how understand-anything's `understand` / `understand-dashboard` skills work. skill-radar's plugin currently only has `commands/` (manual-only), so adding `skills/` is the whole change. The skill bodies just drive the existing CLI (`report` / `serve`, optionally `analyze`).

**Tech Stack:** unchanged — this is plugin markdown + a test. No code, no new deps.

**Grounded facts (verified from installed understand-anything plugin):** bundled skills live at `skills/<name>/SKILL.md` with frontmatter `name`, `description`, `argument-hint`; the body uses `## Instructions`. `understand-dashboard`'s description is "Launch the interactive web dashboard to visualize a codebase's knowledge graph". `plugin.json` does not list skills — they're auto-discovered from `skills/`.

**Prerequisite:** Plan 7 merged into `main` (full CLI incl. `serve`, `report`, `analyze`, `suggestions`; plugin with `commands/`, `agents/`, `hooks/`).

**Design notes:**
- **Proactive but safe/cheap by default.** The main skill runs only the **read-only** `ingest`/`scan`/`report` (no token cost). It runs `analyze` (which spends tokens via headless Claude Code) **only when the user explicitly asks** for the why/fixes — the skill body instructs "ask first, don't auto-run analyze". The dashboard skill runs `serve` (no token cost). `apply` is **not** a proactive skill (it writes files) — it stays a deliberate, user-driven action.
- **Tightly-scoped descriptions** so the skill fires on clear intent (ignored/underused skills, skill-usage questions, "open my skill dashboard") — not during unrelated work.
- **Retire `commands/`** (report/analyze/dashboard) — the skills supersede them (single source of truth, matches understand-anything which ships skills-only). `agents/` (analyst subagent) and `hooks/` are unchanged.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `plugin/skills/skill-radar/SKILL.md` | create | proactive analysis skill (coverage + ignored; opt-in analyze) |
| `plugin/skills/skill-radar-dashboard/SKILL.md` | create | launch the local dashboard (like understand-dashboard) |
| `plugin/commands/{report,analyze,dashboard}.md` | delete | superseded by the skills |
| `test/plugin/plugin.test.ts` | modify | validate skills; drop the commands block |
| `README.md` | modify | plugin section: commands → skills |

---

## Task 1: Add the bundled skills

**Files:**
- Create: `plugin/skills/skill-radar/SKILL.md`, `plugin/skills/skill-radar-dashboard/SKILL.md`
- Test: `test/plugin/plugin.test.ts` (add a `skills` block)

- [ ] **Step 1: Add the failing test** (append to `test/plugin/plugin.test.ts`)

```ts
describe('skills (proactive)', () => {
  test.each(['skill-radar', 'skill-radar-dashboard'])('%s/SKILL.md has matching name + description frontmatter', (name) => {
    const md = read(`skills/${name}/SKILL.md`);
    expect(md.startsWith('---')).toBe(true);
    expect(md).toMatch(new RegExp(`\\nname:\\s*${name}\\b`));
    expect(md).toMatch(/\ndescription:\s*\S+/);
  });

  test('the main skill description is scoped to installed-capability usage (avoids over-broad proactive triggers)', () => {
    const md = read('skills/skill-radar/SKILL.md');
    const desc = md.match(/\ndescription:\s*(.+)/)![1].toLowerCase();
    expect(desc).toMatch(/ignored|underused|never/);
    expect(desc).toContain('installed'); // anchors triggers to installed capabilities, not generic "which tool"
  });

  test('the dashboard skill mentions launching the dashboard', () => {
    const md = read('skills/skill-radar-dashboard/SKILL.md').toLowerCase();
    expect(md).toMatch(/dashboard/);
    expect(md).toMatch(/serve/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/plugin/plugin.test.ts`
Expected: the new `skills` tests FAIL (files don't exist).

- [ ] **Step 3: Create `plugin/skills/skill-radar/SKILL.md`**

```markdown
---
name: skill-radar
description: Surface which installed Claude Code skills, subagents, and MCP servers you have but rarely or never use (and why), with AI-suggested fixes. Use when the user asks which of their installed skills/subagents/MCP servers are ignored or underused, why an installed skill never fires, or how to improve their installed skills' descriptions/triggers.
argument-hint: [skill-name]
---

# skill-radar

Report which installed capabilities are ignored or underused — and, when asked, why they never fire and how to fix
them. Reads only local usage data; nothing is sent to third parties.

## Instructions

By default, run ONLY the read-only steps (ingest / scan / report). Never run `analyze` (spends tokens) or `apply`
(writes files) unless the user explicitly asks.

1. Refresh + report (cheap, read-only — no token cost):
   - If the `skill-radar` CLI is on PATH: `skill-radar ingest && skill-radar scan && skill-radar report`
   - Otherwise, from the skill-radar repo: `npm run radar -- ingest && npm run radar -- scan && npm run radar -- report`
2. Summarize for the user: overall capability-coverage %, the most notable **ignored** capabilities (0 invocations),
   and any **underused** ones. Keep it tight — surface the signal, not the whole list.
3. **Only if the user wants the "why + fixes"** (AI optimization — this spends tokens via headless Claude Code):
   run `skill-radar analyze --limit 5` then `skill-radar suggestions`, and present the optimization packages
   (per skill: why it's ignored + the suggested description/trigger rewrite). Do **not** run `analyze` automatically —
   ask first.
4. To open the visual dashboard, use the `skill-radar-dashboard` skill (or run `skill-radar serve`).
5. To apply a suggestion to a skill's SKILL.md, that's a deliberate write — run `skill-radar apply <skill>` (dry-run)
   and let the user confirm `--write`. Never apply automatically.
6. If `$ARGUMENTS` names a skill, focus the report/suggestions on it.
```

- [ ] **Step 4: Create `plugin/skills/skill-radar-dashboard/SKILL.md`**

```markdown
---
name: skill-radar-dashboard
description: Launch the local skill-radar web dashboard — capability coverage, the ignored/underused panel, the top-used leaderboard, and the AI optimization-suggestion feed. Use when the user wants to see or open their skill-usage dashboard.
argument-hint: [port]
---

# skill-radar-dashboard

Start the local skill-radar dashboard (localhost only).

## Instructions

1. Make sure the data is current: `skill-radar ingest && skill-radar scan`
   (or `npm run radar -- ingest && npm run radar -- scan` from the repo). Skip if it was just run.
2. Start the dashboard: `skill-radar serve` (or `npm run radar -- serve`). If `$ARGUMENTS` contains a port, pass
   `--port <port>`.
3. Tell the user the URL (default http://localhost:4319). It binds to localhost only and runs until they stop it
   (Ctrl-C).
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/plugin/plugin.test.ts`
Expected: PASS (skills block + the still-present manifest/commands/agent/hooks blocks).

- [ ] **Step 6: Commit**

```bash
git add plugin/skills test/plugin/plugin.test.ts
git commit -m "feat(plugin): proactive skill-radar + skill-radar-dashboard skills"
```

---

## Task 2: Retire the redundant commands + docs

**Files:**
- Delete: `plugin/commands/report.md`, `plugin/commands/analyze.md`, `plugin/commands/dashboard.md`
- Modify: `test/plugin/plugin.test.ts` (drop the `commands` block), `README.md`

- [ ] **Step 1: Delete the command files**

```bash
git rm plugin/commands/report.md plugin/commands/analyze.md plugin/commands/dashboard.md
```
(The `plugin/commands/` directory becomes empty and is removed by git.)

- [ ] **Step 2: Remove the `commands` test block** from `test/plugin/plugin.test.ts`

Delete the entire `describe('commands', () => { ... })` block (the one that reads `commands/${name}.md`). Leave the manifest, skills, analyst, and hooks blocks intact.

- [ ] **Step 3: Run the plugin test**

Run: `npx vitest run test/plugin/plugin.test.ts`
Expected: PASS (no more `commands` references; skills + others pass).

- [ ] **Step 4: Update `README.md`** — in the Claude Code plugin "What you get" section, replace the three `/skill-radar:report|analyze|dashboard` command bullets with the proactive-skill description. Use these bullets (raw markdown):

``- **`skill-radar` skill** — ask things like "which skills am I ignoring?" or "optimize my skill usage" and Claude Code runs the coverage report proactively (and, if you ask, the AI optimization pass).``
``- **`skill-radar-dashboard` skill** — "open my skill dashboard" launches the local web dashboard.``

Keep the analyst-subagent and hook bullets. **Also (required):** the plugin section intro currently reads "slash commands, an analyst subagent, and a SessionStart hook" — change it to "skills, an analyst subagent, and hooks" (the `commands/` dir is removed, so the old wording is stale). Grep the README afterward for any remaining "slash command" / "`/skill-radar:`" references and fix them.

- [ ] **Step 5: Real smoke test** (validate the plugin tree + that nothing references the deleted commands)

```bash
echo "--- plugin tree ---"; find plugin -type f | sort
echo "--- all plugin JSON + skill frontmatter parse ---"
node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('plugin/.claude-plugin/plugin.json','utf8')); JSON.parse(fs.readFileSync('plugin/hooks/hooks.json','utf8')); for (const s of ['skill-radar','skill-radar-dashboard']) { const m=fs.readFileSync('plugin/skills/'+s+'/SKILL.md','utf8'); if(!m.startsWith('---')) throw new Error('bad frontmatter: '+s); } console.log('plugin OK');"
echo "--- no lingering refs to commands/ in tests/src ---"; grep -rn "commands/" test src 2>/dev/null || echo "(none)"
```
Expected: tree shows `skills/` (no `commands/`), `plugin OK`, and no `commands/` references. Report output.

- [ ] **Step 6: Typecheck + full suite**

Run: `npm run typecheck` (0) and `npm test` (ALL pass).

- [ ] **Step 7: Commit**

```bash
git add plugin test/plugin/plugin.test.ts README.md
git commit -m "refactor(plugin): retire manual commands in favor of proactive skills + docs"
```

---

## Self-Review

**Spec coverage (Plan 8):**
- Proactive invocation (the ask) → bundled `skills/` with intent-scoped descriptions (Task 1) ✓
- Dashboard skill like understand-dashboard → `skill-radar-dashboard` (Task 1) ✓
- Mirror understand-anything's skills-only layout → retire `commands/` (Task 2) ✓
- Safe/cheap proactive default → report/serve only; `analyze` opt-in; `apply` never auto (skill bodies) ✓

**Placeholder scan:** complete SKILL.md content. No TODO/TBD.

**Format fidelity:** SKILL.md frontmatter (`name`/`description`/`argument-hint`) + `## Instructions` body matches the verified understand-anything structure, so Claude Code loads + surfaces them. Names match the test's `name:` assertion.

**No regressions:** no `src` code changes; the only test change is swapping the `commands` block for the `skills` block. `grep commands/` confirms nothing else references the deleted files.

**Cross-task ordering:** Task 1 (add skills + skills test) → Task 2 (remove commands + drop commands test). Correct (skills exist before commands are removed; suite stays green throughout).

---

## Execution Handoff

After Plan 8, Claude Code proactively runs skill-radar when you ask about skill usage or want the dashboard — no exact command needed — exactly like understand-anything. Remaining future work: npm publish, active-eval benchmark, Codex adapter.
