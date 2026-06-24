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
