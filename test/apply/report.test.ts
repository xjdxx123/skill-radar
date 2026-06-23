import { describe, test, expect } from 'vitest';
import { formatApply } from '../../src/apply/report';

describe('formatApply', () => {
  test('dry-run shows old→new + manual guidance + the --write hint', () => {
    const out = formatApply({
      skill: 'verify', status: 'dry-run', scope: 'user', path: '/s/SKILL.md',
      oldDescription: 'old', newDescription: 'new better desc',
      otherFacets: [{ facet: 'triggers', suggestion: 'add X' }],
    });
    expect(out).toContain('verify');
    expect(out).toContain('old');
    expect(out).toContain('new better desc');
    expect(out).toContain('triggers');
    expect(out).toMatch(/--write/);
  });

  test('applied shows the backup path', () => {
    const out = formatApply({ skill: 'verify', status: 'applied', path: '/s/SKILL.md', backupPath: '/s/SKILL.md.bak', newDescription: 'n' });
    expect(out).toMatch(/applied/i);
    expect(out).toContain('/s/SKILL.md.bak');
  });

  test('skipped shows the reason', () => {
    const out = formatApply({ skill: 'verify', status: 'skipped', reason: 'no optimization stored' });
    expect(out).toContain('no optimization stored');
  });
});
