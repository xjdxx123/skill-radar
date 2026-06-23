import type { Agent, EventKind, UsageEvent } from '../types';

const EXCERPT_MAX = 280;

function userText(content: unknown): string | null {
  if (typeof content === 'string') return content.trim().slice(0, EXCERPT_MAX) || null;
  if (Array.isArray(content)) {
    const text = content
      .filter((b): b is { type: string; text: string } =>
        !!b && typeof b === 'object' && (b as any).type === 'text' && typeof (b as any).text === 'string')
      .map((b) => b.text)
      .join(' ')
      .trim();
    return text ? text.slice(0, EXCERPT_MAX) : null;
  }
  return null;
}

function classifyToolUse(block: any): { kind: EventKind; name: string } | null {
  const name = block?.name;
  if (typeof name !== 'string' || !name) return null;
  const input = block.input ?? {};
  if (name === 'Skill') {
    const skill = input.skill ?? input.skill_name ?? input.name;
    return typeof skill === 'string' && skill ? { kind: 'skill', name: skill } : null;
  }
  if (name === 'Agent' || name === 'Task') {
    const sub = input.subagent_type ?? input.subagentType;
    return typeof sub === 'string' && sub ? { kind: 'subagent', name: sub } : null;
  }
  return { kind: 'tool', name };
}

export function parseTranscript(content: string, opts: { agent?: Agent } = {}): UsageEvent[] {
  const agent: Agent = opts.agent ?? 'claude-code';
  const events: UsageEvent[] = [];
  let lastPrompt: string | null = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: any;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!rec || typeof rec !== 'object') continue;

    const msg = rec.message;
    const msgContent = msg && typeof msg === 'object' ? (msg as any).content : undefined;

    if (rec.type === 'user') {
      const raw = typeof msgContent === 'string' ? msgContent : null;
      if (raw && raw.includes('<command-name>')) {
        const m = raw.match(/<command-name>\s*\/?([^<]+?)\s*<\/command-name>/);
        const cmd = m?.[1]?.trim();
        const uuid = typeof rec.uuid === 'string' ? rec.uuid : null;
        if (cmd && uuid) {
          events.push({
            ts: typeof rec.timestamp === 'string' ? rec.timestamp : '',
            sessionId: typeof rec.sessionId === 'string' ? rec.sessionId : '',
            project: typeof rec.cwd === 'string' ? rec.cwd : '',
            agent,
            kind: 'command',
            name: cmd,
            trigger: 'slash',
            source: null,
            toolUseId: uuid,
            promptExcerpt: null,
          });
        }
        continue;
      }
      const t = userText(msgContent);
      if (t) lastPrompt = t;
      continue;
    }

    if (rec.type === 'assistant' && Array.isArray(msgContent)) {
      for (const block of msgContent) {
        if (!block || typeof block !== 'object' || block.type !== 'tool_use') continue;
        const cls = classifyToolUse(block);
        if (!cls) continue;
        if (typeof block.id !== 'string' || !block.id) continue;
        events.push({
          ts: typeof rec.timestamp === 'string' ? rec.timestamp : '',
          sessionId: typeof rec.sessionId === 'string' ? rec.sessionId : '',
          project: typeof rec.cwd === 'string' ? rec.cwd : '',
          agent,
          kind: cls.kind,
          name: cls.name,
          trigger: block.caller?.type ?? null,
          source: null,
          toolUseId: block.id,
          promptExcerpt: lastPrompt,
        });
      }
    }
  }
  return events;
}
