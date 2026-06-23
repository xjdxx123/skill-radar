import { describe, test, expect } from 'vitest';
import { parseClaudeEnvelope } from '../../src/analyze/runner';

describe('parseClaudeEnvelope', () => {
  test('returns .result from a success envelope', () => {
    const env = JSON.stringify({ type: 'result', is_error: false, result: '{"facets":[]}', total_cost_usd: 0.01 });
    expect(parseClaudeEnvelope(env)).toBe('{"facets":[]}');
  });

  test('throws on an error envelope', () => {
    const env = JSON.stringify({ type: 'result', is_error: true, subtype: 'error_max_turns', result: '' });
    expect(() => parseClaudeEnvelope(env)).toThrow(/error_max_turns/);
  });

  test('throws on non-JSON stdout', () => {
    expect(() => parseClaudeEnvelope('claude: command not found')).toThrow();
  });

  test('returns empty string when result is absent', () => {
    expect(parseClaudeEnvelope(JSON.stringify({ is_error: false }))).toBe('');
  });
});
