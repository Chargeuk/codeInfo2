#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCommandsInParallel } from './test-summary-parallel-runner.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`test:summary:client:parallel
Runs the repo's preferred client validation sequence: prebuild first, then the client test wrapper.

Usage: node scripts/test-summary-client-parallel.mjs

Flow:
  1. npm run build:summary:client
  2. npm run test:summary:client

Note:
  This is a convenience validation path in the parallel workflow family, not a true multi-harness parallel run.
`);
  process.exit(0);
}

const prebuild = await runCommandsInParallel([
  {
    label: 'build:client',
    cmd: 'npm',
    args: ['run', 'build:summary:client'],
    cwd: rootDir,
    env: process.env,
  },
]);

if (prebuild.exitCode !== 0) {
  process.exit(prebuild.exitCode);
}

const results = await runCommandsInParallel([
  {
    label: 'client',
    cmd: 'npm',
    args: ['run', 'test:summary:client'],
    cwd: rootDir,
    env: process.env,
  },
]);

process.exit(results.exitCode);
