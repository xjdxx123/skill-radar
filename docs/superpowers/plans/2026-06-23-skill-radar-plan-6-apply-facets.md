# skill-radar Plan 6 — Apply the Remaining Facets

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `apply` so it acts on more than the description: it writes the advice facets (triggers / non-goals / disambiguation) into a managed, idempotent body section of the SKILL.md, and records the apply in `optimizations.applied`. The `description` facet still updates the frontmatter (Plan 5); `name`/`summary` remain manual guidance.

**Architecture:** A pure `composeBodySection(facets)` builds a clearly-delimited markdown block (`<!-- skill-radar:begin -->…<!-- skill-radar:end -->`) from the advice facets; a pure `upsertBodySection(md, section)` replaces an existing block or appends a new one (idempotent on re-apply). `applyOptimization` keeps its Plan-5 safety (dry-run default, `.bak` backup, scope guard, frontmatter description rewrite) and now also upserts the body section and flips `optimizations.applied = 1` on `--write`.

**Tech Stack:** unchanged. No new deps.

**Prerequisite:** Plan 5 merged into `main` (`applyOptimization`, `replaceDescription`, `formatApply`, `ApplyResult`, the `optimizations.applied` column).

**Why a body section (not the description):** the advice-facet `suggestion`s are guidance phrased *to the user* ("add: 'confirm the fix works'"), not drop-in routing text — folding them verbatim into the frontmatter `description` would produce awkward prose. A managed body block documents the guidance with the skill, safely and reversibly, without corrupting the routing signal. (The routing-signal improvement remains the `description` facet.)

