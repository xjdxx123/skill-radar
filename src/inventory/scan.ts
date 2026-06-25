import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory(); // statSync follows symlinks; throws on a dangling link
  } catch {
    return false;
  }
}

function dirNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    // Include symlinks that resolve to directories — some plugins (e.g.
    // academic-research-skills) expose their skill dirs as `skills/<name> -> ../<name>`
    // symlinks, and a Dirent for a symlink reports isDirectory() === false.
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() || (e.isSymbolicLink() && isDir(join(dir, e.name))))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// Read a file, returning null instead of throwing — so one unreadable file
// (EACCES, a TOCTOU broken symlink) degrades to skipping that item rather than
// aborting the entire scan. Matters more now that we follow symlinks.
function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
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
    const raw = readText(path); // null when missing/unreadable (subsumes the existence check)
    if (raw === null) continue;
    const fm = parseFrontmatter(raw);
    const bare = fm.name ?? name;
    items.push({
      kind: 'skill', name: qualifier ? `${qualifier}:${bare}` : bare,
      scope, description: fm.description ?? null, triggers: null, path,
    });
  }
  return items;
}

function agentItem(path: string, scope: Scope, qualifier: string | undefined, bare: string, description: string | null): InventoryItem {
  return {
    kind: 'agent', name: qualifier ? `${qualifier}:${bare}` : bare,
    scope, description, triggers: null, path,
  };
}

function scanAgentDir(agentsDir: string, scope: Scope, qualifier?: string): InventoryItem[] {
  const items: InventoryItem[] = [];
  for (const file of mdFiles(agentsDir)) {
    if (DOC_BASENAMES.has(basename(file, '.md').toLowerCase())) continue; // a README dropped in agents/ is not an agent
    const path = join(agentsDir, file);
    const raw = readText(path);
    if (raw === null) continue;
    const fm = parseFrontmatter(raw);
    items.push(agentItem(path, scope, qualifier, fm.name ?? basename(file, '.md'), fm.description ?? null));
  }
  return items;
}

function scanAgents(claudeDir: string, scope: Scope, qualifier?: string): InventoryItem[] {
  return scanAgentDir(join(claudeDir, 'agents'), scope, qualifier);
}

const SKIP_DIRS = new Set(['node_modules', '.git']);

// Recursively find every directory named `agents` under a plugin version dir.
// A real OR symlinked `agents` dir counts (so `<version>/agents -> ../shared` works),
// but we only RECURSE into real subdirectories — never following other symlinks —
// so we don't re-walk the `skills/<name> -> ../<name>` links (double-scan/cycle).
// Catches both `<version>/agents/` and nested `<version>/<component>/agents/`.
function findAgentsDirs(root: string, depth = 0): string[] {
  if (depth > 5) return [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(root, e.name);
    if (e.name === 'agents' && (e.isDirectory() || (e.isSymbolicLink() && isDir(full)))) {
      out.push(full); // an agents dir holds .md files — don't recurse into it
    } else if (e.isDirectory()) {
      out.push(...findAgentsDirs(full, depth + 1));
    }
  }
  return out;
}

// Repo/plugin documentation/manifest files that may carry frontmatter but are never agents.
const DOC_BASENAMES = new Set([
  'readme', 'changelog', 'license', 'licence', 'contributing', 'code_of_conduct', 'skill',
]);

// Some plugins (e.g. voltagent-subagents) ship agents as flat `.md` files at the
// plugin version root instead of inside an `agents/` subdir. Treat a flat file as an
// agent iff its frontmatter carries both `name` and `description` (the agent signature),
// which excludes README/CHANGELOG/etc.; a doc-basename denylist guards the rare case
// of a documentation file that happens to carry frontmatter.
function scanFlatAgents(dir: string, scope: Scope, qualifier?: string): InventoryItem[] {
  const items: InventoryItem[] = [];
  for (const file of mdFiles(dir)) {
    if (DOC_BASENAMES.has(basename(file, '.md').toLowerCase())) continue;
    const path = join(dir, file);
    const raw = readText(path);
    if (raw === null) continue;
    const fm = parseFrontmatter(raw);
    if (!fm.name || !fm.description) continue;
    items.push(agentItem(path, scope, qualifier, fm.name, fm.description));
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
        for (const agentsDir of findAgentsDirs(base)) {
          items.push(...scanAgentDir(agentsDir, 'plugin', plugin));
        }
        // Flat-at-root agents (voltagent layout) only for "pure flat" plugins. A
        // version dir with a SKILL.md manifest or a skills/ dir is a structured
        // plugin whose root .md files are docs/manifests, not agents — flat-scanning
        // it would mint phantoms like `engineering-skills:engineering-skills`.
        if (!existsSync(join(base, 'SKILL.md')) && !existsSync(join(base, 'skills'))) {
          items.push(...scanFlatAgents(base, 'plugin', plugin));
        }
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
