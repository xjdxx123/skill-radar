import type { MissedCandidate } from '../types';

function truncate(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > n ? oneLine.slice(0, n - 1) + '…' : oneLine;
}

export function formatCandidates(rows: MissedCandidate[]): string {
  if (rows.length === 0) {
    return 'No missed-invocation candidates found (ignored skills had no matching prompts).';
  }
  const lines: string[] = [];
  lines.push(`Missed-invocation candidates: ${rows.length} (ignored/underused skills that a prompt seemingly called for)`);
  lines.push('');
  const bySkill = new Map<string, MissedCandidate[]>();
  for (const r of rows) {
    if (!bySkill.has(r.skill)) bySkill.set(r.skill, []);
    bySkill.get(r.skill)!.push(r);
  }
  for (const [skill, hits] of bySkill) {
    lines.push(`▸ ${skill} (${hits[0].scope}) — ${hits.length} candidate prompt(s)`);
    for (const h of hits) {
      lines.push(`    [score ${h.score}: ${h.matched.join(', ')}]`);
      lines.push(`    "${truncate(h.promptText, 100)}"`);
    }
    lines.push('');
  }
  lines.push('Note: heuristic, high-recall — Plan 2b will have Claude Code adjudicate each and propose fixes.');
  return lines.join('\n');
}
