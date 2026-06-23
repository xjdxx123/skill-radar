import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { Command } from 'commander';
import { openDb, type Db } from './db/index';
import { ingestClaudeCode } from './ingest/adapter';
import { scanInventory, writeInventory } from './inventory/scan';
import { computeCoverage } from './coverage/engine';
import { formatReport } from './coverage/report';
import { findMissedInvocations } from './missed/candidates';
import { formatCandidates } from './missed/report';
import { analyzeSkills } from './analyze/analyze';
import { spawnClaudeRunner } from './analyze/runner';
import { readOptimizations, formatSuggestions } from './analyze/suggestions';

function defaultDbPath(): string {
  if (process.env.SKILL_RADAR_DB) return process.env.SKILL_RADAR_DB;
  const dir = join(homedir(), '.skill-radar');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'skill-radar.sqlite');
}

function withDb<T>(dbPath: string | undefined, fn: (db: Db) => T): T {
  const db = openDb(dbPath ?? defaultDbPath());
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const program = new Command();
program.name('skill-radar').description('Capability radar for AI coding agents').version('0.1.0');

program
  .command('init')
  .description('create/migrate the database')
  .option('--db <path>', 'database file path')
  .action((opts) => {
    const path = opts.db ?? defaultDbPath();
    withDb(path, () => {});
    console.log(`Initialized database at ${path}`);
  });

program
  .command('ingest')
  .description('ingest Claude Code transcripts')
  .option('--db <path>', 'database file path')
  .option('--projects-dir <dir>', 'override ~/.claude/projects')
  .action((opts) => {
    const root = opts.projectsDir ?? join(homedir(), '.claude', 'projects');
    const res = withDb(opts.db, (db) => ingestClaudeCode(db, { root }));
    console.log(`Ingested: ${res.inserted} new event(s) from ${res.filesScanned} changed file(s).`);
  });

program
  .command('scan')
  .description('scan available capabilities (skills, agents, plugins, mcp)')
  .option('--db <path>', 'database file path')
  .option('--user-dir <dir>', 'override ~/.claude')
  .option('--project-dir <dir>', 'override <cwd>/.claude')
  .action((opts) => {
    const userDir = opts.userDir ?? join(homedir(), '.claude');
    const projectDir = opts.projectDir ?? join(process.cwd(), '.claude');
    const n = withDb(opts.db, (db) => {
      const items = scanInventory({
        userDir,
        projectDir,
        pluginsCacheDir: join(homedir(), '.claude', 'plugins', 'cache'),
        userMcpJson: join(homedir(), '.claude.json'),
        projectMcpJson: join(process.cwd(), '.mcp.json'),
      });
      return writeInventory(db, items, new Date().toISOString());
    });
    console.log(`Scanned ${n} capability item(s) into inventory.`);
  });

program
  .command('report')
  .description('print coverage report')
  .option('--db <path>', 'database file path')
  .option('--window <days>', 'window in days', '30')
  .option('--stale <days>', 'underused staleness threshold in days', '14')
  .action((opts) => {
    const now = new Date();
    const out = withDb(opts.db, (db) =>
      formatReport(
        computeCoverage(db, {
          windowDays: Number(opts.window),
          underusedStaleDays: Number(opts.stale),
          now,
        }),
        { windowDays: Number(opts.window), now },
      ),
    );
    console.log(out);
  });

program
  .command('candidates')
  .description('show prompts where an ignored/underused skill seemingly should have fired')
  .option('--db <path>', 'database file path')
  .option('--window <days>', 'window in days', '30')
  .option('--stale <days>', 'underused staleness threshold in days', '14')
  .option('--min-score <n>', 'minimum keyword overlap', '2')
  .option('--per-skill <n>', 'max candidates per skill', '5')
  .option('--limit <n>', 'max total candidates', '50')
  .action((opts) => {
    const out = withDb(opts.db, (db) =>
      formatCandidates(
        findMissedInvocations(db, {
          windowDays: Number(opts.window),
          underusedStaleDays: Number(opts.stale),
          now: new Date(),
          minScore: Number(opts.minScore),
          perSkill: Number(opts.perSkill),
          limit: Number(opts.limit),
        }),
      ),
    );
    console.log(out);
  });

program
  .command('analyze')
  .description('run headless Claude Code to produce optimization packages for ignored skills')
  .option('--db <path>', 'database file path')
  .option('--limit <n>', 'max skills to analyze this run', '5')
  .option('--model <model>', 'model for headless analysis', 'sonnet')
  .option('--window <days>', 'window in days', '30')
  .option('--stale <days>', 'underused staleness threshold in days', '14')
  .option('--min-score <n>', 'minimum keyword overlap for a candidate', '2')
  .action(async (opts) => {
    const db = openDb(opts.db ?? defaultDbPath());
    try {
      const res = await analyzeSkills(db, {
        runner: spawnClaudeRunner(),
        model: opts.model,
        limit: Number(opts.limit),
        minScore: Number(opts.minScore),
        perSkill: 5,
        candidateLimit: 200,
        maxPromptsPerSkill: 4,
        windowDays: Number(opts.window),
        underusedStaleDays: Number(opts.stale),
        now: new Date(),
      });
      console.log(`Analyzed ${res.analyzed} skill(s): stored ${res.stored}, skipped ${res.skipped}.`);
    } finally {
      db.close();
    }
  });

program
  .command('suggestions')
  .description('show stored optimization packages')
  .option('--db <path>', 'database file path')
  .option('--skill <name>', 'show only this skill')
  .action((opts) => {
    const out = withDb(opts.db, (db) => formatSuggestions(readOptimizations(db, opts.skill)));
    console.log(out);
  });

program.parseAsync().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
