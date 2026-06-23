#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Buildless launcher: run the TypeScript CLI directly via tsx, forwarding args + stdio.
// Resolve tsx + the CLI relative to THIS file (a bare 'tsx' specifier on --import would resolve
// against the cwd, which breaks when `skill-radar` is invoked from any dir other than the repo root).
const require = createRequire(import.meta.url);
const tsx = pathToFileURL(require.resolve('tsx')).href;
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const result = spawnSync(process.execPath, ['--import', tsx, cli, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
