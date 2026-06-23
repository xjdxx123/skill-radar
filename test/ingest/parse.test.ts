import { describe, test, expect } from 'vitest';
import { parseTranscript } from '../../src/ingest/parse';

const FIXTURE = [
  JSON.stringify({
    type: 'user', sessionId: 'sess-1', timestamp: '2026-06-23T10:00:00.000Z', cwd: '/proj',
    message: { role: 'user', content: 'please verify the fix works' },
  }),
  JSON.stringify({
    type: 'assistant', sessionId: 'sess-1', timestamp: '2026-06-23T10:00:01.000Z', cwd: '/proj',
    message: { role: 'assistant', content: [
      { type: 'text', text: 'sure' },
      { type: 'tool_use', id: 'tu-skill', name: 'Skill', input: { skill: 'superpowers:brainstorming' }, caller: { type: 'direct' } },
    ] },
  }),
  JSON.stringify({
    type: 'assistant', sessionId: 'sess-1', timestamp: '2026-06-23T10:00:02.000Z', cwd: '/proj',
    message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'tu-agent', name: 'Agent', input: { subagent_type: 'Explore', description: 'd', prompt: 'p' } },
      { type: 'tool_use', id: 'tu-bash', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_use', id: 'tu-mcp', name: 'mcp__mcp-registry__search_mcp_registry', input: {} },
    ] },
  }),
  'not json — should be skipped',
].join('\n');

describe('parseTranscript', () => {
  test('extracts skill, subagent, tool, and mcp events with the right kind/name', () => {
    const events = parseTranscript(FIXTURE);
    const byId = Object.fromEntries(events.map((e) => [e.toolUseId, e]));
    expect(byId['tu-skill']).toMatchObject({ kind: 'skill', name: 'superpowers:brainstorming', trigger: 'direct' });
    expect(byId['tu-agent']).toMatchObject({ kind: 'subagent', name: 'Explore' });
    expect(byId['tu-bash']).toMatchObject({ kind: 'tool', name: 'Bash' });
    expect(byId['tu-mcp']).toMatchObject({ kind: 'tool', name: 'mcp__mcp-registry__search_mcp_registry' });
  });

  test('attaches session, project (cwd), ts, agent, and the preceding user prompt excerpt', () => {
    const events = parseTranscript(FIXTURE);
    const skill = events.find((e) => e.toolUseId === 'tu-skill')!;
    expect(skill.sessionId).toBe('sess-1');
    expect(skill.project).toBe('/proj');
    expect(skill.ts).toBe('2026-06-23T10:00:01.000Z');
    expect(skill.agent).toBe('claude-code');
    expect(skill.promptExcerpt).toBe('please verify the fix works');
  });

  test('ignores malformed lines and non-tool content', () => {
    const events = parseTranscript(FIXTURE);
    expect(events).toHaveLength(4);
  });

  test('skips tool_use blocks that have no string id (avoids null-id duplication)', () => {
    const line = JSON.stringify({
      type: 'assistant', sessionId: 's', timestamp: '2026-06-23T10:00:00.000Z', cwd: '/p',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] },
    });
    expect(parseTranscript(line)).toHaveLength(0);
  });
});
