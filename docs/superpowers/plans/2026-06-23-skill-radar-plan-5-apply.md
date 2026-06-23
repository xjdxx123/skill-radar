# skill-radar Plan 5 — Apply Optimization to SKILL.md

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop. `skill-radar apply <skill>` writes the AI-suggested **description** (from a stored optimization package) back into the skill's `SKILL.md` — safely: dry-run by default, a `.bak` backup before any write, an explicit `--write` flag to commit, and a hard refusal to touch anything but `user`/`project` skills.

**Architecture:** A pure `replaceDescription(md, newDescription)` rewrites only the frontmatter `description:` line (writing a JSON-style double-quoted YAML scalar — always valid, matching how real skills like `graphify` already quote it), preserving everything else. `applyOptimization(db, opts)` looks up the skill in `inventory` (scope + path) and its stored package in `optimizations` (Plan 2b), guards the scope, and — in dry-run — reports the old→new description, or — with `--write` — backs up and rewrites the file. A `formatApply` renders the result. CLI: `apply <skill> [--write]`.

**Tech Stack:** unchanged (TypeScript, tsx, better-sqlite3, commander, vitest). No new deps.

**Grounded fact:** real user SKILL.md frontmatter uses a single-line, often double-quoted `description:` with embedded colons (verified: `~/.claude/skills/graphify/SKILL.md` → `description: "...Use when...: ..."`). The rewriter targets exactly that line.

**Prerequisite:** Plan 4 merged into `main` (the full pipeline incl. `optimizations` table, `readOptimizations`, inventory with `path`+`scope`).

