import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
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

  test('inventories plugin agents stored flat at the version root (voltagent layout)', () => {
    const cache = join(scratch, 'cache');
    const base = join(cache, 'voltagent-subagents', 'voltagent-core-dev', '1.0.2');
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'frontend-developer.md'),
      `---\nname: frontend-developer\ndescription: build frontend apps across React, Vue, Angular\ntools: Read, Write\n---\nbody`);

    const items = scanInventory({ userDir: join(scratch, 'nouser'), pluginsCacheDir: cache });
    const agent = items.find((i) => i.kind === 'agent' && i.name === 'voltagent-core-dev:frontend-developer');
    expect(agent).toMatchObject({ scope: 'plugin', description: 'build frontend apps across React, Vue, Angular' });
  });

  test('does not inventory README/doc files at the plugin root, even with frontmatter', () => {
    const cache = join(scratch, 'cache');
    const base = join(cache, 'voltagent-subagents', 'voltagent-core-dev', '1.0.2');
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'backend-developer.md'),
      `---\nname: backend-developer\ndescription: build server-side APIs\n---\nbody`);
    writeFileSync(join(base, 'README.md'),
      `---\nname: core-dev\ndescription: A collection of core development subagents\n---\n# Core Development Subagents`);
    writeFileSync(join(base, 'CHANGELOG.md'),
      `---\nname: changelog\ndescription: release notes\n---\n## 1.0.2`);

    const items = scanInventory({ userDir: join(scratch, 'nouser'), pluginsCacheDir: cache });
    expect(items.some((i) => i.kind === 'agent' && i.name === 'voltagent-core-dev:backend-developer')).toBe(true);
    expect(items.some((i) => i.name === 'voltagent-core-dev:core-dev')).toBe(false);
    expect(items.some((i) => i.name === 'voltagent-core-dev:changelog')).toBe(false);
  });

  test('inventories a plugin skill whose skills/<name> dir is a symlink (academic-research-skills layout)', () => {
    const cache = join(scratch, 'cache');
    const base = join(cache, 'mp', 'ars', '1.0.0');
    // real skill dir at the version root, exposed under skills/ via a symlink
    mkdirSync(join(base, 'academic-paper'), { recursive: true });
    writeFileSync(join(base, 'academic-paper', 'SKILL.md'),
      `---\nname: academic-paper\ndescription: draft an academic paper\n---\n`);
    mkdirSync(join(base, 'skills'), { recursive: true });
    symlinkSync(join('..', 'academic-paper'), join(base, 'skills', 'academic-paper'));

    const items = scanInventory({ userDir: join(scratch, 'nouser'), pluginsCacheDir: cache });
    expect(items.find((i) => i.kind === 'skill' && i.name === 'ars:academic-paper'))
      .toMatchObject({ scope: 'plugin', description: 'draft an academic paper' });
  });

  test('inventories agents nested under <version>/<component>/agents/ as well as top-level agents/', () => {
    const cache = join(scratch, 'cache');
    const base = join(cache, 'mp', 'ars', '1.0.0');
    mkdirSync(join(base, 'agents'), { recursive: true });
    writeFileSync(join(base, 'agents', 'intake.md'), `---\nname: intake\ndescription: intake agent\n---\n`);
    mkdirSync(join(base, 'academic-paper', 'agents'), { recursive: true });
    writeFileSync(join(base, 'academic-paper', 'agents', 'peer_reviewer.md'),
      `---\nname: peer_reviewer\ndescription: reviews the paper\n---\n`);
    // same agent name present at root agents/ AND a nested agents/ → exactly one item
    writeFileSync(join(base, 'agents', 'shared.md'), `---\nname: shared\ndescription: shared agent\n---\n`);
    mkdirSync(join(base, 'deep-research', 'agents'), { recursive: true });
    writeFileSync(join(base, 'deep-research', 'agents', 'shared.md'), `---\nname: shared\ndescription: shared agent\n---\n`);

    const items = scanInventory({ userDir: join(scratch, 'nouser'), pluginsCacheDir: cache });
    expect(items.some((i) => i.kind === 'agent' && i.name === 'ars:intake')).toBe(true);
    expect(items.some((i) => i.kind === 'agent' && i.name === 'ars:peer_reviewer')).toBe(true);
    expect(items.filter((i) => i.name === 'ars:shared').length).toBe(1);
  });

  test('does not double-count an agent present both flat and under agents/', () => {
    const cache = join(scratch, 'cache');
    const base = join(cache, 'mp', 'dual-plugin', '2.0.0');
    mkdirSync(join(base, 'agents'), { recursive: true });
    const body = `---\nname: helper\ndescription: a helper agent\n---\nbody`;
    writeFileSync(join(base, 'agents', 'helper.md'), body);
    writeFileSync(join(base, 'helper.md'), body);

    const items = scanInventory({ userDir: join(scratch, 'nouser'), pluginsCacheDir: cache });
    expect(items.filter((i) => i.name === 'dual-plugin:helper').length).toBe(1);
  });

  test('inventories agents under a symlinked agents/ directory', () => {
    const cache = join(scratch, 'cache');
    const base = join(cache, 'mp', 'sym', '1.0.0');
    mkdirSync(join(base, 'real-agents'), { recursive: true });
    writeFileSync(join(base, 'real-agents', 'helper.md'), `---\nname: helper\ndescription: a helper\n---\n`);
    symlinkSync('real-agents', join(base, 'agents')); // <version>/agents -> real-agents (sibling)

    const items = scanInventory({ userDir: join(scratch, 'nouser'), pluginsCacheDir: cache });
    expect(items.some((i) => i.kind === 'agent' && i.name === 'sym:helper')).toBe(true);
  });

  test('does not inventory README/doc files sitting inside an agents/ directory', () => {
    const cache = join(scratch, 'cache');
    const base = join(cache, 'mp', 'docly', '1.0.0', 'agents');
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'real-agent.md'), `---\nname: real-agent\ndescription: an agent\n---\n`);
    writeFileSync(join(base, 'README.md'), `# how these agents work\n`); // no frontmatter, must be skipped

    const items = scanInventory({ userDir: join(scratch, 'nouser'), pluginsCacheDir: cache });
    expect(items.some((i) => i.name === 'docly:real-agent')).toBe(true);
    expect(items.some((i) => i.name === 'docly:README')).toBe(false);
  });

  test('does not turn a structured plugin\'s root SKILL.md into a phantom agent', () => {
    const cache = join(scratch, 'cache');
    const base = join(cache, 'mp', 'eng', '1.0.0');
    mkdirSync(base, { recursive: true });
    // a multi-skill plugin manifest at the version root (has name+description frontmatter)
    writeFileSync(join(base, 'SKILL.md'), `---\nname: eng\ndescription: 23 engineering agent skills\n---\n`);
    // the real agents live nested under a component dir
    mkdirSync(join(base, 'playwright-pro', 'agents'), { recursive: true });
    writeFileSync(join(base, 'playwright-pro', 'agents', 'test-architect.md'),
      `---\nname: test-architect\ndescription: designs tests\n---\n`);

    const items = scanInventory({ userDir: join(scratch, 'nouser'), pluginsCacheDir: cache });
    expect(items.some((i) => i.name === 'eng:eng')).toBe(false);
    expect(items.some((i) => i.kind === 'agent' && i.name === 'eng:test-architect')).toBe(true);
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
