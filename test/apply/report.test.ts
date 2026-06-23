import { describe, test, expect } from 'vitest';
import { formatApply } from '../../src/apply/report';

describe('formatApply', () => {
  test('dry-run shows old→new, the body-section facets, manual guidance, and the --write hint', () => {
    const out = formatApply({
      skill: 'verify', status: 'dry-run', scope: 'user', path: '/s/SKILL.md',
      oldDescription: 'old', newDescription: 'new better desc',
      bodyFacets: ['triggers', 'nonGoals'],
      otherFacets: [{ facet: 'name', suggestion: 'rename to verify-run' }],
    });
    expect(out).toContain('verify');
    expect(out).toContain('new better desc');
    expect(out).toContain('triggers');
    expect(out).toContain('nonGoals');
    expect(out).toContain('name');
    expect(out).toMatch(/--write/);
  });

  test('applied shows the backup path', () => {
    const out = formatApply({ skill: 'verify', status: 'applied', path: '/s/SKILL.md', backupPath: '/s/SKILL.md.bak', newDescription: 'n', bodyFacets: ['triggers'] });
    expect(out).toMatch(/applied/i);
    expect(out).toContain('/s/SKILL.md.bak');
    expect(out).toContain('triggers');
  });

  test('skipped shows the reason', () => {
    const out = formatApply({ skill: 'verify', status: 'skipped', reason: 'no optimization stored' });
    expect(out).toContain('no optimization stored');
  });
});
