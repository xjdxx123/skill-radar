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
