# skill-radar Plan 9 — Flat-layout Plugin Agents

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inventory plugin subagents that ship as **flat `.md` files at the plugin version root** (e.g. `~/.claude/plugins/cache/voltagent-subagents/voltagent-core-dev/1.0.2/frontend-developer.md`), not inside an `agents/` subdirectory. Today `scanPlugins` only reads `<version>/agents/*.md`, so these agents are absent from the inventory (the coverage denominator). They are still *counted* when invoked (events carry `voltagent-core-dev:frontend-developer`), but because they are not in the inventory, the coverage engine cannot list which of them are **never used**. After this change all installed plugin agents enter the denominator, so `report` answers "used vs never-used" for every plugin agent.

**The bug, concretely:** of 24 voltagent agents on disk, skill-radar inventories **0** — so the 19 never-invoked ones are invisible. Root cause: voltagent ships agents flat (no `agents/` subdir), and `scanAgents` only globs `<dir>/agents/*.md`.

**Architecture:** add a `scanFlatAgents(base, scope, qualifier)` helper that reads `*.md` files **directly** in the given dir and treats a file as an agent **iff its frontmatter has both `name` and `description`** (the agent signature). This requirement excludes `README.md`/`CHANGELOG.md`/etc., which have no agent frontmatter. `scanPlugins` calls it on the version root in addition to the existing `scanSkills`/`scanAgents`. The agent name is `${plugin}:${fm.name ?? basename(file)}` — identical to `scanAgents`, so it matches the event name. Dedup in `scanInventory` (by `kind\tname\tscope`) collapses any overlap with an `agents/` subdir, so plugins that use *both* layouts are safe.

**Tech Stack:** unchanged. No new deps.

**Grounded facts (verified on disk 2026-06-25):**
- `voltagent-core-dev/<v>/*.md` and `voltagent-data-ai/<v>/*.md` are flat agent files; there is **no `agents/` subdir**.
- `frontend-developer.md` frontmatter: `name: frontend-developer` + `description: "..."` → qualified name `voltagent-core-dev:frontend-developer`, which exactly matches the recorded `subagent` event name.
- `README.md` at the same level starts with `# Core Development Subagents` — **no frontmatter**, so the `name`+`description` filter excludes it.

**Prerequisite:** `main` (Plans 1–7; `scanInventory`/`scanPlugins` in `src/inventory/scan.ts`).

**Scope / design notes:**
- **Agents only.** Per the CC plugin format, skills always live in `skills/<name>/SKILL.md`; a bare `.md` at the plugin root is an agent. The flat scanner is agent-only.
- **Frontmatter signature is the discriminator.** Require BOTH `name` and `description`. Belt-and-suspenders: also skip common doc basenames (`readme`, `changelog`, `license`, `contributing`, `code_of_conduct`, `security`) case-insensitively, in case a doc file carries unrelated frontmatter.
- **No double counting.** `scanInventory` already dedups by `(kind, name, scope)`; flat + `agents/` collapse to one row.
- **Non-recursive.** Only the version-root `.md` files are scanned (matches how CC resolves these agents); nested dirs are untouched.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/inventory/scan.ts` | modify | add `scanFlatAgents`; call it from `scanPlugins`; share agent-item construction with `scanAgents` |
| `README.md` | modify | note that flat-layout plugin agents are inventoried |
| `test/inventory/scan.test.ts` | modify | flat agent discovered + README excluded + dedup with `agents/` |

---

## Task 1: Discover flat plugin agents (tracer bullet)

**Behavior:** a plugin whose version dir contains `frontend-developer.md` (with `name`+`description` frontmatter) and no `agents/` subdir yields an inventory item `{ kind: 'agent', name: '<plugin>:frontend-developer', scope: 'plugin' }`.

- [ ] RED: extend `test/inventory/scan.test.ts` — add a cache fixture `vm/voltagent-core-dev/1.0.2/frontend-developer.md` (flat, with frontmatter) and assert `find('agent', 'voltagent-core-dev:frontend-developer')` matches `{ scope: 'plugin', description: <text> }`.
- [ ] GREEN: add `scanFlatAgents(dir, scope, qualifier)` reading `mdFiles(dir)`, keep only files whose frontmatter has both `name` and `description` and whose basename is not a known doc name; call it from `scanPlugins` on `base`.

## Task 2: Exclude README / doc files

**Behavior:** a `README.md` (no frontmatter) sitting beside the flat agents is NOT inventoried.

- [ ] RED: add `README.md` to the fixture; assert no inventory item has a name ending `:README` (and none with `kind:'agent'` pointing at the README path).
- [ ] GREEN: already satisfied by the `name`+`description` filter; confirm. Add the doc-basename denylist if needed.

## Task 3: No double-count when both layouts exist

**Behavior:** a plugin that has BOTH `agents/foo.md` and a flat `foo.md` (same frontmatter `name`) yields exactly one item.

- [ ] RED: fixture with both; assert `items.filter(i => i.name === '<plugin>:foo').length === 1`.
- [ ] GREEN: rely on existing `scanInventory` dedup; confirm green.

## Task 4: Refactor + docs

- [ ] Extract shared agent-item construction so `scanAgents` and `scanFlatAgents` don't duplicate it.
- [ ] Update `README.md` inventory section to mention flat-layout plugin agents.
- [ ] Full suite green (`npm test`).

---

## Verification (real data)

After merge-quality green, re-scan the live machine and confirm the 24 voltagent agents enter the inventory and the never-used ones are now reportable:

```
cd ~/coding/skill-radar && npm run radar -- scan
sqlite3 ~/.skill-radar/skill-radar.sqlite \
  "SELECT COUNT(*) FROM inventory WHERE name LIKE 'voltagent%';"   # expect 24
npm run radar -- report   # voltagent agents now appear; 19 flagged never-used
```
