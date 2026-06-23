import type { PromptRow } from '../types';

const PROMPT_MAX = 2000;

function textOf(content: unknown): string | null {
  if (typeof content === 'string') {
    if (content.includes('<command-name>')) return null;
    const t = content.trim();
    return t ? t.slice(0, PROMPT_MAX) : null;
  }
  if (Array.isArray(content)) {
    const t = content
      .filter((b): b is { type: string; text: string } =>
        !!b && typeof b === 'object' && (b as any).type === 'text' && typeof (b as any).text === 'string')
      .map((b) => b.text)
      .join(' ')
      .trim();
    return t ? t.slice(0, PROMPT_MAX) : null;
  }
  return null;
}

export function extractPrompts(content: string): PromptRow[] {
  const prompts: PromptRow[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: any;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!rec || rec.type !== 'user') continue;
    const uuid = typeof rec.uuid === 'string' ? rec.uuid : null;
    if (!uuid) continue;
    const msg = rec.message;
    const text = textOf(msg && typeof msg === 'object' ? (msg as any).content : undefined);
    if (!text) continue;
    prompts.push({
      uuid,
      sessionId: typeof rec.sessionId === 'string' ? rec.sessionId : '',
      project: typeof rec.cwd === 'string' ? rec.cwd : '',
      ts: typeof rec.timestamp === 'string' ? rec.timestamp : '',
      text,
    });
  }
  return prompts;
}
