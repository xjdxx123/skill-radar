import { describe, test, expect } from 'vitest';
import { openDb } from '../../src/db/index';
import { readOptimizations, formatSuggestions } from '../../src/analyze/suggestions';

function seed() {
  const db = openDb(':memory:');
  const pkg = JSON.stringify({
    trulyMissed: true, verdictReasoning: 'matched 3 prompts', overallConfidence: 'high',
    facets: [
      { facet: 'description', diagnosis: 'too vague', suggestion: 'Use when verifying a fix by running the app', confidence: 'high' },
      { facet: 'nonGoals', diagnosis: 'overlaps debugging', suggestion: 'do NOT use for root-causing bugs', confidence: 'medium' },
    ],
  });
  db.prepare(`INSERT INTO optimizations (created_at, target_kind, target_name, status, overall_confidence, facets, applied) VALUES ('t','skill','verify','never','high',?,0)`).run(pkg);
  db.prepare(`INSERT INTO optimizations (created_at, target_kind, target_name, status, overall_confidence, facets, applied) VALUES ('t','skill','other','underused','low','{"facets":[{"facet":"summary","diagnosis":"d","suggestion":"s","confidence":"low"}],"overallConfidence":"low","trulyMissed":null,"verdictReasoning":null}',0)`).run();
  return db;
}

describe('readOptimizations', () => {
  test('reads all, or filters by skill', () => {
    const db = seed();
    expect(readOptimizations(db)).toHaveLength(2);
    const one = readOptimizations(db, 'verify');
    expect(one).toHaveLength(1);
    expect(one[0].targetName).toBe('verify');
    expect(one[0].pkg.facets[0].facet).toBe('description');
  });
});

describe('formatSuggestions', () => {
  test('renders each target with its facets, diagnosis and suggestion', () => {
    const db = seed();
    const out = formatSuggestions(readOptimizations(db));
    expect(out).toContain('verify');
    expect(out).toContain('description');
    expect(out).toContain('Use when verifying a fix by running the app');
    expect(out).toContain('nonGoals');
    expect(out).toContain('confidence');
  });

  test('handles an empty list', () => {
    expect(formatSuggestions([])).toContain('No optimization');
  });
});
