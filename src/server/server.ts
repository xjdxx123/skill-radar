import { Hono } from 'hono';
import type { Db } from '../db/index';
import type { CoverageOptions } from '../types';
import { computeCoverage } from '../coverage/engine';
import { readOptimizations } from '../analyze/suggestions';
import { statsPayload } from './api';

export interface ServerOptions {
  windowDays: number;
  underusedStaleDays: number;
  now?: () => Date;
}

function coverageOptions(opts: ServerOptions): CoverageOptions {
  return { windowDays: opts.windowDays, underusedStaleDays: opts.underusedStaleDays, now: (opts.now ?? (() => new Date()))() };
}

export function createApp(db: Db, opts: ServerOptions): Hono {
  const app = new Hono();
  app.get('/api/stats', (c) => c.json(statsPayload(db, coverageOptions(opts))));
  app.get('/api/coverage', (c) => c.json(computeCoverage(db, coverageOptions(opts))));
  app.get('/api/suggestions', (c) => c.json(readOptimizations(db)));
  return app;
}
