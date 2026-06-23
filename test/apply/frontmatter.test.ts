import { describe, test, expect } from 'vitest';
import { replaceDescription } from '../../src/apply/frontmatter';

describe('replaceDescription', () => {
  test('replaces a quoted description, preserving other frontmatter + body', () => {
    const md = '---\nname: graphify\ndescription: "old desc"\ntrigger: /graphify\n---\nbody line\n';
    const out = replaceDescription(md, 'new: better desc')!;
    expect(out).toContain('description: "new: better desc"');
    expect(out).toContain('name: graphify');
    expect(out).toContain('trigger: /graphify');
    expect(out).toContain('body line');
    expect(out).not.toContain('old desc');
  });

  test('replaces an unquoted description', () => {
    const md = '---\nname: x\ndescription: old\n---\nb';
    expect(replaceDescription(md, 'new')!).toContain('description: "new"');
  });

  test('escapes embedded quotes/backslashes (valid YAML double-quoted scalar)', () => {
    const md = '---\nname: x\ndescription: old\n---\nb';
    const out = replaceDescription(md, 'say "hi" and \\path')!;
    expect(out).toContain('description: "say \\"hi\\" and \\\\path"');
  });

  test('returns null when there is no frontmatter', () => {
    expect(replaceDescription('# just a heading', 'x')).toBeNull();
  });

  test('returns null when frontmatter has no description line', () => {
    expect(replaceDescription('---\nname: x\n---\nb', 'new')).toBeNull();
  });

  test.each(['|', '>', '|2', '>4', '|8-'])('refuses a block-scalar description header (%s)', (h) => {
    expect(replaceDescription(`---\ndescription: ${h}\n  multi\n  line\n---\nb`, 'new')).toBeNull();
  });
});
