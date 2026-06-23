# skill-radar Plan 2b — Headless Claude Code Optimization Loop

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For the highest-evidence missed-invocation candidates, run a headless Claude Code call that reads the skill's SKILL.md + the prompts it seemingly should have fired on + sibling skills, and emits a full optimization package (verdict + per-facet diagnosis & rewrite for summary / description / triggers / non-goals / disambiguation / name). Store packages in an `optimizations` table and display them via a `suggestions` CLI command. This is the project's differentiator: it explains *why* a skill is ignored and *how* to fix its routing.

**Architecture:** Builds on Plan 2a. A thin, injectable `ClaudeRunner` shells out to `claude -p --output-format json --max-turns 1` (prompt via stdin) and returns the model's `.result` text. A pure prompt builder assembles the analysis request; a pure parser validates the model's JSON into an `OptimizationPackage`. The `analyzeSkills` orchestrator picks top-N targets from Plan 2a's `findMissedInvocations`, runs each through the runner, and upserts results. All logic is unit-tested with a **mock runner**; real `claude` is exercised only in a bounded end-to-end smoke test.

**Tech Stack:** Same as Plan 1/2a — TypeScript (Node ≥20), `better-sqlite3`, `commander`, `vitest`, `tsx`. New: `node:child_process` `spawn` for the runner. No new npm deps.

**Grounded headless contract (verified on disk):** `printf '%s' "<prompt>" | claude -p --output-format json --max-turns 1` → stdout is a JSON envelope `{ "is_error": false, "result": "<assistant final text>", ... }`. `.result` is the text we parse. `--model <m>` overrides the model. `--allowed-tools` is variadic (greedily eats a positional) so the prompt MUST go via stdin, and `--max-turns 1` keeps it to a single non-tool turn.

**Prerequisite:** Plan 2a is merged into `main` (provides `findMissedInvocations`, `computeCoverage`, the `prompts` corpus, `command` events).

