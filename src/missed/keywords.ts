const STOPWORDS = new Set([
  'the', 'and', 'for', 'use', 'when', 'with', 'this', 'that', 'your', 'you', 'are', 'was',
  'will', 'from', 'into', 'not', 'but', 'all', 'any', 'can', 'has', 'have', 'had', 'its',
  'a', 'an', 'to', 'of', 'in', 'on', 'or', 'is', 'it', 'as', 'by', 'be', 'do', 'if', 'so',
  'asked', 'using', 'used', 'via', 'per', 'etc', 'eg', 'ie',
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

export function keywordsFor(name: string, description: string | null): string[] {
  const tokens = [...tokenize(name), ...(description ? tokenize(description) : [])];
  return Array.from(new Set(tokens));
}

export interface PromptScore {
  score: number;
  matched: string[];
}

export function scorePrompt(promptText: string, keywords: string[]): PromptScore {
  const hay = promptText.toLowerCase();
  const matched = keywords.filter((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(hay));
  return { score: matched.length, matched };
}
