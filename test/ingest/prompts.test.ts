import { describe, test, expect } from 'vitest';
import { extractPrompts } from '../../src/ingest/prompts';

const FIXTURE = [
  JSON.stringify({ type: 'user', sessionId: 's', timestamp: '2026-06-23T10:00:00.000Z', cwd: '/p', uuid: 'u1',
    message: { content: 'please verify the fix works' } }),
  JSON.stringify({ type: 'user', sessionId: 's', timestamp: '2026-06-23T10:01:00.000Z', cwd: '/p', uuid: 'u2',
    message: { content: [{ type: 'text', text: 'now run the tests' }] } }),
  JSON.stringify({ type: 'user', sessionId: 's', timestamp: '2026-06-23T10:02:00.000Z', cwd: '/p', uuid: 'u3',
    message: { content: '<command-name>/model</command-name>\n<command-message>model</command-message>' } }),
  JSON.stringify({ type: 'assistant', sessionId: 's', timestamp: '2026-06-23T10:03:00.000Z', cwd: '/p',
    message: { content: [{ type: 'text', text: 'ok' }] } }),
  'garbage',
].join('\n');

describe('extractPrompts', () => {
  test('captures natural-language user prompts (string and array forms), with uuid/session/ts', () => {
    const prompts = extractPrompts(FIXTURE);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toMatchObject({ uuid: 'u1', sessionId: 's', project: '/p', text: 'please verify the fix works' });
    expect(prompts[1]).toMatchObject({ uuid: 'u2', text: 'now run the tests' });
  });

  test('skips command records, assistant records, malformed lines, and records without a uuid', () => {
    const prompts = extractPrompts(FIXTURE);
    expect(prompts.some((p) => p.text.includes('command-name'))).toBe(false);
    expect(prompts.some((p) => p.text === 'ok')).toBe(false);
  });
});