**Safety / scope:**
- **Dry-run is the default.** `--write` is required to modify a file.
- **Backup before write:** `SKILL.md` → `SKILL.md.bak` (overwritten each apply; the user can re-run `analyze` and re-apply, and always has the immediately-previous version).
- **Scope guard:** only `user` and `project` skills are editable. `plugin`/`bundled` skills are **refused** (they live in the plugin cache and would be clobbered on update / aren't the user's to edit).
- **Description facet only** in v1. Other facets (triggers / non-goals / disambiguation / name) are *displayed* as manual guidance but never auto-written (no clean, unambiguous frontmatter home). Documented.
- Writes the suggestion **verbatim**; the dry-run diff lets the user verify before `--write`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/apply/frontmatter.ts` | create | `replaceDescription(md, newDescription)` (pure) |
| `src/apply/apply.ts` | create | `applyOptimization(db, opts)` + `ApplyResult` |
| `src/apply/report.ts` | create | `formatApply(result)` |
| `src/cli.ts` | modify | add `apply` command |
| `src/db/index.ts` (no change) | — | reuses inventory + optimizations |
| `test/apply/**` | create | tests |

---

## Task 1: `replaceDescription` (pure frontmatter rewrite)

**Files:**
- Create: `src/apply/frontmatter.ts`
- Test: `test/apply/frontmatter.test.ts`

- [ ] **Step 1: Write the failing test**

`test/apply/frontmatter.test.ts`:
```ts
import { describe, test, expect } from 'vitest';
import { replaceDescription } from '../../src/apply/frontmatter';

describe('replaceDescription', () => {
  test('replaces a quoted description, preserving other frontmatter + body', () => {
    const md = '---\nname: graphify\ndescription: "old desc"\ntrigger: /graphify\n---\nbody line\n';
    const out = replaceDescription(md, 'new: better desc')!;
    expect(out).toContain('description: "new: better desc"');
    expect(out).toContain('name: graphify');
    expect(out).toContain('trigger: /graphify');
    expect(out).toContain('body line');
    expect(out).not.toContain('old desc');
  });

  test('replaces an unquoted description', () => {
    const md = '---\nname: x\ndescription: old\n---\nb';
    expect(replaceDescription(md, 'new')!).toContain('description: "new"');
  });

  test('escapes embedded quotes/backslashes (valid YAML double-quoted scalar)', () => {
    const md = '---\nname: x\ndescription: old\n---\nb';
    const out = replaceDescription(md, 'say "hi" and \\path')!;
    expect(out).toContain('description: "say \\"hi\\" and \\\\path"');
  });

  test('returns null when there is no frontmatter', () => {
    expect(replaceDescription('# just a heading', 'x')).toBeNull();
  });

  test('returns null when frontmatter has no description line', () => {
    expect(replaceDescription('---\nname: x\n---\nb', 'new')).toBeNull();
  });

  test.each(['|', '>', '|2', '>4', '|8-'])('refuses a block-scalar description header (%s)', (h) => {
    expect(replaceDescription(`---\ndescription: ${h}\n  multi\n  line\n---\nb`, 'new')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/apply/frontmatter.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/apply/frontmatter.ts`**

```ts
// Replace only the frontmatter `description:` line with a JSON-style double-quoted YAML scalar
// (always valid YAML; matches how real skills already quote multi-clause descriptions).
// Returns the new file content, or null if there is no frontmatter / no single-line description.
export function replaceDescription(md: string, newDescription: string): string | null {
  const lines = md.split('\n');
  if (lines[0]?.trim() !== '---') return null;

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return null;

  for (let i = 1; i < end; i++) {
    const m = lines[i].match(/^(\s*)description:(\s*)(.*)$/);
    if (!m) continue;
    const value = m[3].trim();
    // refuse block scalars (any | or > header, incl. indentation indicators like |2, >4, |8-)
    // and empty values that continue on following lines — a single-line replace would orphan them.
    if (value === '' || value.startsWith('|') || value.startsWith('>')) return null;
    lines[i] = `${m[1]}description: ${JSON.stringify(newDescription)}`;
    return lines.join('\n');
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/apply/frontmatter.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/apply/frontmatter.ts test/apply/frontmatter.test.ts
git commit -m "feat(apply): frontmatter description rewriter (pure)"
```

---

## Task 2: `applyOptimization` orchestrator

**Files:**
- Create: `src/apply/apply.ts`
- Test: `test/apply/apply.test.ts`

- [ ] **Step 1: Write the failing test**

`test/apply/apply.test.ts`:
```ts
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../../src/db/index';
import { applyOptimization } from '../../src/apply/apply';

let dir: string;
let skillPath: string;
const ORIG = '---\nname: verify\ndescription: "old desc"\n---\nrun the app\n';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sr-apply-'));
  skillPath = join(dir, 'SKILL.md');
  writeFileSync(skillPath, ORIG);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function seed(scope = 'user', withOpt = true, descFacet = true): Db {
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO inventory (scanned_at, kind, name, scope, description, triggers, path) VALUES ('t','skill','verify',?,?,null,?)`)
    .run(scope, 'old desc', skillPath);
  if (withOpt) {
    const facets = descFacet
      ? [{ facet: 'description', diagnosis: 'vague', suggestion: 'Use when verifying a fix by running the app', confidence: 'high' },
         { facet: 'triggers', diagnosis: 'missing', suggestion: 'add: confirm the fix works', confidence: 'medium' }]
      : [{ facet: 'triggers', diagnosis: 'missing', suggestion: 'add: confirm the fix works', confidence: 'medium' }];
    db.prepare(`INSERT INTO optimizations (created_at, target_kind, target_name, status, overall_confidence, facets, applied) VALUES ('t','skill','verify','never','high',?,0)`)
      .run(JSON.stringify({ trulyMissed: true, verdictReasoning: 'r', overallConfidence: 'high', facets }));
  }
  return db;
}

describe('applyOptimization', () => {
  test('dry-run reports old→new but does NOT modify the file', () => {
    const db = seed();
    const r = applyOptimization(db, { skill: 'verify', write: false });
    expect(r.status).toBe('dry-run');
    expect(r.oldDescription).toBe('old desc');
    expect(r.newDescription).toBe('Use when verifying a fix by running the app');
    expect(readFileSync(skillPath, 'utf8')).toBe(ORIG); // unchanged
    expect(existsSync(skillPath + '.bak')).toBe(false);
    // other facets surfaced as guidance, not applied
    expect(r.otherFacets?.some((f) => f.facet === 'triggers')).toBe(true);
  });

  test('--write backs up then rewrites the description', () => {
    const db = seed();
    const r = applyOptimization(db, { skill: 'verify', write: true });
    expect(r.status).toBe('applied');
    expect(r.backupPath).toBe(skillPath + '.bak');
    expect(readFileSync(skillPath + '.bak', 'utf8')).toBe(ORIG); // backup is the original
    const updated = readFileSync(skillPath, 'utf8');
    expect(updated).toContain('description: "Use when verifying a fix by running the app"');
    expect(updated).toContain('name: verify'); // rest preserved
    expect(updated).toContain('run the app');
  });

  test('refuses non-user/project scope (plugin skills are not editable)', () => {
    const db = seed('plugin');
    const r = applyOptimization(db, { skill: 'verify', write: true });
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/plugin|user.*project|scope/i);
    expect(readFileSync(skillPath, 'utf8')).toBe(ORIG);
  });

  test('skips when there is no stored optimization', () => {
    const db = seed('user', false);
    const r = applyOptimization(db, { skill: 'verify', write: true });
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/no optimization|analyze/i);
  });

  test('skips when the optimization has no description facet', () => {
    const db = seed('user', true, false);
    const r = applyOptimization(db, { skill: 'verify', write: true });
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/description/i);
  });

  test('skips when the skill is not in inventory', () => {
    const db = seed();
    const r = applyOptimization(db, { skill: 'ghost', write: true });
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/not found|inventory/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/apply/apply.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/apply/apply.ts`**

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import type { Db } from '../db/index';
import { parseFrontmatter } from '../inventory/scan';
import { readOptimizations } from '../analyze/suggestions';
import { replaceDescription } from './frontmatter';

export interface ApplyResult {
  skill: string;
  status: 'applied' | 'dry-run' | 'skipped';
  reason?: string;
  path?: string;
  scope?: string;
  oldDescription?: string | null;
  newDescription?: string;
  backupPath?: string;
  otherFacets?: { facet: string; suggestion: string }[];
}

interface InvRow { scope: string; path: string; }

export function applyOptimization(db: Db, opts: { skill: string; write: boolean }): ApplyResult {
  const skill = opts.skill;

  const inv = db.prepare(`SELECT scope, path FROM inventory WHERE kind = 'skill' AND name = ?`).get(skill) as InvRow | undefined;
  if (!inv) return { skill, status: 'skipped', reason: `skill "${skill}" not found in inventory (run scan first)` };
  if (inv.scope !== 'user' && inv.scope !== 'project') {
    return { skill, status: 'skipped', scope: inv.scope, path: inv.path, reason: `scope "${inv.scope}" is not editable — only user/project skills can be modified (plugin/bundled skills live in the plugin cache)` };
  }

  const opt = readOptimizations(db, skill)[0];
  if (!opt) return { skill, status: 'skipped', scope: inv.scope, path: inv.path, reason: `no optimization stored for "${skill}" — run \`skill-radar analyze\` first` };

  const descFacet = opt.pkg.facets.find((f) => f.facet === 'description');
  const otherFacets = opt.pkg.facets.filter((f) => f.facet !== 'description').map((f) => ({ facet: f.facet, suggestion: f.suggestion }));
  if (!descFacet) return { skill, status: 'skipped', scope: inv.scope, path: inv.path, otherFacets, reason: `optimization for "${skill}" has no description facet to apply` };

  let md: string;
  try {
    md = readFileSync(inv.path, 'utf8');
  } catch {
    return { skill, status: 'skipped', scope: inv.scope, path: inv.path, reason: `could not read ${inv.path}` };
  }

  const oldDescription = parseFrontmatter(md).description ?? null;
  const newDescription = descFacet.suggestion;
  const newMd = replaceDescription(md, newDescription);
  if (newMd === null) {
    return { skill, status: 'skipped', scope: inv.scope, path: inv.path, reason: `could not locate a single-line description in ${inv.path}'s frontmatter` };
  }

  const base = { skill, scope: inv.scope, path: inv.path, oldDescription, newDescription, otherFacets } as const;
  if (!opts.write) return { ...base, status: 'dry-run' };

  const backupPath = inv.path + '.bak';
  writeFileSync(backupPath, md);
  writeFileSync(inv.path, newMd);
  return { ...base, status: 'applied', backupPath };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/apply/apply.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/apply/apply.ts test/apply/apply.test.ts
git commit -m "feat(apply): applyOptimization — scope-guarded, dry-run + backup"
```

---

## Task 3: `formatApply` + `apply` CLI + README + smoke

**Files:**
- Create: `src/apply/report.ts`
- Modify: `src/cli.ts`, `README.md`
- Test: `test/apply/report.test.ts`

- [ ] **Step 1: Write the failing test**

`test/apply/report.test.ts`:
```ts
import { describe, test, expect } from 'vitest';
import { formatApply } from '../../src/apply/report';

describe('formatApply', () => {
  test('dry-run shows old→new + manual guidance + the --write hint', () => {
    const out = formatApply({
      skill: 'verify', status: 'dry-run', scope: 'user', path: '/s/SKILL.md',
      oldDescription: 'old', newDescription: 'new better desc',
      otherFacets: [{ facet: 'triggers', suggestion: 'add X' }],
    });
    expect(out).toContain('verify');
    expect(out).toContain('old');
    expect(out).toContain('new better desc');
    expect(out).toContain('triggers'); // manual guidance listed
    expect(out).toMatch(/--write/);
  });

  test('applied shows the backup path', () => {
    const out = formatApply({ skill: 'verify', status: 'applied', path: '/s/SKILL.md', backupPath: '/s/SKILL.md.bak', newDescription: 'n' });
    expect(out).toMatch(/applied/i);
    expect(out).toContain('/s/SKILL.md.bak');
  });

  test('skipped shows the reason', () => {
    const out = formatApply({ skill: 'verify', status: 'skipped', reason: 'no optimization stored' });
    expect(out).toContain('no optimization stored');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/apply/report.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/apply/report.ts`**

```ts
import type { ApplyResult } from './apply';

export function formatApply(r: ApplyResult): string {
  if (r.status === 'skipped') return `Skipped ${r.skill}: ${r.reason}`;

  const lines: string[] = [];
  const verb = r.status === 'applied' ? 'Applied' : 'Dry-run';
  lines.push(`${verb} — ${r.skill} (${r.scope ?? ''}) ${r.path ?? ''}`);
  lines.push('');
  lines.push('  description:');
  lines.push(`    - old: ${r.oldDescription ?? '(none)'}`);
  lines.push(`    + new: ${r.newDescription ?? ''}`);

  if (r.otherFacets && r.otherFacets.length) {
    lines.push('');
    lines.push('  not applied (manual guidance):');
    for (const f of r.otherFacets) lines.push(`    • ${f.facet}: ${f.suggestion}`);
  }

  lines.push('');
  if (r.status === 'applied') {
    lines.push(`  backup: ${r.backupPath}`);
  } else {
    lines.push('  (dry-run — re-run with --write to apply; a .bak backup will be created)');
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/apply/report.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the `apply` command to `src/cli.ts`**

Add imports near the others:
```ts
import { applyOptimization } from './apply/apply';
import { formatApply } from './apply/report';
```
Add the command after `suggestions` (and before `serve`/the final parse block):
```ts
program
  .command('apply')
  .description('apply a stored optimization (the suggested description) to a skill\'s SKILL.md')
  .argument('<skill>', 'skill name (as shown by `suggestions`)')
  .option('--db <path>', 'database file path')
  .option('--write', 'actually write the change (default is a dry-run preview)', false)
  .action((skill, opts) => {
    const out = withDb(opts.db, (db) => formatApply(applyOptimization(db, { skill, write: !!opts.write })));
    console.log(out);
  });
```

- [ ] **Step 6: Add an `apply` line to the README Usage section**

Append after the `suggestions` entry (raw markdown, no wrapping fence):

`- `npm run radar -- apply <skill> [--write]` — apply a stored optimization's suggested description to a user/project skill's SKILL.md. Dry-run by default; `--write` makes a `.bak` backup then rewrites. Refuses plugin/bundled skills.`

- [ ] **Step 7: Real smoke test**

Run (dry-run is safe; we do NOT pass --write against real skills):
```bash
npm run radar -- suggestions | head -5
# pick a user/project skill that has a suggestion, or just exercise the skipped path:
npm run radar -- apply some-skill-name
```
Expected: prints either a dry-run old→new preview (if that skill has a stored optimization and is user/project scope) or a clear "Skipped … : <reason>". Do NOT run with `--write` against the user's real skills in the smoke test. Report what it printed.

- [ ] **Step 8: Typecheck + full suite**

Run: `npm run typecheck` (0) and `npm test` (ALL pass).

- [ ] **Step 9: Commit**

```bash
git add src/apply/report.ts src/cli.ts test/apply/report.test.ts README.md
git commit -m "feat(cli): apply command (dry-run default) + docs"
```

---

## Self-Review

**Spec coverage (Plan 5):**
- `apply` writes the suggested description back to SKILL.md → Tasks 1–3 ✓
- Safe by default: dry-run default, `.bak` backup, `--write` to commit → `applyOptimization` + CLI ✓
- Scope guard (user/project only; refuse plugin/bundled) → `applyOptimization` ✓
- Description-only in v1; other facets shown as manual guidance → `otherFacets` + `formatApply` ✓
- Reuses Plan 1 (`parseFrontmatter`, inventory) + Plan 2b (`readOptimizations`) ✓

**Placeholder scan:** all steps complete. No TODO/TBD.

**Type consistency:** `ApplyResult` defined in apply.ts, consumed by report.ts + cli. Reuses `parseFrontmatter` (inventory/scan), `readOptimizations` (analyze/suggestions), `replaceDescription` (apply/frontmatter). The JSON-stringified description is valid YAML and matches the real quoted-description style.

**Safety:** dry-run cannot write; write always backs up first; non-user/project scope is refused before any read/write; a frontmatter we can't safely edit (block scalar / no description) is refused rather than corrupted.

**Cross-task ordering:** Task 1 (rewriter) → 2 (orchestrator, uses rewriter) → 3 (formatter + CLI). Correct.

---

## Execution Handoff

After Plan 5, the loop is fully closed: `analyze` proposes, `suggestions` shows, `apply` fixes (safely). Remaining future work: applying the trigger/non-goal facets, npm publish, real-time hooks, Codex adapter.
