---
description: Run skill-radar's AI optimization pass over ignored skills and present the suggestions.
---

Refresh data, then run the AI optimization loop:

1. `skill-radar ingest` then `skill-radar scan` (refresh usage + inventory)
2. `skill-radar analyze --limit 5` — a headless Claude Code pass that diagnoses why ignored skills aren't firing and drafts description/trigger/non-goal rewrites. (This incurs token cost.)
3. `skill-radar suggestions`

Present the top optimization packages: for each skill, why it's being ignored and the concrete suggested rewrite. Offer to apply a rewrite to the skill's SKILL.md if the user wants (skill-radar does not auto-apply).
