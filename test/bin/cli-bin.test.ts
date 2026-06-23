import { describe, test, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const bin = fileURLToPath(new URL('../../bin/skill-radar.mjs', import.meta.url));
const TMP_DB = '/tmp/sr-bin-test.sqlite';
afterAll(() => rmSync(TMP_DB, { force: true }));

function run(args: string[]) {
  // run from a temp cwd (NOT the repo root) so the npm-link-on-PATH reality is exercised:
  // the shim must resolve tsx + the CLI relative to itself, not the cwd.
  return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', cwd: tmpdir() });
}

describe('skill-radar bin shim', () => {
  test('--version prints the CLI version', () => {
    const r = run(['--version']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('0.1.0');
  });

  test('forwards a subcommand (report) against an isolated db', () => {
    const r = run(['report', '--db', TMP_DB]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('coverage report');
  });
});