**Scope / safety (unchanged from Plan 5, plus):**
- Still **dry-run by default**, `.bak` backup before any write, **user/project scope only**, ambiguous-name refusal, and `replaceDescription` still refuses unsafe frontmatter.
- A `description` facet is still **required** to apply (keeps the precondition simple). An optimization with only advice facets and no description is skipped (documented limitation).
- The body block is **idempotent** — re-applying replaces the previous block, never stacks.
- `name` is never auto-applied (renaming changes a skill's identity); `summary` has no clean home — both stay manual guidance.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/apply/body.ts` | create | `composeBodySection(facets)` + `upsertBodySection(md, section)` (pure) |
| `src/apply/apply.ts` | modify | upsert body section + set `applied=1`; add `bodyFacets` to `ApplyResult` |
| `src/apply/report.ts` | modify | `formatApply` shows body-section facets + manual guidance |
| `src/cli.ts` | (no change) | `apply` command already wired |
| `README.md` | modify | note the body-section behavior |
| `test/apply/**` | modify/create | body tests + updated apply/report tests |

---

## Task 1: `composeBodySection` + `upsertBodySection` (pure)

**Files:**
- Create: `src/apply/body.ts`
- Test: `test/apply/body.test.ts`

- [ ] **Step 1: Write the failing test**

`test/apply/body.test.ts`:
```ts
import { describe, test, expect } from 'vitest';
import { composeBodySection, upsertBodySection } from '../../src/apply/body';
import type { OptimizationFacet } from '../../src/types';

const f = (facet: string, suggestion: string): OptimizationFacet => ({ facet: facet as any, suggestion, diagnosis: 'd', confidence: 'high' });

describe('composeBodySection', () => {
  test('builds a delimited block from the advice facets present, in order', () => {
    const r = composeBodySection([f('description', 'd'), f('triggers', 'confirm the fix works'), f('nonGoals', 'root-causing bugs'), f('disambiguation', 'vs code-review')])!;
    expect(r.facets).toEqual(['triggers', 'nonGoals', 'disambiguation']);
    expect(r.section).toContain('<!-- skill-radar:begin -->');
    expect(r.section).toContain('<!-- skill-radar:end -->');
    expect(r.section).toContain('**Use when:** confirm the fix works');
    expect(r.section).toContain('**Do not use for:** root-causing bugs');
    expect(r.section).toContain('**Disambiguation:** vs code-review');
  });

  test('includes only the advice facets that exist', () => {
    const r = composeBodySection([f('triggers', 'X')])!;
    expect(r.facets).toEqual(['triggers']);
    expect(r.section).toContain('**Use when:** X');
    expect(r.section).not.toContain('Do not use for');
  });

  test('returns null when there are no advice facets', () => {
    expect(composeBodySection([f('description', 'd'), f('name', 'n')])).toBeNull();
  });
});

describe('upsertBodySection', () => {
  const SECTION = '<!-- skill-radar:begin -->\n## skill-radar suggestions\n\n**Use when:** X\n<!-- skill-radar:end -->';

  test('appends the section when none exists', () => {
    const out = upsertBodySection('---\nname: x\n---\nbody\n', SECTION);
    expect(out).toContain('body');
    expect(out).toContain('<!-- skill-radar:begin -->');
    expect(out.match(/skill-radar:begin/g)!.length).toBe(1);
  });

  test('replaces an existing section idempotently (no stacking)', () => {
    const first = upsertBodySection('---\nname: x\n---\nbody\n', SECTION);
    const NEW = '<!-- skill-radar:begin -->\n## skill-radar suggestions\n\n**Use when:** Y\n<!-- skill-radar:end -->';
    const second = upsertBodySection(first, NEW);
    expect(second.match(/skill-radar:begin/g)!.length).toBe(1); // still exactly one block
    expect(second).toContain('**Use when:** Y');
    expect(second).not.toContain('**Use when:** X');
  });

  test('does not misbehave on replacement text containing $ sequences', () => {
    const withDollar = '<!-- skill-radar:begin -->\n$1 and $& literal\n<!-- skill-radar:end -->';
    const out = upsertBodySection('body\n' + SECTION, withDollar);
    expect(out).toContain('$1 and $& literal');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/apply/body.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/apply/body.ts`**

```ts
import type { OptimizationFacet } from '../types';

const BEGIN = '<!-- skill-radar:begin -->';
const END = '<!-- skill-radar:end -->';
const BLOCK_RE = /<!-- skill-radar:begin -->[\s\S]*?<!-- skill-radar:end -->/;

const ADVICE: { facet: string; label: string }[] = [
  { facet: 'triggers', label: 'Use when' },
  { facet: 'nonGoals', label: 'Do not use for' },
  { facet: 'disambiguation', label: 'Disambiguation' },
];

export function composeBodySection(facets: OptimizationFacet[]): { section: string; facets: string[] } | null {
  const parts: string[] = [];
  const used: string[] = [];
  for (const a of ADVICE) {
    const f = facets.find((x) => x.facet === a.facet);
    if (f && typeof f.suggestion === 'string' && f.suggestion.trim()) {
      parts.push(`**${a.label}:** ${f.suggestion.trim()}`);
      used.push(a.facet);
    }
  }
  if (parts.length === 0) return null;
  const section = `${BEGIN}\n## skill-radar suggestions\n\n${parts.join('\n\n')}\n${END}`;
  return { section, facets: used };
}

export function upsertBodySection(md: string, section: string): string {
  // use a replacer function so `$`-sequences in `section` are inserted literally
  if (BLOCK_RE.test(md)) return md.replace(BLOCK_RE, () => section);
  const sep = md.endsWith('\n') ? '\n' : '\n\n';
  return `${md}${sep}${section}\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/apply/body.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apply/body.ts test/apply/body.test.ts
git commit -m "feat(apply): managed body-section composer + idempotent upsert"
```

---

## Task 2: Wire body section + `applied` audit into `applyOptimization`

**Files:**
- Modify: `src/apply/apply.ts`
- Test: `test/apply/apply.test.ts` (replace the file with the updated version below)

- [ ] **Step 1: Replace `test/apply/apply.test.ts`** with this updated version (adds body-section + `applied=1` assertions; the no-description-facet skip is preserved):

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
         { facet: 'triggers', diagnosis: 'missing', suggestion: 'confirm the fix works', confidence: 'medium' }]
      : [{ facet: 'triggers', diagnosis: 'missing', suggestion: 'confirm the fix works', confidence: 'medium' }];
    db.prepare(`INSERT INTO optimizations (created_at, target_kind, target_name, status, overall_confidence, facets, applied) VALUES ('t','skill','verify','never','high',?,0)`)
      .run(JSON.stringify({ trulyMissed: true, verdictReasoning: 'r', overallConfidence: 'high', facets }));
  }
  return db;
}

