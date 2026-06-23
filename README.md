# skill-radar

skill-radar is a capability radar for AI coding agents. It surfaces ignored,
underused, and top-used skills, subagents, and MCP servers in Claude Code —
fully local, no telemetry, no cloud sync. The tool reads your Claude Code
transcript files, cross-references them against an inventory of available
capabilities, and prints a coverage report so you know what you have but
never reach for.

## Install / Dev

```
npm install
npm test
npm run typecheck
```

## Usage

Run any command via `npm run radar -- <command> [options]`.

### `init`

Create (or migrate) the local SQLite database:

```
npm run radar -- init [--db <path>]
```

### `ingest`

Read Claude Code transcript files (`~/.claude/projects/**/*.jsonl`) and
insert new usage events into the database. Only files changed since the
last ingest are processed (cursor-based, incremental):

```
npm run radar -- ingest [--db <path>] [--projects-dir <dir>]
```

- `--projects-dir <dir>` — override the default `~/.claude/projects` root.

### `scan`

Inventory the skills, subagents, plugins, and MCP servers that are
currently available in your Claude Code setup (the coverage denominator):

```
npm run radar -- scan [--db <path>] [--user-dir <dir>] [--project-dir <dir>]
```

- `--user-dir <dir>` — override the default `~/.claude` user directory.
- `--project-dir <dir>` — override the default `<cwd>/.claude` project directory.

### `report`

Print the coverage report — ignored capabilities (never used), underused
capabilities (used but not recently), and top-used capabilities:

```
npm run radar -- report [--db <path>] [--window <days>] [--stale <days>]
```

- `--window <days>` — look-back window for usage counts (default: `30`).
- `--stale <days>` — threshold in days for flagging a capability as underused (default: `14`).

### `analyze`

Run a local headless Claude Code (`claude`) pass over the top ignored skills to produce
optimization packages — diagnosis plus rewritten description, triggers, and non-goals:

```
npm run radar -- analyze [--limit N] [--model M]
```

- `--limit <n>` — max skills to analyze in this run (default: `5`).
- `--model <model>` — model to pass to `claude -p` (default: `sonnet`).

Requires the `claude` CLI to be installed and authenticated. The command shells out
to `claude -p` locally and incurs token cost.

### `suggestions`

Print the stored optimization packages produced by `analyze`:

```
npm run radar -- suggestions [--skill NAME]
```

- `--skill <name>` — show only the package for a specific skill.

## Database location

By default the database lives at `~/.skill-radar/skill-radar.sqlite`.
Override with the `SKILL_RADAR_DB` environment variable or the `--db <path>`
flag on any command.

## Notes

- **Local-first**: all data stays on your machine. No network calls are made. Analysis sends your prompt history and SKILL.md text to your local `claude` CLI (your own authenticated session) — it stays on your machine; nothing is sent to third parties by skill-radar.
- **Slash-commands and built-in subagents** are not yet included in the
  capability denominator (planned for a future plan).
