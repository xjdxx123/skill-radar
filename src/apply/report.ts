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
