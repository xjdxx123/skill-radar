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
      const safe = f.suggestion.trim().split('<!-- skill-radar:').join('<!-- skill_radar:');
      parts.push(`**${a.label}:** ${safe}`);
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
