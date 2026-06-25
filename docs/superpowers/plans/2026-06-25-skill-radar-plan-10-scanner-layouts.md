# skill-radar Plan 10 — Real-world plugin layout coverage (symlinks, nested agents, manifest phantoms)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three inventory-scanner gaps (`src/inventory/scan.ts`) found by auditing the live machine. They make installed capabilities silently absent from the inventory, and because coverage + missed-candidates are **inventory-gated** (they iterate inventory rows), an absent capability is OMITTED from every surface — not shown as `0`. The headline symptom: the user genuinely used `academic-research-skills` 11 times (kind=`skill` events in the DB, 2026-05-27..06-19), but it never appears in `report` because its skill dirs are symlinks the scanner drops.

**The three bugs (all verified on disk 2026-06-25):**
1. **Symlinked skill/agent dirs dropped.** `dirNames()` keeps only `Dirent.isDirectory()`, which is **false** for a symlink (it's `isSymbolicLink()`). `academic-research-skills` ships `skills/<name> -> ../<name>` symlinks (academic-paper, academic-paper-reviewer, academic-pipeline, deep-research), so all 4 ARS skills are invisible → ARS absent from inventory → its 11 events credited to nothing.
2. **Nested `<version>/<component>/agents/*.md` not scanned.** `scanPlugins` reads only `<version>/agents/`. Misses `academic-research-skills` (37 agents under academic-paper/agents, deep-research/agents, …, shared/agents, plus a root agents/) and `engineering-skills` (playwright-pro/agents, self-improving-agent/agents).
3. **Flat-root `SKILL.md` phantom (Plan 9 regression).** `scanFlatAgents` treats any flat `<version>/*.md` with name+description as an agent — including a plugin's `<version>/SKILL.md` manifest (`name: "engineering-skills"`, `name: "ra-qm-skills"`), producing phantom agents `engineering-skills:engineering-skills` and `ra-qm-skills:ra-qm-skills`.

**Architecture / design:**
- **Fix 1 — `dirNames()` follows symlinks to dirs.** Include an entry if `e.isDirectory()` OR (`e.isSymbolicLink()` AND `statSync(full).isDirectory()`), guarding `statSync` against dangling symlinks (catch → false). Used by `scanSkills` (so symlinked skill dirs resolve) and the marketplace/plugin/version walk.
- **Fix 2 — recursive `agents/` discovery for plugins.** Add `findAgentsDirs(base)` that walks **real subdirectories only** (skip symlinks → no cycles, no double-scan of the symlinked `skills/<name>`), capped depth, skipping `node_modules`/`.git`, collecting every dir literally named `agents`. In `scanPlugins`, replace the single `scanAgents(base)` with scanning each discovered `agents/` dir. Extract `scanAgentDir(dir, scope, qualifier)` (the per-dir `*.md` → agent logic) shared with `scanAgents`. Existing `scanInventory` dedup `(kind,name,scope)` collapses an agent that appears both at a root `agents/` and a nested one.
- **Fix 3 — flat-scan only "pure flat" plugins.** Call `scanFlatAgents(base)` only when the version dir has **no** `SKILL.md` and **no** `skills/` dir (i.e. a flat-agent plugin like voltagent; structured plugins keep their agents in `agents/` dirs found by Fix 2). Keep the existing doc-basename denylist as defense in depth.

**Tech Stack:** unchanged. New `node:fs` import: `statSync`.

**Scope / non-goals:**
- This is a **scanner/inventory** fix. It does NOT touch coverage windowing or the command↔skill name-matching. Specifically, the ARS events named `academic-research-skills:ars-lit-review`/`ars-citation-check`/`ars-outline` reference **slash commands** (commands/ars-*.md), not skill dirs, so they remain uncredited after this plan — only the 4 real skill dirs (deep-research, academic-paper, academic-paper-reviewer, academic-pipeline) enter inventory and pick up their matching `skill` events. Report the actual recovered count; do not overclaim "all 11".
- User/project scope keeps the targeted `scanAgents(<dir>/agents)` (no recursive walk of `~/.claude`, which holds skills/, projects/, etc.).

**Prerequisite:** Plan 9 branch (`scanFlatAgents` exists). This plan stacks on `plan-9-flat-plugin-agents`; PR bases on it (auto-retargets to `main` when Plan 9 merges).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/inventory/scan.ts` | modify | `dirNames` symlink-follow; `findAgentsDirs` + `scanAgentDir`; recursive agents in `scanPlugins`; pure-flat guard on `scanFlatAgents` |
| `README.md` | modify | note symlinked/nested layouts are inventoried |
| `test/inventory/scan.test.ts` | modify | symlinked skill dir; nested component agents; SKILL.md phantom excluded; pure-flat voltagent still works |

---

## Task 1: Symlinked skill dirs (Fix 1)

**Behavior:** a plugin whose `skills/<name>` is a symlink to a sibling skill dir is inventoried as a skill.

- [ ] RED: fixture — `cache/mp/ars/1.0.0/academic-paper/SKILL.md` (real) + `cache/mp/ars/1.0.0/skills/academic-paper` symlink → `../academic-paper`. Assert `find('skill','ars:academic-paper')` matches `{scope:'plugin'}`.
- [ ] GREEN: `dirNames` includes symlinks resolving to dirs (statSync, guarded).

## Task 2: Nested component agents (Fix 2)

**Behavior:** agents under `<version>/<component>/agents/*.md` are inventoried as `<plugin>:<name>`; a top-level `<version>/agents/` still works; no double-count.

- [ ] RED: fixture — `cache/mp/ars/1.0.0/academic-paper/agents/peer_reviewer.md` (name+desc) and a top-level `cache/mp/ars/1.0.0/agents/intake.md`. Assert both `ars:peer_reviewer` and `ars:intake` present; and a name duplicated at root+nested yields exactly one item.
- [ ] GREEN: `findAgentsDirs` (real dirs only, capped depth) + `scanAgentDir`; wire into `scanPlugins`.

## Task 3: SKILL.md phantom guard + pure-flat preserved (Fix 3)

**Behavior:** a structured plugin's `<version>/SKILL.md` is NOT inventoried as an agent; a pure-flat plugin (voltagent-style) still yields its flat agents.

- [ ] RED: fixture — `cache/mp/eng/1.0.0/SKILL.md` (name: eng, description) + `cache/mp/eng/1.0.0/playwright-pro/agents/test-architect.md`. Assert NO `eng:eng` item, but `eng:test-architect` present (via Fix 2). Keep the existing voltagent flat test green.
- [ ] GREEN: guard `scanFlatAgents(base)` behind `!existsSync(SKILL.md) && !existsSync(skills/)`.

## Task 4: Refactor + docs + real-data verify

- [ ] Extract/share `scanAgentDir`; tidy.
- [ ] README: symlinked + nested plugin layouts inventoried.
- [ ] Full suite green (`npm test`), typecheck.
- [ ] Real data: `npm run radar -- scan` then confirm `inventory` now has `academic-research-skills:*` skills (4) + agents (~37), the 2 phantoms gone, voltagent still 24. Run `report` and record how many of the 11 ARS events get credited (expected: the deep-research/academic-paper/academic-paper-reviewer ones).
