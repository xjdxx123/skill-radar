# skill-radar — Design Spec

- **Date:** 2026-06-23
- **Status:** Approved (brainstorming complete; ready for implementation planning)
- **One-liner:** A capability radar for AI coding agents — surfaces the skills / tools / subagents your agent *ignores*, and runs a headless Claude Code analysis loop to produce a full optimization package (description, triggers, non-goals, disambiguation, naming) so the agent routes to them correctly.

---

## 1. Context & Motivation

A 30-agent competitive scan (40 candidate projects, 22 deep-read) found **no direct match** for this idea. The field (~40 tools) overwhelmingly converges on **token/cost tracking**. No existing tool combines all of:

1. a unified usage model across **skills + tools + subagents**,
2. detection of **ignored / underused** capabilities (the inverse of "most used"),
3. an explanation of **why** something is ignored plus concrete **fixes** to how the agent selects it,
4. **autonomous** operation.

Closest prior art and their gaps:

| Project | Gap vs this design |
|---|---|
| [hardness1020/skills-analytics](https://github.com/hardness1020/claude-skills-management) | Skills only; subagents unverified; stops at a keep/improve/remove score (no *why* / *how to fix*); tiny & stalled |
| [claude-code-templates](https://github.com/davila7/claude-code-templates) (28.2k★) | Surfaces *most-used*, never the inverse; no recommendation engine; on-demand, not autonomous |
| [claude-code-history-viewer](https://github.com/jhlee0409/claude-code-history-viewer) (1.7k★) | "Most Used" leaderboards only; no gap detection; no recommendations |
| [analytics-unused](https://mcpmarket.com/tools/skills/claude-usage-analytics-unused-features) | Binary used/unused; no frequency/scenario; no instrumentation; no fix suggestions |
| [o11y-dev/opentelemetry-hooks](https://github.com/o11y-dev/opentelemetry-hooks) | Best cross-agent *capture* layer, but pure telemetry — no analytics / skills / recommendations |

**Primary commoditization risk:** [anthropics/claude-code #35319](https://github.com/anthropics/claude-code/issues/35319) (open, "High" priority) would ship native per-skill counts and `claude skills --stats` flagging zero-invocation skills. We therefore anchor durable value in the layers native counting will *not* cover: **scenario-aware missed-invocation analysis + a full AI optimization package + (later) cross-agent + active eval** — not raw counts.

---

## 2. Goals & Non-Goals

### Goals (v1 / MVP)
- Passively collect every skill / tool / subagent invocation from Claude Code as the user works normally, **plus full history** (zero-config) — no behavior change required.
- Establish the **denominator**: an inventory of all *available* capabilities.
- Compute **deterministic coverage**: per-capability frequency + an **Ignored / Underused** classification.
- Generate **missed-invocation candidates** (high-recall heuristic) for ignored/underused skills.
- Run a **headless Claude Code analysis loop** that adjudicates candidates and emits a **full optimization package** per target.
- Present everything in a **local web dashboard** (leaderboards, Ignored/Underused panel, optimization feed).

### Non-Goals (explicitly cut — YAGNI)
- **Codex adapter** — interface only in v1; implementation is phase 2.
- **Active eval / benchmark harness** ("drive the agent over a task suite to measure routing coverage") — phase 2.
- **Auto-applying rewrites to SKILL.md** — v1 only *suggests* + copy/diff; auto-apply (with confirmation) is later.
- **Cost / token tracking as a headline feature** — deliberately not the focus (≈40 tools already do this; we may show it as a minor stat only).
- **Auth / multi-user / hosted cloud / remote telemetry** — never. Local-first by design.
- **Real-time streaming UI** — periodic refresh is sufficient.

---

## 3. Key Decisions (locked in brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | Autonomy model | **Passive collection + auto-analysis** (active eval = phase 2) |
| 2 | Agent scope | **Claude Code first**, with a `SourceAdapter` extension point for Codex |
| 3 | Capture method | **Hybrid: JSONL baseline + optional hooks enhancement** (correlated by `tool_use_id`) |
| 4 | Insight depth | **Coverage + missed-invocation detection + AI optimization** (strongest tier) |
| 5 | AI engine | **Headless Claude Code** (`claude -p` / Agent SDK; reuses the user's login, no API key) |
| 6 | Packaging | **CC plugin + Node/TS CLI & dashboard** (plugin ships hooks, a slash command, and the analyst subagent) |

---

## 4. Architecture & Components

Data flow: `Claude Code (normal use)` → `JSONL transcripts (+ optional hook events)` → **Ingester** → **SQLite** → **Coverage Engine** + **Missed-Invocation Generator** → **Headless CC Analysis Loop** → `optimizations` → **Dashboard**.

Each component has a single responsibility and a defined interface:

1. **Ingester / Adapter** — Parses `~/.claude/projects/**/*.jsonl` and receives hook events; normalizes both into `events`. Idempotent on `(session_id, tool_use_id)`; tracks a per-file byte cursor for incremental ingest. Exposes a single `SourceAdapter` interface (`scanInventory()`, `ingestEvents(cursor)`) so Codex plugs in later behind the same contract.
2. **Inventory Scanner** — Enumerates *available* capabilities to form the coverage denominator: user/project `skills/*/SKILL.md` (parse frontmatter: name / description / declared triggers), `agents/*.md`, **plugin** skills/agents under `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/{skills,agents}` (stored **plugin-qualified**, e.g. `superpowers:brainstorming`, to match how events name them), `.claude/commands` (deferred from coverage in Plan 1), and MCP servers from `settings.json`, `settings.local.json`, **`~/.claude.json` (top-level `mcpServers`)**, and project **`.mcp.json`**. Built-in subagents (e.g. `general-purpose`, `Explore`) have no on-disk definition and are excluded from the denominator (reported as a caveat).
3. **Coverage Engine** — Pure & deterministic. Per inventory item over a window (default 30d): invocation count, last-used, rate; classification `never | underused | healthy`. **Default thresholds (configurable):** `never` = 0 invocations while available the whole window; `underused` = invoked ≥1 but in the bottom quartile of invocation rate among used items, **or** not used in the last 14 days; everything else `healthy`. **No LLM** — this is the trustworthy backbone shown as fact.
4. **Missed-Invocation Candidate Generator** — For ignored/underused targets only: match the item's description keywords / trigger phrases against historical user prompts (cheap, **high-recall, low-precision by design**). Emits candidates `{target, session, prompt_excerpt}`. Precision is delegated to the AI judge.
5. **AI Analysis Loop (headless CC brain)** — Triggered by `/skill-radar:analyze`, cron, or a CC routine. Spawns `claude -p`. **Inputs:** the ignored/underused list; the target's full SKILL.md body; missed-invocation candidates; a few sample sessions; **and the name+description of *all* inventory skills** (needed for overlap/collision reasoning). **Does:** (a) adjudicate each candidate (should it have fired? yes/no/maybe + reason, high-confidence only), (b) diagnose root cause, (c) produce a **full optimization package**. Output is schema-validated, then written to `optimizations`.
6. **Dashboard** — localhost web app reading SQLite. Three surfaces: usage leaderboards (skills/subagents/tools), **Ignored/Underused panel**, **optimization feed** with expandable full-package cards.

**Layered degradation (each layer independently useful):** runs on JSONL alone if hooks aren't installed; shows coverage even if the AI loop never runs.

---

## 5. Data Sources & Capture

- **JSONL transcripts** `~/.claude/projects/**/*.jsonl` — baseline, zero-config, backfills history, carries full prompts for scenario analysis. Skills appear as `Skill` tool-use blocks (skill name in input); subagents as `Task`/`Agent` tool-use blocks (`subagent_type`); other tools as themselves.
- **Hooks (optional, plugin-installed)** — `PreToolUse` / `PostToolUse` / `SubagentStart` / `SubagentStop` shell hooks call `skill-radar ingest --event`. Real-time, fills gaps, more reliable skill names. Correlated to JSONL via `tool_use_id`.
- **Inventory** — the denominator (see §4.2).

**Known attribution caveats (documented, mitigated by fusing sources):** user slash commands (`/skill-name`) bypass the PreToolUse `Skill` hook; skill logic run via `Bash` (e.g. `uv run python …`) can be mis-attributed. Underused-detection must avoid false positives by cross-checking JSONL + hooks.

---

## 6. Data Model (SQLite, local-first, no remote upload)

- `events(id, ts, session_id, project, agent, kind[skill|tool|subagent], name, trigger, source, tool_use_id, prompt_excerpt)`
- `inventory(id, scanned_at, kind[skill|command|agent|mcp], name, scope[user|project|plugin|bundled], description, triggers, path)`
- `sessions(session_id, project, started_at, ended_at, prompt_count)`
- `optimizations(id, created_at, target_kind, target_name, status[ignored|underused|overlap], facets(JSON), overall_confidence, applied)`
- `ingest_cursors(file_path, byte_offset, mtime)` — incremental ingest bookkeeping.

`facets` is an array of:
```
{ facet: summary | description | triggers | nonGoals | disambiguation | name,
  current, diagnosis, suggested, rationale, confidence, evidence[] }
```

---

## 7. The Full Optimization Package (the differentiator)

For each ignored/underused/overlapping **skill / subagent / slash command** (objects with a user-editable routing signal — built-in tools & MCP tools get usage stats only), the AI produces a multi-facet package; every facet carries `current → diagnosis → suggested → rationale → confidence → evidence[]` and is independently copyable:

1. **Summary** — one-line capability statement for fast human+model alignment.
2. **Description (routing signal)** — the frontmatter description that decides selection; rewritten for clarity + trigger coverage.
3. **Triggers ("use when")** — positive trigger scenarios + phrases, **mined from the user's real prompts**.
4. **Non-goals ("do NOT use when")** — negative boundaries / anti-triggers; prevents false activation and being suppressed when competing for a scenario.
5. **Disambiguation** — which sibling skills/subagents contend for the same scenarios and how to carve boundaries (e.g. "vs general-purpose: only use this when X").
6. **Name** — suggested only when a collision/ambiguity is detected.

Footer action: **assemble into a complete SKILL.md frontmatter diff** (copy-paste ready). Plus mark-adopted / ignore.

**Trust model:** coverage & ignored counts are deterministic fact; missed-invocation + optimization facets are AI-adjudicated, always shown with confidence + an evidence chain (session references), never as hard fact.

---

## 8. Dashboard UI (v1)

- **Top bar:** capability coverage % (used/available, 30d), # ignored, # underused, # pending optimizations, last-analysis time.
- **Left:** usage leaderboards — skills / subagents / tools.
- **Center:** **Ignored / Underused** panel — available-but-unused items with `never (0)` / `underused (rare + last-used)` pills and source/scope.
- **Right:** **optimization feed** — expandable cards rendering the full 6-facet package with per-facet copy buttons, confidence, evidence, and the frontmatter-diff action.

---

## 9. Packaging, Tech Stack & Repo Layout

**Stack:** TypeScript (Node ≥20); `better-sqlite3`; CLI via `commander`; dashboard = Vite + React + Tailwind served by a minimal `Hono` localhost API; AI loop spawns `claude -p` (headless) with a structured prompt and a JSON output schema (validated before write).

**Packaging:** a standard Claude Code plugin (`plugin/`) ships the hooks, the `/skill-radar:analyze` slash command, and a `skill-radar-analyst` subagent that carries the analysis prompt; the `npx skill-radar` CLI handles ingest / scan / analyze / serve.

```
skill-radar/
  src/
    cli.ts
    ingest/      # JSONL parser · hook receiver · SourceAdapter interface (Codex extension point)
    inventory/   # capability scanner
    coverage/    # deterministic coverage engine
    missed/      # high-recall missed-invocation candidate generator
    analyze/     # headless CC runner + prompt + output schema + validator
    db/          # sqlite schema + migrations
    server/      # Hono API
  web/           # Vite + React dashboard
  plugin/        # CC plugin: hooks / commands / agents
  test/          # vitest + fixtures
  README.md  LICENSE (MIT)
```

**CLI surface:** `skill-radar init | ingest [--event] | scan | analyze | serve`.

---

## 10. Privacy & Local-First

Everything is local SQLite; no telemetry; no remote upload. Prompt excerpts are stored by default but can be disabled (`--no-prompts`). Matches the local-first norm of the closest competitors and is required for adoption.

---

## 11. Testing Strategy (TDD, vitest)

- Pure functions fully covered with fixtures: JSONL parser (realistic transcript samples), inventory scanner (fake skill dirs), coverage engine (deterministic), missed-invocation matcher.
- AI loop: **schema validation** + golden-fixture test against a recorded/mocked CC output. A real-CC integration test is gated/manual to avoid burning tokens in CI.

---

## 12. Phasing

- **Phase 2:** Codex adapter (`SourceAdapter` impl: rollout JSONL via Stop hook + `codex-otel`/`codex-analytics`); active eval / routing-coverage benchmark; optional auto-apply of optimizations with confirmation; optional native-OTel ingestion path.
- **Ecosystem (optional, non-blocking):** comment on / upvote [anthropics/claude-code #35319](https://github.com/anthropics/claude-code/issues/35319) to align with native direction.

---

## 13. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Native commoditization (#35319 ships counts natively) | Anchor on scenario analysis + full optimization package + (later) cross-agent + active eval, not raw counts |
| Subagent capture reliability (PreToolUse may not fire for Agent tool; reads inside subagents) | Fuse JSONL `Task` blocks + SubagentStart/Stop hooks; document confidence |
| Attribution leaks (slash commands, Bash-run skills) | Cross-check multiple sources before flagging "ignored" |
| Missed-invocation precision (heuristics misfire) | Heuristic = high-recall candidate generator; AI judge gates with confidence + evidence; never shown as hard fact |
| JSONL / hook format drift across CC releases | Isolate parsing behind the adapter; fixture-test against captured samples; fail soft |
| Autonomous-analysis token cost | On-demand + schedulable, not always-on; bounded inputs (top-N targets, sampled sessions) |
| "Yet another CC dashboard" perception | Lead with Ignored-detection + optimization framing in README/demo, not cost charts |

---

## Appendix — Capture facts (Claude Code)

- Native OTel (where enabled) emits `claude_code.skill_activated` (skill.name, invocation_trigger ∈ user-slash / claude-proactive / nested-skill, skill.source, skill.kind) and `tool_decision`/`tool_result` (tool_name; with `OTEL_LOG_TOOL_DETAILS=1` → skill_name + subagent_type). Treated as an optional richer signal, not required.
- Inventory roots: user/project `skills/` + `agents/`, plugin skills/agents under `~/.claude/plugins/cache/*/*/*/{skills,agents}` (plugin-qualified names), `.claude/commands` (deferred), and MCP `mcpServers` from `settings.json` / `settings.local.json` / `~/.claude.json` / project `.mcp.json`.
