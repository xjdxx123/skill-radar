import { describe, test, expect } from 'vitest';
import { buildAnalysisPrompt } from '../../src/analyze/prompt';

describe('buildAnalysisPrompt', () => {
  test('includes the skill, its markdown, the candidate prompts, siblings, and the required JSON shape', () => {
    const p = buildAnalysisPrompt({
      skillName: 'verify',
      scope: 'user',
      skillMarkdown: '---\nname: verify\ndescription: verify a change\n---\nbody here',
      candidatePrompts: ['can you confirm the fix works by running it', 'check this feature actually works'],
      siblingSkills: [
        { name: 'code-review', description: 'review code for bugs' },
        { name: 'systematic-debugging', description: 'debug before fixing' },
      ],
    });
    expect(p).toContain('verify');
    expect(p).toContain('description: verify a change');
    expect(p).toContain('can you confirm the fix works by running it');
    expect(p).toContain('code-review');
    expect(p).toMatch(/JSON/i);
    expect(p).toContain('description');
    expect(p).toContain('nonGoals');
    expect(p).toContain('disambiguation');
    expect(p).toContain('facets');
  });

  test('tolerates empty markdown and no siblings', () => {
    const p = buildAnalysisPrompt({ skillName: 'x', scope: 'plugin', skillMarkdown: '', candidatePrompts: ['hello'], siblingSkills: [] });
    expect(p).toContain('x');
    expect(p).toContain('hello');
  });
});
