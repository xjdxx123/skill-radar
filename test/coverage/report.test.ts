import { describe, test, expect } from 'vitest';
import { formatReport } from '../../src/coverage/report';
import type { CoverageRow } from '../../src/types';

const rows: CoverageRow[] = [
  { kind: 'skill', name: 'verify', scope: 'user', invocations: 0, lastUsed: null, status: 'never' },
  { kind: 'agent', name: 'Explore', scope: 'user', invocations: 1, lastUsed: '2026-05-01T00:00:00.000Z', status: 'underused' },
  { kind: 'skill', name: 'graphify', scope: 'user', invocations: 142, lastUsed: '2026-06-22T00:00:00.000Z', status: 'healthy' },
];

describe('formatReport', () => {
  test('renders coverage %, ignored, underused, and top-used sections', () => {
    const out = formatReport(rows, { windowDays: 30, now: new Date('2026-06-23T00:00:00.000Z') });
    expect(out).toContain('Capability coverage:');
    expect(out).toContain('2/3');
    expect(out).toContain('Ignored (0 invocations): 1');
    expect(out).toContain('verify');
    expect(out).toContain('Underused: 1');
    expect(out).toContain('Explore');
    expect(out).toContain('graphify');
    expect(out).toContain('slash commands');
    expect(out).toContain('built-in');
  });

  test('handles an empty inventory gracefully', () => {
    const out = formatReport([], { windowDays: 30, now: new Date('2026-06-23T00:00:00.000Z') });
    expect(out).toContain('Capability coverage:');
    expect(out).toContain('0/0');
  });
});
