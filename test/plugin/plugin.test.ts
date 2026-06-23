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
