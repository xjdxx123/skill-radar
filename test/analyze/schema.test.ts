import { describe, test, expect } from 'vitest';
import { parseOptimizationPackage } from '../../src/analyze/schema';

const VALID = JSON.stringify({
  trulyMissed: true,
  verdictReasoning: 'keywords matched in 3 prompts',
  overallConfidence: 'high',
  facets: [
    { facet: 'description', diagnosis: 'too vague', suggestion: 'Use when verifying a fix by running the app', confidence: 'high' },
    { facet: 'triggers', diagnosis: 'missing phrases', suggestion: 'add: "confirm the fix works"', confidence: 'medium' },
    { facet: 'bogus', diagnosis: 'x', suggestion: 'y', confidence: 'high' },
  ],
});

describe('parseOptimizationPackage', () => {
  test('parses a valid package and drops unknown facet kinds', () => {
    const pkg = parseOptimizationPackage(VALID)!;
    expect(pkg.trulyMissed).toBe(true);
    expect(pkg.overallConfidence).toBe('high');
    expect(pkg.facets.map((f) => f.facet)).toEqual(['description', 'triggers']);
  });

  test('strips ```json fences and tolerates leading prose', () => {
    const wrapped = 'Here is the result:\n```json\n' + VALID + '\n```\n';
    expect(parseOptimizationPackage(wrapped)).not.toBeNull();
  });

  test('coerces bad confidence to "low" and missing verdict to null', () => {
    const raw = JSON.stringify({ facets: [{ facet: 'name', diagnosis: 'd', suggestion: 's', confidence: 'banana' }] });
    const pkg = parseOptimizationPackage(raw)!;
    expect(pkg.facets[0].confidence).toBe('low');
    expect(pkg.trulyMissed).toBeNull();
    expect(pkg.overallConfidence).toBe('low');
  });

  test('returns null on non-JSON, missing facets, or zero valid facets', () => {
    expect(parseOptimizationPackage('not json at all')).toBeNull();
    expect(parseOptimizationPackage('{"facets":[]}')).toBeNull();
    expect(parseOptimizationPackage('{"facets":[{"facet":"bogus","diagnosis":"d","suggestion":"s"}]}')).toBeNull();
    expect(parseOptimizationPackage('{"no":"facets"}')).toBeNull();
  });
});
