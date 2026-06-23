export type Agent = 'claude-code' | 'codex';
export type EventKind = 'skill' | 'tool' | 'subagent';
export type CapabilityKind = 'skill' | 'command' | 'agent' | 'mcp';
export type Scope = 'user' | 'project' | 'plugin' | 'bundled';
export type CoverageStatus = 'never' | 'underused' | 'healthy';

export interface UsageEvent {
  ts: string; // ISO timestamp
  sessionId: string;
  project: string; // absolute cwd
  agent: Agent;
  kind: EventKind;
  name: string; // skill name / tool name / subagent_type (plugin-qualified for plugin skills/agents)
  trigger: string | null; // caller.type, e.g. "direct"
  source: string | null; // reserved for hook/source enrichment (Plan 2+)
  toolUseId: string | null;
  promptExcerpt: string | null;
}

export interface InventoryItem {
  kind: CapabilityKind;
  name: string; // plugin-qualified (e.g. "superpowers:brainstorming") for plugin scope; bare otherwise
  scope: Scope;
  description: string | null;
  triggers: string | null;
  path: string;
}

export interface CoverageRow {
  kind: CapabilityKind;
  name: string;
  scope: Scope;
  invocations: number;
  lastUsed: string | null; // ISO
  status: CoverageStatus;
}

export interface CoverageOptions {
  windowDays: number; // default 30
  underusedStaleDays: number; // default 14
  now: Date;
}