describe('applyOptimization', () => {
  test('dry-run reports old→new + body facets, but does NOT modify the file', () => {
    const db = seed();
    const r = applyOptimization(db, { skill: 'verify', write: false });
    expect(r.status).toBe('dry-run');
    expect(r.oldDescription).toBe('old desc');
    expect(r.newDescription).toBe('Use when verifying a fix by running the app');
    expect(r.bodyFacets).toContain('triggers');
    expect(readFileSync(skillPath, 'utf8')).toBe(ORIG);
    expect(existsSync(skillPath + '.bak')).toBe(false);
    expect((db.prepare(`SELECT applied FROM optimizations WHERE target_name='verify'`).get() as any).applied).toBe(0);
  });

  test('--write backs up, rewrites description, writes the body section, and sets applied=1', () => {
    const db = seed();
    const r = applyOptimization(db, { skill: 'verify', write: true });
    expect(r.status).toBe('applied');
    expect(readFileSync(skillPath + '.bak', 'utf8')).toBe(ORIG);
    const updated = readFileSync(skillPath, 'utf8');
    expect(updated).toContain('description: "Use when verifying a fix by running the app"');
    expect(updated).toContain('name: verify');
    expect(updated).toContain('run the app');
    expect(updated).toContain('<!-- skill-radar:begin -->');
    expect(updated).toContain('**Use when:** confirm the fix works');
    expect((db.prepare(`SELECT applied FROM optimizations WHERE target_name='verify'`).get() as any).applied).toBe(1);
  });

  test('re-applying does not stack the body section', () => {
    const db = seed();
    applyOptimization(db, { skill: 'verify', write: true });
    applyOptimization(db, { skill: 'verify', write: true });
    const updated = readFileSync(skillPath, 'utf8');
    expect(updated.match(/skill-radar:begin/g)!.length).toBe(1);
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
    expect(readFileSync(skillPath, 'utf8')).toBe(ORIG); // nothing written
  });

  test('skips when the skill is not in inventory', () => {
    const db = seed();
    const r = applyOptimization(db, { skill: 'ghost', write: true });
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/not found|inventory/i);
  });

  test('refuses when the skill name is ambiguous across editable scopes (user + project)', () => {
    const db = openDb(':memory:');
    const projPath = join(dir, 'PROJECT_SKILL.md');
    writeFileSync(projPath, ORIG);
    db.prepare(`INSERT INTO inventory (scanned_at, kind, name, scope, description, triggers, path) VALUES ('t','skill','verify','user','old desc',null,?)`).run(skillPath);
    db.prepare(`INSERT INTO inventory (scanned_at, kind, name, scope, description, triggers, path) VALUES ('t','skill','verify','project','old desc',null,?)`).run(projPath);
    db.prepare(`INSERT INTO optimizations (created_at, target_kind, target_name, status, overall_confidence, facets, applied) VALUES ('t','skill','verify','never','high',?,0)`)
      .run(JSON.stringify({ trulyMissed: true, verdictReasoning: 'r', overallConfidence: 'high', facets: [{ facet: 'description', diagnosis: 'd', suggestion: 'new desc', confidence: 'high' }] }));
    const r = applyOptimization(db, { skill: 'verify', write: true });
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/ambiguous|multiple/i);
    expect(readFileSync(skillPath, 'utf8')).toBe(ORIG);
    expect(readFileSync(projPath, 'utf8')).toBe(ORIG);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/apply/apply.test.ts`
Expected: FAIL (body-section + applied assertions fail against the Plan-5 implementation).

- [ ] **Step 3: Replace `src/apply/apply.ts`** with this updated version:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import type { Db } from '../db/index';
import { parseFrontmatter } from '../inventory/scan';
import { readOptimizations } from '../analyze/suggestions';
import { replaceDescription } from './frontmatter';
import { composeBodySection, upsertBodySection } from './body';

export interface ApplyResult {
  skill: string;
  status: 'applied' | 'dry-run' | 'skipped';
  reason?: string;
  path?: string;
  scope?: string;
  oldDescription?: string | null;
  newDescription?: string;
  backupPath?: string;
  bodyFacets?: string[];
  otherFacets?: { facet: string; suggestion: string }[];
}

interface InvRow { scope: string; path: string; }

export function applyOptimization(db: Db, opts: { skill: string; write: boolean }): ApplyResult {
  const skill = opts.skill;

  const rows = db.prepare(`SELECT scope, path FROM inventory WHERE kind = 'skill' AND name = ?`).all(skill) as InvRow[];
  if (rows.length === 0) return { skill, status: 'skipped', reason: `skill "${skill}" not found in inventory (run scan first)` };
  const editable = rows.filter((r) => r.scope === 'user' || r.scope === 'project');
  if (editable.length === 0) {
    return { skill, status: 'skipped', scope: rows[0].scope, path: rows[0].path, reason: `scope "${rows[0].scope}" is not editable — only user/project skills can be modified (plugin/bundled skills live in the plugin cache)` };
  }
  if (editable.length > 1) {
    return { skill, status: 'skipped', reason: `"${skill}" exists in multiple editable scopes (${editable.map((r) => r.scope).join(', ')}) — cannot safely choose which SKILL.md to edit` };
  }
  const inv = editable[0];

  const opt = readOptimizations(db, skill)[0];
  if (!opt) return { skill, status: 'skipped', scope: inv.scope, path: inv.path, reason: `no optimization stored for "${skill}" — run \`skill-radar analyze\` first` };

  const descFacet = opt.pkg.facets.find((f) => f.facet === 'description');
  const body = composeBodySection(opt.pkg.facets);
  const bodyFacets = body?.facets ?? [];
  const otherFacets = opt.pkg.facets
    .filter((f) => f.facet !== 'description' && !bodyFacets.includes(f.facet))
    .map((f) => ({ facet: f.facet, suggestion: f.suggestion }));
  if (!descFacet) {
    return { skill, status: 'skipped', scope: inv.scope, path: inv.path, bodyFacets, otherFacets, reason: `optimization for "${skill}" has no description facet to apply` };
  }

  let md: string;
  try {
    md = readFileSync(inv.path, 'utf8');
  } catch {
    return { skill, status: 'skipped', scope: inv.scope, path: inv.path, reason: `could not read ${inv.path}` };
  }

  const oldDescription = parseFrontmatter(md).description ?? null;
  const newDescription = descFacet.suggestion;
  let newMd = replaceDescription(md, newDescription);
  if (newMd === null) {
    return { skill, status: 'skipped', scope: inv.scope, path: inv.path, reason: `could not locate a single-line description in ${inv.path}'s frontmatter` };
  }
  if (body) newMd = upsertBodySection(newMd, body.section);

  const base = { skill, scope: inv.scope, path: inv.path, oldDescription, newDescription, bodyFacets, otherFacets } as const;
  if (!opts.write) return { ...base, status: 'dry-run' };

  const backupPath = inv.path + '.bak';
  writeFileSync(backupPath, md);
  writeFileSync(inv.path, newMd);
  db.prepare(`UPDATE optimizations SET applied = 1 WHERE target_kind = 'skill' AND target_name = ?`).run(skill);
  return { ...base, status: 'applied', backupPath };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/apply/apply.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/apply/apply.ts test/apply/apply.test.ts
git commit -m "feat(apply): write advice facets to a body section + set applied audit"
```

---

## Task 3: `formatApply` body facets + README + smoke

**Files:**
- Modify: `src/apply/report.ts`, `README.md`
- Test: `test/apply/report.test.ts` (replace with updated version)

- [ ] **Step 1: Replace `test/apply/report.test.ts`** with:

```ts
import { describe, test, expect } from 'vitest';
import { formatApply } from '../../src/apply/report';

describe('formatApply', () => {
  test('dry-run shows old→new, the body-section facets, manual guidance, and the --write hint', () => {
    const out = formatApply({
      skill: 'verify', status: 'dry-run', scope: 'user', path: '/s/SKILL.md',
      oldDescription: 'old', newDescription: 'new better desc',
      bodyFacets: ['triggers', 'nonGoals'],
      otherFacets: [{ facet: 'name', suggestion: 'rename to verify-run' }],
    });
    expect(out).toContain('verify');
    expect(out).toContain('new better desc');
    expect(out).toContain('triggers');
    expect(out).toContain('nonGoals');
    expect(out).toContain('name'); // manual guidance still surfaced
    expect(out).toMatch(/--write/);
  });

  test('applied shows the backup path', () => {
    const out = formatApply({ skill: 'verify', status: 'applied', path: '/s/SKILL.md', backupPath: '/s/SKILL.md.bak', newDescription: 'n', bodyFacets: ['triggers'] });
    expect(out).toMatch(/applied/i);
    expect(out).toContain('/s/SKILL.md.bak');
    expect(out).toContain('triggers');
  });

  test('skipped shows the reason', () => {
    const out = formatApply({ skill: 'verify', status: 'skipped', reason: 'no optimization stored' });
    expect(out).toContain('no optimization stored');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/apply/report.test.ts`
Expected: FAIL (the body-facets line isn't rendered yet).

- [ ] **Step 3: Replace `src/apply/report.ts`** with:

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

  if (r.bodyFacets && r.bodyFacets.length) {
    lines.push('');
    lines.push(`  body section (skill-radar block): ${r.bodyFacets.join(', ')}`);
  }

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

- [ ] **Step 5: Update the `apply` documentation in `README.md`.** Update BOTH the apply intro sentence AND the bullet (wherever apply is described in the Usage / apply section) so they mention that apply also writes the triggers/non-goals/disambiguation guidance into a managed `skill-radar` body block — not just the description. Read the current README apply section first; reword the intro prose to match, and use this exact bullet:

``- `npm run radar -- apply <skill> [--write]` — apply a stored optimization to a user/project skill's SKILL.md: rewrites the frontmatter `description` and writes the triggers/non-goals/disambiguation guidance into a managed `skill-radar` body block (idempotent). Dry-run by default; `--write` makes a `.bak` backup first. Refuses plugin/bundled skills.``

- [ ] **Step 6: Real smoke test** (dry-run only — never `--write` against real skills here):

```bash
npm run radar -- apply nonexistent-skill 2>&1 | head -3
```
Expected: `Skipped nonexistent-skill: ...not found in inventory...`. (If a real user/project skill has a stored optimization, a bare `apply <that-skill>` dry-run would also show the description + body-section preview without writing.) Report the output.

- [ ] **Step 7: Typecheck + full suite**

Run: `npm run typecheck` (0) and `npm test` (ALL pass).

- [ ] **Step 8: Commit**

```bash
git add src/apply/report.ts test/apply/report.test.ts README.md
git commit -m "feat(apply): surface body-section facets in apply output + docs"
```

---

## Self-Review

**Spec coverage (Plan 6):**
- Apply the remaining facets → advice facets (triggers/nonGoals/disambiguation) written to a managed body section (Tasks 1–2) ✓
- Audit trail → `optimizations.applied = 1` on write (Task 2) ✓
- Idempotent → `upsertBodySection` replaces, never stacks (Task 1 test + apply re-apply test) ✓
- Safety preserved (dry-run default, backup, scope guard, ambiguity refusal, frontmatter refusal) → unchanged in apply.ts ✓
- `name`/`summary` stay manual guidance; description facet still required → documented ✓

**Placeholder scan:** complete code throughout. No TODO/TBD.

**Type consistency:** `ApplyResult` gains `bodyFacets`; `composeBodySection`/`upsertBodySection` reused by apply.ts; `formatApply` reads `bodyFacets`. The `$`-safe `.replace(..., () => section)` avoids replacement-pattern bugs.

**Safety:** body section only written on `--write` (after `.bak`); dry-run still writes nothing (the new applied-column test asserts `applied===0` after dry-run); re-apply idempotency asserted.

**Cross-task ordering:** Task 1 (body composer) → 2 (wire into apply) → 3 (formatter + docs). Correct.

---

## Execution Handoff

After Plan 6, `apply` acts on the whole optimization package (description → frontmatter; triggers/non-goals/disambiguation → body block) with an audit flag. Remaining future work: npm publish, real-time hooks, active-eval benchmark, Codex adapter.
