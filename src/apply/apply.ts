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
