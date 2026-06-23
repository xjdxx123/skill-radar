import { describe, test, expect } from 'vitest';
import { keywordsFor, scorePrompt } from '../../src/missed/keywords';

describe('keywordsFor', () => {
  test('extracts distinctive lowercase tokens from name + description, dropping stopwords and short tokens', () => {
    const kw = keywordsFor('verify', 'Use when asked to verify a fix works by running the app');
    expect(kw).toContain('verify');
    expect(kw).toContain('running');
    expect(kw).toContain('works');
    expect(kw).not.toContain('the');
    expect(kw).not.toContain('to');
    expect(kw.every((k) => k === k.toLowerCase())).toBe(true);
  });

  test('splits a plugin-qualified name into useful tokens', () => {
    const kw = keywordsFor('superpowers:systematic-debugging', null);
    expect(kw).toContain('systematic');
    expect(kw).toContain('debugging');
  });
});

describe('scorePrompt', () => {
  test('counts distinct matched keywords (case-insensitive, word-ish)', () => {
    const kw = ['verify', 'running', 'fix'];
    const r = scorePrompt('Can you VERIFY the fix by running it?', kw);
    expect(r.score).toBe(3);
    expect(r.matched.sort()).toEqual(['fix', 'running', 'verify']);
  });

  test('no overlap → score 0', () => {
    expect(scorePrompt('rename this css class', ['verify', 'running']).score).toBe(0);
  });
});
