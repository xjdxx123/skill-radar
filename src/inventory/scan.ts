import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Db } from '../db/index';
import type { InventoryItem, Scope } from '../types';

export interface Frontmatter {
  name?: string;
  description?: string;
}

export interface ScanOptions {
  userDir: string;
  projectDir?: string;
  pluginsCacheDir?: string;
  userMcpJson?: string;
  projectMcpJson?: string;
}

export function parseFrontmatter(md: string): Frontmatter {
  const lines = md.split('\n');
  if (lines[0]?.trim() !== '---') return {};
  const fm: Frontmatter = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') break;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key === 'name') fm.name = val;
    else if (key === 'description') fm.description = val;
  }
  return fm;
}

function dirNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

function mdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function scanSkills(claudeDir: string, scope: Scope, qualifier?: string): InventoryItem[] {
  const root = join(claudeDir, 'skills');
  const items: InventoryItem[] = [];
  for (const name of dirNames(root)) {
    const path = join(root, name, 'SKILL.md');
    if (!existsSync(path)) continue;
    const fm = parseFrontmatter(readFileSync(path, 'utf8'));
    const bare = fm.name ?? name;
    items.push({
      kind: 'skill', name: qualifier ? `${qualifier}:${bare}` : bare,
      scope, description: fm.description ?? null, triggers: null, path,
    });
  }
  return items;
}

function scanAgents(claudeDir: string, scope: Scope, qualifier?: string): InventoryItem[] {
  const root = join(claudeDir, 'agents');
  const items: InventoryItem[] = [];
  for (const file of mdFiles(root)) {
    const path = join(root, file);
    const fm = parseFrontmatter(readFileSync(path, 'utf8'));
    const bare = fm.name ?? basename(file, '.md');
    items.push({
      kind: 'agent', name: qualifier ? `${qualifier}:${bare}` : bare,
      scope, description: fm.description ?? null, triggers: null, path,
    });
  }
  return items;
}

function scanMcpFile(path: string, scope: Scope): InventoryItem[] {
  if (!existsSync(path)) return [];
  let json: any;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
  const servers = json?.mcpServers;
  if (!servers || typeof servers !== 'object') return [];
  return Object.keys(servers).map((name) => ({
    kind: 'mcp' as const, name, scope, description: null, triggers: null, path,
  }));
}

function scanPlugins(cacheDir: string): InventoryItem[] {
  const items: InventoryItem[] = [];
  for (const marketplace of dirNames(cacheDir)) {
    for (const plugin of dirNames(join(cacheDir, marketplace))) {
      for (const version of dirNames(join(cacheDir, marketplace, plugin))) {
        const base = join(cacheDir, marketplace, plugin, version);
        items.push(...scanSkills(base, 'plugin', plugin));
        items.push(...scanAgents(base, 'plugin', plugin));
      }
    }
  }
  return items;
}

export function scanInventory(opts: ScanOptions): InventoryItem[] {
  const items: InventoryItem[] = [];

  if (existsSync(opts.userDir)) {
    items.push(...scanSkills(opts.userDir, 'user'));
    items.push(...scanAgents(opts.userDir, 'user'));
    items.push(...scanMcpFile(join(opts.userDir, 'settings.json'), 'user'));
    items.push(...scanMcpFile(join(opts.userDir, 'settings.local.json'), 'user'));
  }
  if (opts.userMcpJson) items.push(...scanMcpFile(opts.userMcpJson, 'user'));

  if (opts.projectDir && existsSync(opts.projectDir)) {
    items.push(...scanSkills(opts.projectDir, 'project'));
    items.push(...scanAgents(opts.projectDir, 'project'));
    items.push(...scanMcpFile(join(opts.projectDir, 'settings.json'), 'project'));
    items.push(...scanMcpFile(join(opts.projectDir, 'settings.local.json'), 'project'));
  }
  if (opts.projectMcpJson) items.push(...scanMcpFile(opts.projectMcpJson, 'project'));

  if (opts.pluginsCacheDir) items.push(...scanPlugins(opts.pluginsCacheDir));

  const seen = new Set<string>();
  return items.filter((i) => {
    const key = `${i.kind}\t${i.name}\t${i.scope}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function writeInventory(db: Db, items: InventoryItem[], scannedAt: string): number {
  const del = db.prepare(`DELETE FROM inventory`);
  const ins = db.prepare(
    `INSERT OR IGNORE INTO inventory (scanned_at, kind, name, scope, description, triggers, path)
     VALUES (@scannedAt, @kind, @name, @scope, @description, @triggers, @path)`,
  );
  let n = 0;
  const tx = db.transaction((rows: InventoryItem[]) => {
    del.run();
    for (const r of rows) n += ins.run({ ...r, scannedAt }).changes;
  });
  tx(items);
  return n;
}
