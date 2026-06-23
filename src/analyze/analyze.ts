import { readFileSync } from 'node:fs';
import type { Db } from '../db/index';
import type { CoverageOptions } from '../types';
import { computeCoverage } from '../coverage/engine';
import { findMissedInvocations } from '../missed/candidates';
import { buildAnalysisPrompt } from './prompt';
import { parseOptimizationPackage } from './schema';
import type { ClaudeRunner } from './runner';

export interface AnalyzeOptions extends CoverageOptions {
  runner: ClaudeRunner;
  model?: string;
  limit: number;
  minScore: number;
  perSkill: number;
  candidateLimit: number;
  maxPromptsPerSkill: number;
}

export interface AnalyzeResult {
  analyzed: number;
  stored: number;
  skipped: number;
}

interface InvSkill { name: string; scope: string; description: string | null; path: string; }

export async function analyzeSkills(db: Db, opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const candidates = findMissedInvocations(db, {
    windowDays: opts.windowDays,
    underusedStaleDays: opts.underusedStaleDays,
    now: opts.now,
    minScore: opts.minScore,
    perSkill: opts.perSkill,
    limit: opts.candidateLimit,
  });

  const bySkill = new Map<string, { scope: string; prompts: string[] }>();
  for (const c of candidates) {
    if (!bySkill.has(c.skill)) bySkill.set(c.skill, { scope: c.scope, prompts: [] });
    const e = bySkill.get(c.skill)!;
    if (e.prompts.length < opts.maxPromptsPerSkill) e.prompts.push(c.promptText);
  }
  const targets = Array.from(bySkill.entries()).slice(0, opts.limit);
  if (targets.length === 0) return { analyzed: 0, stored: 0, skipped: 0 };

  const cov = computeCoverage(db, { windowDays: opts.windowDays, underusedStaleDays: opts.underusedStaleDays, now: opts.now });
  const statusByName = new Map(cov.map((r) => [r.name, r.status]));

  const allSkills = db.prepare(`SELECT name, scope, description, path FROM inventory WHERE kind = 'skill'`).all() as InvSkill[];
  const byName = new Map(allSkills.map((s) => [s.name, s]));

  const upsert = db.prepare(
    `INSERT INTO optimizations (created_at, target_kind, target_name, status, overall_confidence, facets, applied)
     VALUES (@created_at, 'skill', @target_name, @status, @overall_confidence, @facets, 0)
     ON CONFLICT(target_kind, target_name) DO UPDATE SET
       created_at = excluded.created_at, status = excluded.status,
       overall_confidence = excluded.overall_confidence, facets = excluded.facets, applied = 0`,
  );

  const createdAt = opts.now.toISOString();
  let analyzed = 0;
  let stored = 0;
  let skipped = 0;

  for (const [skillName, info] of targets) {
    analyzed += 1;
    const inv = byName.get(skillName);
    let markdown = '';
    if (inv?.path) {
      try {
        markdown = readFileSync(inv.path, 'utf8');
      } catch {
        markdown = '';
      }
    }
    // cap siblings to bound prompt size/cost; same-namespace skills first (most collision-prone), then alphabetical
    const ns = skillName.includes(':') ? skillName.split(':')[0] : '';
    const siblings = allSkills
      .filter((s) => s.name !== skillName)
      .sort((a, b) => {
        const ar = ns && a.name.startsWith(ns + ':') ? 0 : 1;
        const br = ns && b.name.startsWith(ns + ':') ? 0 : 1;
        return ar - br || a.name.localeCompare(b.name);
      })
      .slice(0, 20)
      .map((s) => ({ name: s.name, description: s.description }));
    const prompt = buildAnalysisPrompt({ skillName, scope: info.scope, skillMarkdown: markdown, candidatePrompts: info.prompts, siblingSkills: siblings });

    let pkg = null;
    try {
      const raw = await opts.runner(prompt, { model: opts.model });
      pkg = parseOptimizationPackage(raw);
    } catch {
      pkg = null;
    }
    if (!pkg) {
      skipped += 1;
      continue;
    }
    upsert.run({
      created_at: createdAt,
      target_name: skillName,
      status: statusByName.get(skillName) ?? 'never',
      overall_confidence: pkg.overallConfidence,
      facets: JSON.stringify(pkg),
    });
    stored += 1;
  }

  return { analyzed, stored, skipped };
}
