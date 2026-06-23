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
