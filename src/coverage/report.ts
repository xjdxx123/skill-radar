import type { CoverageRow } from '../types';

export interface ReportMeta {
  windowDays: number;
  now: Date;
}

function daysAgo(iso: string | null, now: Date): string {
  if (!iso) return 'never';
  const d = Math.round((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? 'today' : `${d}d ago`;
}

export function formatReport(rows: CoverageRow[], meta: ReportMeta): string {
  const total = rows.length;
  const used = rows.filter((r) => r.invocations > 0).length;
  const pct = total === 0 ? 0 : Math.round((used / total) * 100);

  const ignored = rows.filter((r) => r.status === 'never');
  const underused = rows.filter((r) => r.status === 'underused');
  const topUsed = rows.filter((r) => r.invocations > 0).sort((a, b) => b.invocations - a.invocations).slice(0, 10);

  const lines: string[] = [];
  lines.push(`skill-radar — coverage report (window: ${meta.windowDays}d)`);
  lines.push(`Capability coverage: ${pct}% (${used}/${total} used)`);
  lines.push('');

  lines.push(`⚠ Ignored (0 invocations): ${ignored.length}`);
  for (const r of ignored) lines.push(`   - ${r.name} (${r.scope}) [${r.kind}]`);
  lines.push('');

  lines.push(`▲ Underused: ${underused.length}`);
  for (const r of underused) lines.push(`   - ${r.name} [${r.kind}] — ${r.invocations} call(s), last ${daysAgo(r.lastUsed, meta.now)}`);
  lines.push('');

  lines.push('Top used:');
  for (const r of topUsed) lines.push(`   - ${r.name} [${r.kind}] — ${r.invocations}`);
  lines.push('');

  lines.push('Notes:');
  lines.push('  - slash commands are not yet covered (deferred to a later plan).');
  lines.push('  - built-in subagents (e.g. general-purpose, Explore) have no on-disk definition and are excluded from the denominator.');
  return lines.join('\n');
}
