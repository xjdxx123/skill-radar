---
description: Show skill-radar coverage — which installed skills, subagents, and MCP servers are ignored or underused.
---

Run the skill-radar coverage report:

- If the `skill-radar` CLI is on PATH, run: `skill-radar report`
- Otherwise run from the skill-radar repo: `npm run radar -- report`

Then summarize for the user: the overall capability-coverage %, the most notable **ignored** capabilities (0 invocations), and any **underused** ones worth revisiting. Keep it concise — surface the signal, not the whole list.