**Scope note:** v1 **generates and stores** optimization packages and displays them; it does **not** auto-apply rewrites to SKILL.md (deferred — apply-with-confirmation is a later plan). Targets are **skills** (and could extend to subagents/commands later). Cost is bounded by `--limit` (default 5) and evidence-ranking, per the "prioritize by missed-invocation evidence" decision.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/types.ts` | modify | add `FacetKind`, `Confidence`, `OptimizationFacet`, `OptimizationPackage` |
| `src/db/schema.ts` | modify | add `optimizations` table |
| `src/analyze/schema.ts` | create | `parseOptimizationPackage(raw)` — validate model JSON |
| `src/analyze/runner.ts` | create | `parseClaudeEnvelope`, `ClaudeRunner`, `spawnClaudeRunner` |
| `src/analyze/prompt.ts` | create | `buildAnalysisPrompt(input)` |
| `src/analyze/analyze.ts` | create | `analyzeSkills(db, opts)` orchestrator |
| `src/analyze/suggestions.ts` | create | `readOptimizations`, `formatSuggestions` |
| `src/cli.ts` | modify | add `analyze` + `suggestions`; switch to `parseAsync` |
| `test/analyze/**` | create | tests per task |

---

## Task 1: Types + `optimizations` table

**Files:**
- Modify: `src/types.ts`, `src/db/schema.ts`
- Test: `test/db/index.test.ts` (add a case)

- [ ] **Step 1: Add types to `src/types.ts`**

```ts
export type FacetKind = 'summary' | 'description' | 'triggers' | 'nonGoals' | 'disambiguation' | 'name';
export type Confidence = 'high' | 'medium' | 'low';

export interface OptimizationFacet {
  facet: FacetKind;
  diagnosis: string;
  suggestion: string;
  confidence: Confidence;
}

export interface OptimizationPackage {
  trulyMissed: boolean | null;
  verdictReasoning: string | null;
  overallConfidence: Confidence;
  facets: OptimizationFacet[];
}
```

- [ ] **Step 2: Write the failing test**

Add to `test/db/index.test.ts` (inside `describe('openDb', ...)`):
```ts
  test('optimizations table exists and upserts by (target_kind, target_name)', () => {
    const db = openDb(':memory:');
    const up = db.prepare(
      `INSERT INTO optimizations (created_at, target_kind, target_name, status, overall_confidence, facets, applied)
       VALUES (?,?,?,?,?,?,0)
       ON CONFLICT(target_kind, target_name) DO UPDATE SET facets = excluded.facets`,
    );
    up.run('t1', 'skill', 'verify', 'never', 'high', '{"a":1}');
    up.run('t2', 'skill', 'verify', 'never', 'low', '{"a":2}');
    const rows = db.prepare(`SELECT facets FROM optimizations WHERE target_name = 'verify'`).all() as { facets: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].facets).toBe('{"a":2}');
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/db/index.test.ts`
Expected: FAIL (no `optimizations` table).

- [ ] **Step 4: Add the table to `src/db/schema.ts`** (append inside the `SCHEMA` string, after `prompts`)

```sql

CREATE TABLE IF NOT EXISTS optimizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_name TEXT NOT NULL,
  status TEXT NOT NULL,
  overall_confidence TEXT,
  facets TEXT NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0,
  UNIQUE(target_kind, target_name)
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/db/index.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/db/schema.ts test/db/index.test.ts
git commit -m "feat(analyze): optimizations table + package types"
```

---

## Task 2: Parse + validate the model's optimization JSON

**Files:**
- Create: `src/analyze/schema.ts`
- Test: `test/analyze/schema.test.ts`

- [ ] **Step 1: Write the failing test**

`test/analyze/schema.test.ts`:
```ts
import { describe, test, expect } from 'vitest';
import { parseOptimizationPackage } from '../../src/analyze/schema';

const VALID = JSON.stringify({
  trulyMissed: true,
  verdictReasoning: 'keywords matched in 3 prompts',
  overallConfidence: 'high',
  facets: [
    { facet: 'description', diagnosis: 'too vague', suggestion: 'Use when verifying a fix by running the app', confidence: 'high' },
    { facet: 'triggers', diagnosis: 'missing phrases', suggestion: 'add: "confirm the fix works"', confidence: 'medium' },
    { facet: 'bogus', diagnosis: 'x', suggestion: 'y', confidence: 'high' },
  ],
});

describe('parseOptimizationPackage', () => {
  test('parses a valid package and drops unknown facet kinds', () => {
    const pkg = parseOptimizationPackage(VALID)!;
    expect(pkg.trulyMissed).toBe(true);
    expect(pkg.overallConfidence).toBe('high');
    expect(pkg.facets.map((f) => f.facet)).toEqual(['description', 'triggers']); // 'bogus' dropped
  });

  test('strips ```json fences and tolerates leading prose', () => {
    const wrapped = 'Here is the result:\n```json\n' + VALID + '\n```\n';
    expect(parseOptimizationPackage(wrapped)).not.toBeNull();
  });

  test('coerces bad confidence to "low" and missing verdict to null', () => {
    const raw = JSON.stringify({ facets: [{ facet: 'name', diagnosis: 'd', suggestion: 's', confidence: 'banana' }] });
    const pkg = parseOptimizationPackage(raw)!;
    expect(pkg.facets[0].confidence).toBe('low');
    expect(pkg.trulyMissed).toBeNull();
    expect(pkg.overallConfidence).toBe('low');
  });

  test('returns null on non-JSON, missing facets, or zero valid facets', () => {
    expect(parseOptimizationPackage('not json at all')).toBeNull();
    expect(parseOptimizationPackage('{"facets":[]}')).toBeNull();
    expect(parseOptimizationPackage('{"facets":[{"facet":"bogus","diagnosis":"d","suggestion":"s"}]}')).toBeNull();
    expect(parseOptimizationPackage('{"no":"facets"}')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/analyze/schema.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/analyze/schema.ts`**

```ts
import type { Confidence, OptimizationFacet, OptimizationPackage } from '../types';

const FACET_KINDS = new Set(['summary', 'description', 'triggers', 'nonGoals', 'disambiguation', 'name']);
const CONFIDENCES = new Set(['high', 'medium', 'low']);

function coerceConfidence(v: unknown): Confidence {
  return typeof v === 'string' && CONFIDENCES.has(v) ? (v as Confidence) : 'low';
}

export function parseOptimizationPackage(raw: string): OptimizationPackage | null {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();
  if (!text.startsWith('{')) {
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    if (s === -1 || e === -1 || e < s) return null;
    text = text.slice(s, e + 1);
  }
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.facets)) return null;

  const facets: OptimizationFacet[] = [];
  for (const f of obj.facets) {
    if (!f || typeof f !== 'object') continue;
    if (!FACET_KINDS.has(f.facet)) continue;
    if (typeof f.diagnosis !== 'string' || typeof f.suggestion !== 'string') continue;
    facets.push({ facet: f.facet, diagnosis: f.diagnosis, suggestion: f.suggestion, confidence: coerceConfidence(f.confidence) });
  }
  if (facets.length === 0) return null;

  return {
    trulyMissed: typeof obj.trulyMissed === 'boolean' ? obj.trulyMissed : null,
    verdictReasoning: typeof obj.verdictReasoning === 'string' ? obj.verdictReasoning : null,
    overallConfidence: coerceConfidence(obj.overallConfidence),
    facets,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/analyze/schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/analyze/schema.ts test/analyze/schema.test.ts
git commit -m "feat(analyze): validate model optimization-package JSON"
```

---

## Task 3: Claude runner (envelope parse + spawn)

**Files:**
- Create: `src/analyze/runner.ts`
- Test: `test/analyze/runner.test.ts`

The pure envelope parser is unit-tested; the `spawnClaudeRunner` I/O wiring is exercised by the Task 6 real smoke test (not unit-tested, to avoid invoking real `claude` in CI).

- [ ] **Step 1: Write the failing test**

`test/analyze/runner.test.ts`:
```ts
import { describe, test, expect } from 'vitest';
import { parseClaudeEnvelope } from '../../src/analyze/runner';

describe('parseClaudeEnvelope', () => {
  test('returns .result from a success envelope', () => {
    const env = JSON.stringify({ type: 'result', is_error: false, result: '{"facets":[]}', total_cost_usd: 0.01 });
    expect(parseClaudeEnvelope(env)).toBe('{"facets":[]}');
  });

  test('throws on an error envelope', () => {
    const env = JSON.stringify({ type: 'result', is_error: true, subtype: 'error_max_turns', result: '' });
    expect(() => parseClaudeEnvelope(env)).toThrow(/error_max_turns/);
  });

  test('throws on non-JSON stdout', () => {
    expect(() => parseClaudeEnvelope('claude: command not found')).toThrow();
  });

  test('returns empty string when result is absent', () => {
    expect(parseClaudeEnvelope(JSON.stringify({ is_error: false }))).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/analyze/runner.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/analyze/runner.ts`**

```ts
import { spawn } from 'node:child_process';

export type ClaudeRunner = (prompt: string, opts?: { model?: string }) => Promise<string>;

export function parseClaudeEnvelope(stdout: string): string {
  const env = JSON.parse(stdout);
  if (env.is_error) throw new Error(`claude reported error: ${env.subtype ?? env.result ?? 'unknown'}`);
  return typeof env.result === 'string' ? env.result : '';
}

export function spawnClaudeRunner(): ClaudeRunner {
  return (prompt, opts = {}) =>
    new Promise<string>((resolve, reject) => {
      const args = ['-p', '--output-format', 'json', '--max-turns', '1'];
      if (opts.model) args.push('--model', opts.model);
      const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d.toString()));
      child.stderr.on('data', (d) => (err += d.toString()));
      child.on('error', reject);
      child.stdin.on('error', reject); // EPIPE if claude exits before reading stdin — route to reject, don't crash
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`));
        try {
          resolve(parseClaudeEnvelope(out));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
      child.stdin.write(prompt);
      child.stdin.end();
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/analyze/runner.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/analyze/runner.ts test/analyze/runner.test.ts
git commit -m "feat(analyze): headless claude runner + envelope parsing"
```

---

## Task 4: Analysis prompt builder

**Files:**
- Create: `src/analyze/prompt.ts`
- Test: `test/analyze/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

`test/analyze/prompt.test.ts`:
```ts
import { describe, test, expect } from 'vitest';
import { buildAnalysisPrompt } from '../../src/analyze/prompt';

describe('buildAnalysisPrompt', () => {
  test('includes the skill, its markdown, the candidate prompts, siblings, and the required JSON shape', () => {
    const p = buildAnalysisPrompt({
      skillName: 'verify',
      scope: 'user',
      skillMarkdown: '---\nname: verify\ndescription: verify a change\n---\nbody here',
      candidatePrompts: ['can you confirm the fix works by running it', 'check this feature actually works'],
      siblingSkills: [
        { name: 'code-review', description: 'review code for bugs' },
        { name: 'systematic-debugging', description: 'debug before fixing' },
      ],
    });
    expect(p).toContain('verify');
    expect(p).toContain('description: verify a change');
    expect(p).toContain('can you confirm the fix works by running it');
    expect(p).toContain('code-review');
    // instructs JSON-only output with the facet vocabulary
    expect(p).toMatch(/JSON/i);
    expect(p).toContain('description');
    expect(p).toContain('nonGoals');
    expect(p).toContain('disambiguation');
    expect(p).toContain('facets');
  });

  test('tolerates empty markdown and no siblings', () => {
    const p = buildAnalysisPrompt({ skillName: 'x', scope: 'plugin', skillMarkdown: '', candidatePrompts: ['hello'], siblingSkills: [] });
    expect(p).toContain('x');
    expect(p).toContain('hello');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/analyze/prompt.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/analyze/prompt.ts`**

```ts
export interface AnalysisInput {
  skillName: string;
  scope: string;
  skillMarkdown: string;
  candidatePrompts: string[];
  siblingSkills: { name: string; description: string | null }[];
}

const SCHEMA_INSTRUCTION = `Output ONLY a single JSON object (no prose, no markdown fences) with this shape:
{
  "trulyMissed": boolean,            // did this skill genuinely apply to the prompts below but fail to fire?
  "verdictReasoning": string,
  "overallConfidence": "high" | "medium" | "low",
  "facets": [                         // include only facets you have a concrete improvement for
    { "facet": "summary" | "description" | "triggers" | "nonGoals" | "disambiguation" | "name",
      "diagnosis": string,           // why the current wording fails to get this skill selected
      "suggestion": string,          // concrete replacement text / guidance
      "confidence": "high" | "medium" | "low" }
  ]
}
Facets: summary = one-line capability; description = the frontmatter routing line; triggers = "use when" phrases mined from the prompts; nonGoals = "do NOT use when" boundaries; disambiguation = how to choose this vs the sibling skills below; name = only if a rename reduces collision/ambiguity.`;

function clamp(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '\n…(truncated)' : s;
}

export function buildAnalysisPrompt(input: AnalysisInput): string {
  const prompts = input.candidatePrompts.length
    ? input.candidatePrompts.map((p, i) => `  ${i + 1}. ${clamp(p.replace(/\s+/g, ' ').trim(), 400)}`).join('\n')
    : '  (none)';
  const siblings = input.siblingSkills.length
    ? input.siblingSkills.map((s) => `  - ${s.name}: ${clamp((s.description ?? '').replace(/\s+/g, ' ').trim(), 140)}`).join('\n')
    : '  (none)';

  return `You are an expert at optimizing how an AI coding agent (Claude Code) selects its installed Skills.
A Skill is invoked when the model judges, from its frontmatter "description", that it applies. The skill below is
available but is being IGNORED — the user wrote prompts it seemingly should have handled, yet it never fired.

Diagnose why its wording fails to get it selected, and propose concrete fixes. Be specific and conservative;
only include a facet when you have a real improvement.

## Target skill: ${input.skillName} (scope: ${input.scope})

### Its SKILL.md
${clamp(input.skillMarkdown || '(no SKILL.md content available)', 6000)}

### Prompts where it seemingly should have fired but did not
${prompts}

### Sibling skills (for disambiguation — do not suggest overlapping triggers with these)
${siblings}

## Your output
${SCHEMA_INSTRUCTION}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/analyze/prompt.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/analyze/prompt.ts test/analyze/prompt.test.ts
git commit -m "feat(analyze): analysis prompt builder"
```

---

## Task 5: `analyzeSkills` orchestrator (with injected runner)

**Files:**
- Create: `src/analyze/analyze.ts`
- Test: `test/analyze/analyze.test.ts`

- [ ] **Step 1: Write the failing test**

`test/analyze/analyze.test.ts`:
```ts
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../../src/db/index';
import { analyzeSkills } from '../../src/analyze/analyze';

const VALID = JSON.stringify({
  trulyMissed: true, verdictReasoning: 'matched', overallConfidence: 'high',
  facets: [{ facet: 'description', diagnosis: 'too vague', suggestion: 'Use when verifying a fix by running the app', confidence: 'high' }],
});

let dir: string;
let skillPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sr-an-'));
  skillPath = join(dir, 'SKILL.md');
  writeFileSync(skillPath, '---\nname: verify\ndescription: verify a change\n---\nrun the app');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function seed(): Db {
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO inventory (scanned_at, kind, name, scope, description, triggers, path) VALUES ('t','skill','verify','user',?,null,?)`)
    .run('verify a change by running the app', skillPath);
  db.prepare(`INSERT INTO inventory (scanned_at, kind, name, scope, description, triggers, path) VALUES ('t','skill','code-review','user','review code',null,'/cr')`).run();
  db.prepare(`INSERT INTO prompts (uuid, session_id, project, ts, text) VALUES ('p1','s1','/p','2026-06-22T09:00:00.000Z',?)`)
    .run('can you verify the fix works by running the app');
  return db;
}

const BASE = { windowDays: 30, underusedStaleDays: 14, now: new Date('2026-06-23T00:00:00.000Z'),
  minScore: 2, perSkill: 5, candidateLimit: 50, maxPromptsPerSkill: 4, limit: 5 };

describe('analyzeSkills', () => {
  test('runs the runner for an ignored candidate skill and stores the parsed package', async () => {
    const db = seed();
    let capturedPrompt = '';
    const runner = async (p: string) => { capturedPrompt = p; return VALID; };
    const res = await analyzeSkills(db, { ...BASE, runner });
    expect(res.analyzed).toBe(1);
    expect(res.stored).toBe(1);
    expect(res.skipped).toBe(0);
    expect(capturedPrompt).toContain('verify');
    expect(capturedPrompt).toContain('can you verify the fix works by running the app'); // the candidate prompt
    expect(capturedPrompt).toContain('code-review'); // sibling for disambiguation
    const row = db.prepare(`SELECT target_name, status, overall_confidence, facets FROM optimizations`).get() as any;
    expect(row.target_name).toBe('verify');
    expect(row.overall_confidence).toBe('high');
    expect(JSON.parse(row.facets).facets[0].facet).toBe('description');
  });

  test('skips (no store, no throw) when the runner returns unparseable output', async () => {
    const db = seed();
    const res = await analyzeSkills(db, { ...BASE, runner: async () => 'sorry, I cannot help' });
    expect(res.analyzed).toBe(1);
    expect(res.stored).toBe(0);
    expect(res.skipped).toBe(1);
    expect((db.prepare(`SELECT COUNT(*) AS c FROM optimizations`).get() as any).c).toBe(0);
  });

  test('skips (no throw) when the runner rejects', async () => {
    const db = seed();
    const res = await analyzeSkills(db, { ...BASE, runner: async () => { throw new Error('claude exited 1'); } });
    expect(res.stored).toBe(0);
    expect(res.skipped).toBe(1);
  });

  test('analyzes nothing when there are no candidates', async () => {
    const db = openDb(':memory:'); // empty
    const res = await analyzeSkills(db, { ...BASE, runner: async () => VALID });
    expect(res).toEqual({ analyzed: 0, stored: 0, skipped: 0 });
  });

  test('respects --limit (analyzes at most `limit` skills)', async () => {
    const db = seed(); // 'verify' is one candidate
    // add a second ignored skill + a matching prompt → 2 candidates total
    db.prepare(`INSERT INTO inventory (scanned_at, kind, name, scope, description, triggers, path) VALUES ('t','skill','deploy','user','deploy the running application to production',null,?)`).run(skillPath);
    db.prepare(`INSERT INTO prompts (uuid, session_id, project, ts, text) VALUES ('p2','s2','/p','2026-06-22T09:00:00.000Z','please deploy the running application to production')`).run();
    let calls = 0;
    const res = await analyzeSkills(db, { ...BASE, limit: 1, runner: async () => { calls += 1; return VALID; } });
    expect(res.analyzed).toBe(1);
    expect(calls).toBe(1);
    expect((db.prepare(`SELECT COUNT(*) AS c FROM optimizations`).get() as any).c).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/analyze/analyze.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/analyze/analyze.ts`**

```ts
import { readFileSync } from 'node:fs';
import type { Db } from '../db/index';
import type { CoverageOptions } from '../types';
import { computeCoverage } from '../coverage/engine';
import { findMissedInvocations } from '../missed/candidates';
import { buildAnalysisPrompt } from './prompt';
import { parseOptimizationPackage } from './schema';
import type { ClaudeRunner } from './runner';

export interface AnalyzeOptions extends CoverageOptions {
  runner: ClaudeRunner;
  model?: string;
  limit: number; // max skills to analyze this run
  minScore: number;
  perSkill: number;
  candidateLimit: number;
  maxPromptsPerSkill: number;
}

export interface AnalyzeResult {
  analyzed: number;
  stored: number;
  skipped: number;
}

interface InvSkill { name: string; scope: string; description: string | null; path: string; }

export async function analyzeSkills(db: Db, opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const candidates = findMissedInvocations(db, {
    windowDays: opts.windowDays,
    underusedStaleDays: opts.underusedStaleDays,
    now: opts.now,
    minScore: opts.minScore,
    perSkill: opts.perSkill,
    limit: opts.candidateLimit,
  });

  // group candidate prompts by skill, preserving evidence order (candidates are score-sorted)
  const bySkill = new Map<string, { scope: string; prompts: string[] }>();
  for (const c of candidates) {
    if (!bySkill.has(c.skill)) bySkill.set(c.skill, { scope: c.scope, prompts: [] });
    const e = bySkill.get(c.skill)!;
    if (e.prompts.length < opts.maxPromptsPerSkill) e.prompts.push(c.promptText);
  }
  const targets = Array.from(bySkill.entries()).slice(0, opts.limit);
  if (targets.length === 0) return { analyzed: 0, stored: 0, skipped: 0 };

  const cov = computeCoverage(db, { windowDays: opts.windowDays, underusedStaleDays: opts.underusedStaleDays, now: opts.now });
  const statusByName = new Map(cov.map((r) => [r.name, r.status]));

  const allSkills = db.prepare(`SELECT name, scope, description, path FROM inventory WHERE kind = 'skill'`).all() as InvSkill[];
  const byName = new Map(allSkills.map((s) => [s.name, s]));

  const upsert = db.prepare(
    `INSERT INTO optimizations (created_at, target_kind, target_name, status, overall_confidence, facets, applied)
     VALUES (@created_at, 'skill', @target_name, @status, @overall_confidence, @facets, 0)
     ON CONFLICT(target_kind, target_name) DO UPDATE SET
       created_at = excluded.created_at, status = excluded.status,
       overall_confidence = excluded.overall_confidence, facets = excluded.facets, applied = 0`,
  );

  const createdAt = opts.now.toISOString();
  let analyzed = 0;
  let stored = 0;
  let skipped = 0;

  for (const [skillName, info] of targets) {
    analyzed += 1;
    const inv = byName.get(skillName);
    let markdown = '';
    if (inv?.path) {
      try {
        markdown = readFileSync(inv.path, 'utf8');
      } catch {
        markdown = '';
      }
    }
    // cap siblings to bound prompt size/cost; same-namespace skills first (most collision-prone), then alphabetical
    const ns = skillName.includes(':') ? skillName.split(':')[0] : '';
    const siblings = allSkills
      .filter((s) => s.name !== skillName)
      .sort((a, b) => {
        const ar = ns && a.name.startsWith(ns + ':') ? 0 : 1;
        const br = ns && b.name.startsWith(ns + ':') ? 0 : 1;
        return ar - br || a.name.localeCompare(b.name);
      })
      .slice(0, 20)
      .map((s) => ({ name: s.name, description: s.description }));
    const prompt = buildAnalysisPrompt({ skillName, scope: info.scope, skillMarkdown: markdown, candidatePrompts: info.prompts, siblingSkills: siblings });

    let pkg = null;
    try {
      const raw = await opts.runner(prompt, { model: opts.model });
      pkg = parseOptimizationPackage(raw);
    } catch {
      pkg = null;
    }
    if (!pkg) {
      skipped += 1;
      continue;
    }
    upsert.run({
      created_at: createdAt,
      target_name: skillName,
      status: statusByName.get(skillName) ?? 'never', // CoverageStatus domain: never|underused|healthy
      overall_confidence: pkg.overallConfidence,
      facets: JSON.stringify(pkg),
    });
    stored += 1;
  }

  return { analyzed, stored, skipped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/analyze/analyze.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/analyze/analyze.ts test/analyze/analyze.test.ts
git commit -m "feat(analyze): analyzeSkills orchestrator (injected runner)"
```

---

## Task 6: Suggestions formatter + CLI (`analyze`, `suggestions`)

**Files:**
- Create: `src/analyze/suggestions.ts`
- Modify: `src/cli.ts`
- Test: `test/analyze/suggestions.test.ts`

- [ ] **Step 1: Write the failing test for the formatter + reader**

`test/analyze/suggestions.test.ts`:
```ts
import { describe, test, expect } from 'vitest';
import { openDb } from '../../src/db/index';
import { readOptimizations, formatSuggestions } from '../../src/analyze/suggestions';

function seed() {
  const db = openDb(':memory:');
  const pkg = JSON.stringify({
    trulyMissed: true, verdictReasoning: 'matched 3 prompts', overallConfidence: 'high',
    facets: [
      { facet: 'description', diagnosis: 'too vague', suggestion: 'Use when verifying a fix by running the app', confidence: 'high' },
      { facet: 'nonGoals', diagnosis: 'overlaps debugging', suggestion: 'do NOT use for root-causing bugs', confidence: 'medium' },
    ],
  });
  db.prepare(`INSERT INTO optimizations (created_at, target_kind, target_name, status, overall_confidence, facets, applied) VALUES ('t','skill','verify','never','high',?,0)`).run(pkg);
  db.prepare(`INSERT INTO optimizations (created_at, target_kind, target_name, status, overall_confidence, facets, applied) VALUES ('t','skill','other','underused','low','{"facets":[{"facet":"summary","diagnosis":"d","suggestion":"s","confidence":"low"}],"overallConfidence":"low","trulyMissed":null,"verdictReasoning":null}',0)`).run();
  return db;
}

describe('readOptimizations', () => {
  test('reads all, or filters by skill', () => {
    const db = seed();
    expect(readOptimizations(db)).toHaveLength(2);
    const one = readOptimizations(db, 'verify');
    expect(one).toHaveLength(1);
    expect(one[0].targetName).toBe('verify');
    expect(one[0].pkg.facets[0].facet).toBe('description');
  });
});

describe('formatSuggestions', () => {
  test('renders each target with its facets, diagnosis and suggestion', () => {
    const db = seed();
    const out = formatSuggestions(readOptimizations(db));
    expect(out).toContain('verify');
    expect(out).toContain('description');
    expect(out).toContain('Use when verifying a fix by running the app');
    expect(out).toContain('nonGoals');
    expect(out).toContain('confidence');
  });

  test('handles an empty list', () => {
    expect(formatSuggestions([])).toContain('No optimization');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/analyze/suggestions.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/analyze/suggestions.ts`**

```ts
import type { Db } from '../db/index';
import type { OptimizationPackage } from '../types';
import { parseOptimizationPackage } from './schema';

export interface StoredOptimization {
  targetName: string;
  status: string;
  pkg: OptimizationPackage;
}

export function readOptimizations(db: Db, skill?: string): StoredOptimization[] {
  const rows = skill
    ? (db.prepare(`SELECT target_name, status, facets FROM optimizations WHERE target_kind='skill' AND target_name = ? ORDER BY target_name`).all(skill) as any[])
    : (db.prepare(`SELECT target_name, status, facets FROM optimizations WHERE target_kind='skill' ORDER BY target_name`).all() as any[]);
  const out: StoredOptimization[] = [];
  for (const r of rows) {
    const pkg = parseOptimizationPackage(r.facets);
    if (pkg) out.push({ targetName: r.target_name, status: r.status, pkg });
  }
  return out;
}

export function formatSuggestions(rows: StoredOptimization[]): string {
  if (rows.length === 0) return 'No optimization suggestions yet. Run: skill-radar analyze';
  const lines: string[] = [];
  lines.push(`Skill optimization suggestions: ${rows.length} skill(s)`);
  lines.push('');
  for (const r of rows) {
    const verdict = r.pkg.trulyMissed === false ? ' (model: likely NOT a real miss)' : '';
    lines.push(`▸ ${r.targetName} [${r.status}] — confidence ${r.pkg.overallConfidence}${verdict}`);
    if (r.pkg.verdictReasoning) lines.push(`    why: ${r.pkg.verdictReasoning}`);
    for (const f of r.pkg.facets) {
      lines.push(`    • ${f.facet} (confidence ${f.confidence})`);
      lines.push(`        diagnosis: ${f.diagnosis}`);
      lines.push(`        suggestion: ${f.suggestion}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/analyze/suggestions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the `analyze` and `suggestions` commands to `src/cli.ts`**

Add imports near the others:
```ts
import { analyzeSkills } from './analyze/analyze';
import { spawnClaudeRunner } from './analyze/runner';
import { readOptimizations, formatSuggestions } from './analyze/suggestions';
```

Add these two commands after the `candidates` command and before the final parse call:
```ts
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
    // async action: open/close the db explicitly — do NOT use the synchronous withDb,
    // which closes the db in finally BEFORE the awaited promise resolves (use-after-close).
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
```

(`openDb` and `defaultDbPath` are already in scope in cli.ts. `suggestions` is synchronous and keeps using `withDb`.)

- [ ] **Step 6: Switch the CLI to `parseAsync`** so the async `analyze` action is awaited and its errors are caught. Replace the final:
```ts
try {
  program.parse();
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
```
with:
```ts
program.parseAsync().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
```

- [ ] **Step 7: Run the formatter tests + typecheck + full suite**

Run: `npx vitest run test/analyze/suggestions.test.ts` (3 pass), then `npm run typecheck` (0), then `npm test` (ALL pass — Plan 1 + 2a + 2b).

- [ ] **Step 8: Bounded REAL end-to-end smoke test** (invokes real `claude`; small + cheap)

Run:
```bash
npm run radar -- ingest
npm run radar -- scan
npm run radar -- analyze --limit 2 --model sonnet
npm run radar -- suggestions
```
Expected: `analyze` reports `stored`/`skipped` counts; `suggestions` prints real optimization packages (diagnosis + rewritten description/triggers/non-goals) for ≈2 ignored skills. Capture the `analyze` summary line and one full suggestion. If `analyze` errors because `claude` is unavailable in this environment, report it (the unit tests already prove the logic with a mock runner).

- [ ] **Step 9: Commit**

```bash
git add src/analyze/suggestions.ts src/cli.ts test/analyze/suggestions.test.ts
git commit -m "feat(analyze): suggestions formatter + analyze/suggestions CLI"
```

---

## Self-Review

**Spec coverage (Plan 2b):**
- Headless Claude Code as the AI engine (decision) → `spawnClaudeRunner` via `claude -p --output-format json` (Task 3) ✓
- Full optimization package (summary/description/triggers/nonGoals/disambiguation/name) + verdict → prompt (Task 4) + schema (Tasks 1–2) ✓
- Evidence-prioritized, bounded by `--limit` (decision) → `analyzeSkills` consumes `findMissedInvocations` ordering, caps at `limit` (Task 5) ✓
- Store + display (no auto-apply) → `optimizations` table (Task 1) + `suggestions` (Task 6) ✓
- Testable without burning tokens → injected `ClaudeRunner` mock everywhere; real `claude` only in the Task 6 smoke step ✓

**Placeholder scan:** all steps contain complete code. No TODO/TBD.

**Type consistency:** `OptimizationPackage`/`OptimizationFacet`/`FacetKind`/`Confidence` defined once (Task 1) and used by `schema`, `analyze`, `suggestions`. `ClaudeRunner` defined in `runner.ts`, imported by `analyze.ts` and `cli.ts`. `parseOptimizationPackage` reused by `analyze` and `suggestions`. `analyzeSkills` reuses `findMissedInvocations` (Plan 2a) and `computeCoverage`.

**Async correctness:** `analyze` action opens/closes the db explicitly around the awaited orchestrator (not via the sync-`finally` `withDb`); CLI uses `parseAsync().catch(...)` so async errors surface cleanly. Per-target try/catch means one failed `claude` call skips that skill without aborting the run.

**Cross-task ordering:** Task 1 (types+table) → 2 (parser) → 3 (runner) → 4 (prompt) → 5 (orchestrator, needs 2+3+4) → 6 (CLI+formatter, needs all). Correct.

---

## Execution Handoff

After Plan 2b lands, the loop is complete: ingest → coverage → candidates → AI optimization packages, all from the CLI. Plan 3 turns this into the local web dashboard (the panel mockup, populated from `coverage` + `optimizations`); Plan 4 packages it as a Claude Code plugin (hooks + `/skill-radar:analyze` + analyst subagent).
