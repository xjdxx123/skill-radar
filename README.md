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

Plugin agents are inventoried whether they live in a plugin's `agents/` subdirectory
or as flat `.md` files at the plugin version root (the layout used by, e.g.,
`voltagent-subagents`). A flat file counts as an agent only when its frontmatter has
both `name` and `description`, so READMEs and other docs are skipped.

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

### `apply`

Apply a stored optimization to a user or project skill's `SKILL.md`, rewriting the frontmatter `description` and writing the triggers/non-goals/disambiguation guidance into a managed `skill-radar` body block:

```
npm run radar -- apply <skill> [--write] [--db <path>]
```

- `npm run radar -- apply <skill> [--write]` — apply a stored optimization to a user/project skill's SKILL.md: rewrites the frontmatter `description` and writes the triggers/non-goals/disambiguation guidance into a managed `skill-radar` body block (idempotent). Dry-run by default; `--write` makes a `.bak` backup first. Refuses plugin/bundled skills. Note: the `.bak` file reflects the state immediately before the most recent apply — after multiple applies it is not the pristine original.

### `serve`

Start the local web dashboard:

```
npm run radar -- serve [--port N]
```

- `--port <n>` — port to listen on (default: `4319`).
- `--window <days>` — look-back window for usage counts (default: `30`).
- `--stale <days>` — threshold in days for flagging a capability as underused (default: `14`).

Opens a browser-based dashboard showing the coverage summary, the ignored/underused panel, the top-used leaderboard, and the AI optimization-suggestion feed. Binds to `127.0.0.1` (localhost only); reads the local DB; no network access.

## Database location

By default the database lives at `~/.skill-radar/skill-radar.sqlite`.
Override with the `SKILL_RADAR_DB` environment variable or the `--db <path>`
flag on any command.

## Notes

- **Local-first**: all data stays on your machine. No network calls are made. Analysis sends your prompt history and SKILL.md text to your local `claude` CLI (your own authenticated session) — it stays on your machine; nothing is sent to third parties by skill-radar.
- **Slash-commands and built-in subagents** are not yet included in the
  capability denominator (planned for a future plan).

## Claude Code plugin

skill-radar ships as a Claude Code plugin (`plugin/`): slash commands, an analyst subagent, and a SessionStart hook
that keeps usage data fresh automatically.

### Install

```bash
git clone https://github.com/xjdxx123/skill-radar && cd skill-radar
npm install
npm link   # puts the `skill-radar` command on your PATH (used by the plugin's commands + hook)
```

Use a normal `npm install` (not `--production` / `--omit=dev`): the `skill-radar` command runs via `tsx`, which is a dev dependency.

Then add the plugin to Claude Code by pointing it at this repo's `plugin/` directory (e.g. via a local marketplace
entry). The SessionStart hook is **guarded** — if `skill-radar` is not on your PATH it is a silent no-op, so
installing the plugin without `npm link` does no harm.

### What you get

- **`/skill-radar:report`** — coverage summary (ignored / underused / top-used).
- **`/skill-radar:analyze`** — headless AI optimization pass + suggestions.
- **`/skill-radar:dashboard`** — launch the local web dashboard.
- **`skill-radar-analyst`** subagent — diagnoses why a skill is ignored and proposes routing fixes.
- **SessionStart hook** — runs `skill-radar ingest && scan` (incremental, async) so your data stays current.
- **PostToolUse hook** — captures `Skill`/`Agent`/`Task` invocations in real time via `skill-radar ingest --hook` (deduped against the batch by `tool_use_id`; guarded + async; no-op without the CLI).
