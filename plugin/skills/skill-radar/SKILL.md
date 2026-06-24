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
