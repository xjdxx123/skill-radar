import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../plugin/', import.meta.url));
const read = (p: string) => readFileSync(root + p, 'utf8');

describe('plugin manifest', () => {
  test('plugin.json is valid and well-formed', () => {
    const m = JSON.parse(read('.claude-plugin/plugin.json'));
    expect(m.name).toBe('skill-radar');
    expect(typeof m.description).toBe('string');
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.license).toBe('MIT');
  });
});

describe('commands', () => {
  test.each(['report', 'analyze', 'dashboard'])('%s.md has a description frontmatter', (name) => {
    const md = read(`commands/${name}.md`);
    expect(md.startsWith('---')).toBe(true);
    expect(md).toMatch(/\ndescription:\s*\S+/);
  });
});

describe('analyst subagent', () => {
  test('has name + description frontmatter', () => {
    const md = read('agents/skill-radar-analyst.md');
    expect(md).toMatch(/\nname:\s*skill-radar-analyst/);
    expect(md).toMatch(/\ndescription:\s*\S+/);
  });
});

describe('hooks', () => {
  test('hooks.json defines a guarded SessionStart command', () => {
    const h = JSON.parse(read('hooks/hooks.json'));
    const sessionStart = h.hooks?.SessionStart;
    expect(Array.isArray(sessionStart)).toBe(true);
    const cmd = sessionStart[0].hooks[0];
    expect(cmd.type).toBe('command');
    expect(cmd.command).toContain('command -v skill-radar');
    expect(cmd.command).toContain('skill-radar ingest');
    expect(cmd.async).toBe(true);
  });
});

describe('PostToolUse hook', () => {
  test('hooks.json defines a guarded PostToolUse hook scoped to Skill/Agent/Task', () => {
    const h = JSON.parse(read('hooks/hooks.json'));
    const post = h.hooks?.PostToolUse;
    expect(Array.isArray(post)).toBe(true);
    const entry = post[0];
    expect(entry.matcher).toMatch(/Skill/);
    expect(entry.matcher).toMatch(/Agent/);
    const cmd = entry.hooks[0];
    expect(cmd.command).toContain('command -v skill-radar');
    expect(cmd.command).toContain('ingest --hook');
    expect(cmd.async).toBe(true);
  });
});
