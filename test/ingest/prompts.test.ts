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

  test('drops injected / non-user content (markers + meta flags)', () => {
    const fixture = [
      JSON.stringify({ type: 'user', sessionId: 's', timestamp: '2026-06-23T10:00:00.000Z', cwd: '/p', uuid: 'g1',
        message: { content: 'a genuine question about the code' } }),
      JSON.stringify({ type: 'user', sessionId: 's', timestamp: '2026-06-23T10:00:01.000Z', cwd: '/p', uuid: 'n1',
        message: { content: '<observed_from_primary_session>ship-loop:adversarial-eval verification doctrine ...</observed_from_primary_session>' } }),
      JSON.stringify({ type: 'user', sessionId: 's', timestamp: '2026-06-23T10:00:02.000Z', cwd: '/p', uuid: 'n2',
        message: { content: '<task-notification>workflow done</task-notification>' } }),
      JSON.stringify({ type: 'user', sessionId: 's', timestamp: '2026-06-23T10:00:03.000Z', cwd: '/p', uuid: 'n3',
        message: { content: 'here is some <system-reminder>do this</system-reminder> text' } }),
      JSON.stringify({ type: 'user', sessionId: 's', timestamp: '2026-06-23T10:00:04.000Z', cwd: '/p', uuid: 'n4',
        message: { content: 'Stop hook feedback: blah' } }),
      JSON.stringify({ type: 'user', sessionId: 's', timestamp: '2026-06-23T10:00:05.000Z', cwd: '/p', uuid: 'n5', isMeta: true,
        message: { content: 'meta record content' } }),
    ].join('\n');
    const prompts = extractPrompts(fixture);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ uuid: 'g1', text: 'a genuine question about the code' });
  });

  test('drops sidechain (subagent-dispatch) prompts', () => {
    const fixture = [
      JSON.stringify({ type: 'user', sessionId: 's', timestamp: '2026-06-23T10:00:00.000Z', cwd: '/p', uuid: 'h1', isSidechain: false,
        message: { content: 'a real human question' } }),
      JSON.stringify({ type: 'user', sessionId: 's', timestamp: '2026-06-23T10:00:01.000Z', cwd: '/p', uuid: 'a1', isSidechain: true,
        message: { content: 'You are implementing Task 6 of an 8-task plan' } }),
    ].join('\n');
    const prompts = extractPrompts(fixture);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].uuid).toBe('h1');
  });
});
