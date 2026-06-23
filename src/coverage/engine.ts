import type { Db } from '../db/index';
import type { CapabilityKind, CoverageOptions, CoverageRow, CoverageStatus, Scope } from '../types';

export function normalizeMcp(name: string): string {
  return name.replace(/[\s.]/g, '_');
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / 86_400_000;
}

export function classify(
  invocations: number,
  lastUsed: string | null,
  rarityThreshold: number,
  opts: CoverageOptions,
): CoverageStatus {
  if (invocations === 0) return 'never';
  const stale = lastUsed ? daysBetween(new Date(lastUsed), opts.now) > opts.underusedStaleDays : true;
  if (stale || (rarityThreshold >= 0 && invocations <= rarityThreshold)) return 'underused';
  return 'healthy';
}

interface InvRow { kind: CapabilityKind; name: string; scope: Scope; }
interface Agg { kind: string; name: string; c: number; m: string | null; }

function matches(item: InvRow, agg: Agg): boolean {
  if (item.kind === 'skill') return agg.kind === 'skill' && agg.name === item.name;
  if (item.kind === 'agent') return agg.kind === 'subagent' && agg.name === item.name;
  if (item.kind === 'mcp') return agg.kind === 'tool' && agg.name.startsWith('mcp__' + normalizeMcp(item.name) + '__');
  return false;
}

const MIN_SAMPLES_FOR_QUARTILE = 4;

function quartileThreshold(counts: number[]): number {
  const used = counts.filter((c) => c > 0).sort((a, b) => a - b);
  if (used.length < MIN_SAMPLES_FOR_QUARTILE) return -1;
  const idx = Math.floor(0.25 * (used.length - 1));
  return used[idx];
}

const STATUS_ORDER: Record<CoverageStatus, number> = { never: 0, underused: 1, healthy: 2 };

export function computeCoverage(db: Db, opts: CoverageOptions): CoverageRow[] {
  const cutoff = new Date(opts.now.getTime() - opts.windowDays * 86_400_000).toISOString();

  const inventory = db
    .prepare(`SELECT kind, name, scope FROM inventory WHERE kind IN ('skill','agent','mcp')`)
    .all() as InvRow[];

  const aggs = db
    .prepare(`SELECT kind, name, COUNT(*) AS c, MAX(ts) AS m FROM events WHERE ts >= ? GROUP BY kind, name`)
    .all(cutoff) as Agg[];

  const tally = inventory.map((item) => {
    let invocations = 0;
    let lastUsed: string | null = null;
    for (const agg of aggs) {
      if (!matches(item, agg)) continue;
      invocations += agg.c;
      if (agg.m && (!lastUsed || agg.m > lastUsed)) lastUsed = agg.m;
    }
    return { item, invocations, lastUsed };
  });

  const thresholds: Record<string, number> = {};
  for (const kind of ['skill', 'agent', 'mcp'] as const) {
    thresholds[kind] = quartileThreshold(tally.filter((t) => t.item.kind === kind).map((t) => t.invocations));
  }

  const rows: CoverageRow[] = tally.map(({ item, invocations, lastUsed }) => ({
    kind: item.kind,
    name: item.name,
    scope: item.scope,
    invocations,
    lastUsed,
    status: classify(invocations, lastUsed, thresholds[item.kind] ?? -1, opts),
  }));

  rows.sort((a, b) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    b.invocations - a.invocations ||
    a.name.localeCompare(b.name));

  return rows;
}
