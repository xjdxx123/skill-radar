import type { Db } from '../db/index';
import type { CoverageOptions } from '../types';
import { computeCoverage } from '../coverage/engine';

export interface StatsPayload {
  windowDays: number;
  total: number;
  used: number;
  coveragePct: number;
  ignored: number;
  underused: number;
  healthy: number;
  suggestions: number;
}

export function statsPayload(db: Db, opts: CoverageOptions): StatsPayload {
  const rows = computeCoverage(db, opts);
  const total = rows.length;
  const used = rows.filter((r) => r.invocations > 0).length;
  const ignored = rows.filter((r) => r.status === 'never').length;
  const underused = rows.filter((r) => r.status === 'underused').length;
  const healthy = rows.filter((r) => r.status === 'healthy').length;
  const suggestions = (db.prepare(`SELECT COUNT(*) AS c FROM optimizations WHERE target_kind = 'skill'`).get() as { c: number }).c;
  return {
    windowDays: opts.windowDays,
    total,
    used,
    coveragePct: total === 0 ? 0 : Math.round((used / total) * 100),
    ignored,
    underused,
    healthy,
    suggestions,
  };
}
