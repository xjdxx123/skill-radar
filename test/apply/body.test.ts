import { describe, test, expect } from 'vitest';
import { composeBodySection, upsertBodySection } from '../../src/apply/body';
import type { OptimizationFacet } from '../../src/types';

const f = (facet: string, suggestion: string): OptimizationFacet => ({ facet: facet as any, suggestion, diagnosis: 'd', confidence: 'high' });

describe('composeBodySection', () => {
  test('builds a delimited block from the advice facets present, in order', () => {
    const r = composeBodySection([f('description', 'd'), f('triggers', 'confirm the fix works'), f('nonGoals', 'root-causing bugs'), f('disambiguation', 'vs code-review')])!;
    expect(r.facets).toEqual(['triggers', 'nonGoals', 'disambiguation']);
    expect(r.section).toContain('<!-- skill-radar:begin -->');
    expect(r.section).toContain('<!-- skill-radar:end -->');
    expect(r.section).toContain('**Use when:** confirm the fix works');
    expect(r.section).toContain('**Do not use for:** root-causing bugs');
    expect(r.section).toContain('**Disambiguation:** vs code-review');
  });

  test('includes only the advice facets that exist', () => {
    const r = composeBodySection([f('triggers', 'X')])!;
    expect(r.facets).toEqual(['triggers']);
    expect(r.section).toContain('**Use when:** X');
    expect(r.section).not.toContain('Do not use for');
  });

  test('returns null when there are no advice facets', () => {
    expect(composeBodySection([f('description', 'd'), f('name', 'n')])).toBeNull();
  });
});

describe('upsertBodySection', () => {
  const SECTION = '<!-- skill-radar:begin -->\n## skill-radar suggestions\n\n**Use when:** X\n<!-- skill-radar:end -->';

  test('appends the section when none exists', () => {
    const out = upsertBodySection('---\nname: x\n---\nbody\n', SECTION);
    expect(out).toContain('body');
    expect(out).toContain('<!-- skill-radar:begin -->');
    expect(out.match(/skill-radar:begin/g)!.length).toBe(1);
  });

  test('replaces an existing section idempotently (no stacking)', () => {
    const first = upsertBodySection('---\nname: x\n---\nbody\n', SECTION);
    const NEW = '<!-- skill-radar:begin -->\n## skill-radar suggestions\n\n**Use when:** Y\n<!-- skill-radar:end -->';
    const second = upsertBodySection(first, NEW);
    expect(second.match(/skill-radar:begin/g)!.length).toBe(1);
    expect(second).toContain('**Use when:** Y');
    expect(second).not.toContain('**Use when:** X');
  });

  test('does not misbehave on replacement text containing $ sequences', () => {
    const withDollar = '<!-- skill-radar:begin -->\n$1 and $& literal\n<!-- skill-radar:end -->';
    const out = upsertBodySection('body\n' + SECTION, withDollar);
    expect(out).toContain('$1 and $& literal');
  });
});
