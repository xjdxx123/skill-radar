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
