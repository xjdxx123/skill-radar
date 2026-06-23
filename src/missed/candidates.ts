import type { Db } from '../db/index';
import type { CoverageOptions, MissedCandidate } from '../types';
import { computeCoverage } from '../coverage/engine';
import { keywordsFor, scorePrompt } from './keywords';

export interface MissedOptions extends CoverageOptions {
  minScore: number;
  perSkill: number;
  limit: number;
}

interface InvSkill { name: string; scope: string; description: string | null; }
interface PromptRowDb { session_id: string; ts: string; text: string; }

export function findMissedInvocations(db: Db, opts: MissedOptions): MissedCandidate[] {
  const coverage = computeCoverage(db, opts);
  const targetNames = new Set(
    coverage.filter((r) => r.kind === 'skill' && r.status !== 'healthy').map((r) => r.name),
  );
  if (targetNames.size === 0) return [];

  const skills = (db.prepare(`SELECT name, scope, description FROM inventory WHERE kind = 'skill'`).all() as InvSkill[])
    .filter((s) => targetNames.has(s.name));

  const usageRows = db
    .prepare(`SELECT name, session_id FROM events WHERE kind IN ('skill','command')`)
    .all() as { name: string; session_id: string }[];
  const firedSessions = new Map<string, Set<string>>();
  for (const u of usageRows) {
    if (!firedSessions.has(u.name)) firedSessions.set(u.name, new Set());
    firedSessions.get(u.name)!.add(u.session_id);
  }
  // NOTE: the endsWith(':' + evName) bridge can over-match on leaf-name collisions
  // (e.g. bare /deep-research marking academic-research-skills:deep-research as fired).
  // This errs toward a false NEGATIVE (suppressing a candidate), never a false positive — acceptable here.
  const sessionsWhereFired = (skillName: string): Set<string> => {
    const out = new Set<string>();
    for (const [evName, sessions] of firedSessions) {
      if (evName === skillName || skillName.endsWith(':' + evName)) for (const s of sessions) out.add(s);
    }
    return out;
  };

  const prompts = db.prepare(`SELECT session_id, ts, text FROM prompts`).all() as PromptRowDb[];

  const out: MissedCandidate[] = [];
  for (const skill of skills) {
    const kw = keywordsFor(skill.name, skill.description);
    if (kw.length === 0) continue;
    const fired = sessionsWhereFired(skill.name);
    const hits: MissedCandidate[] = [];
    for (const p of prompts) {
      if (fired.has(p.session_id)) continue;
      const { score, matched } = scorePrompt(p.text, kw);
      if (score < opts.minScore) continue;
      hits.push({ skill: skill.name, scope: skill.scope, promptText: p.text, sessionId: p.session_id, ts: p.ts, score, matched });
    }
    hits.sort((a, b) => b.score - a.score || b.ts.localeCompare(a.ts));
    out.push(...hits.slice(0, opts.perSkill));
  }

  out.sort((a, b) => b.score - a.score || a.skill.localeCompare(b.skill));
  return out.slice(0, opts.limit);
}
