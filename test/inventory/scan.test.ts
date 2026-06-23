import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFrontmatter, scanInventory, writeInventory } from '../../src/inventory/scan';
import { openDb } from '../../src/db/index';

describe('parseFrontmatter', () => {
  test('reads name + description, tolerating colons in the value', () => {
    const md = `---\nname: my-skill\ndescription: Use when X: do Y, not Z\n---\nbody`;
    const fm = parseFrontmatter(md);
    expect(fm.name).toBe('my-skill');
    expect(fm.description).toBe('Use when X: do Y, not Z');
  });

  test('returns empty object when there is no frontmatter', () => {
    expect(parseFrontmatter('# just a heading')).toEqual({});
  });
});

let userDir: string;
let projDir: string;
let scratch: string;

beforeEach(() => {
  userDir = mkdtempSync(join(tmpdir(), 'sr-user-'));
  projDir = mkdtempSync(join(tmpdir(), 'sr-proj-'));
  scratch = mkdtempSync(join(tmpdir(), 'sr-x-'));
});
afterEach(() => {
  rmSync(userDir, { recursive: true, force: true });
  rmSync(projDir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe('scanInventory', () => {
  test('discovers user/project/plugin skills+agents and mcp servers with correct kind/scope/name', () => {
    mkdirSync(join(userDir, 'skills', 'graphify'), { recursive: true });
    writeFileSync(join(userDir, 'skills', 'graphify', 'SKILL.md'),
      `---\nname: graphify\ndescription: turn anything into a knowledge graph\n---\n`);
    mkdirSync(join(userDir, 'agents'), { recursive: true });
    writeFileSync(join(userDir, 'agents', 'explorer.md'),
      `---\nname: Explore\ndescription: read-only search agent\n---\n`);
    writeFileSync(join(userDir, 'settings.json'),
      JSON.stringify({ mcpServers: { 'Claude Preview': { command: 'x' } } }));
    const claudeJson = join(scratch, 'claude.json');
    writeFileSync(claudeJson, JSON.stringify({ mcpServers: { 'mcp-registry': { command: 'y' } } }));
    mkdirSync(join(projDir, 'skills', 'verify'), { recursive: true });
    writeFileSync(join(projDir, 'skills', 'verify', 'SKILL.md'),
      `---\nname: verify\ndescription: run the app to verify a change\n---\n`);
    const cache = join(scratch, 'cache');
    mkdirSync(join(cache, 'sp-marketplace', 'superpowers', '5.1.0', 'skills', 'brainstorming'), { recursive: true });
    writeFileSync(join(cache, 'sp-marketplace', 'superpowers', '5.1.0', 'skills', 'brainstorming', 'SKILL.md'),
      `---\nname: brainstorming\ndescription: explore ideas\n---\n`);
    mkdirSync(join(cache, 'sl-marketplace', 'ship-loop', '1.0.0', 'agents'), { recursive: true });
    writeFileSync(join(cache, 'sl-marketplace', 'ship-loop', '1.0.0', 'agents', 'impl.md'),
      `---\nname: ship-implementer\ndescription: implements one feature\n---\n`);

    const items = scanInventory({
      userDir, projectDir: projDir, pluginsCacheDir: cache, userMcpJson: claudeJson,
    });
    const find = (kind: string, name: string) => items.find((i) => i.kind === kind && i.name === name);

    expect(find('skill', 'graphify')).toMatchObject({ scope: 'user', description: 'turn anything into a knowledge graph' });
    expect(find('agent', 'Explore')).toMatchObject({ scope: 'user' });
    expect(find('mcp', 'Claude Preview')).toMatchObject({ scope: 'user' });
    expect(find('mcp', 'mcp-registry')).toMatchObject({ scope: 'user' });
    expect(find('skill', 'verify')).toMatchObject({ scope: 'project' });
    expect(find('skill', 'superpowers:brainstorming')).toMatchObject({ scope: 'plugin' });
    expect(find('agent', 'ship-loop:ship-implementer')).toMatchObject({ scope: 'plugin' });
  });

  test('returns [] when nothing exists', () => {
    expect(scanInventory({ userDir: join(userDir, 'nope'), projectDir: join(projDir, 'nope') })).toEqual([]);
  });
});

describe('writeInventory', () => {
  test('replaces inventory rows and is idempotent', () => {
    const db = openDb(':memory:');
    const items = [{ kind: 'skill', name: 'foo', scope: 'user', description: 'd', triggers: null, path: '/p' } as const];
    writeInventory(db, items as any, '2026-06-23T00:00:00.000Z');
    writeInventory(db, items as any, '2026-06-23T01:00:00.000Z');
    const c = db.prepare(`SELECT COUNT(*) AS c FROM inventory`).get() as { c: number };
    expect(c.c).toBe(1);
  });
});
