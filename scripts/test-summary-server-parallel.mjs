#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCommandsInParallel } from './test-summary-parallel-runner.mjs';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`test:summary:server:parallel
Builds the server workspace once, then runs the server unit and cucumber wrappers in parallel without rebuilding.

Usage: node scripts/test-summary-server-parallel.mjs

Flow:
  1. npm run build:summary:server
  2. npm run test:summary:server:unit -- --skip-build
  3. npm run test:summary:server:cucumber -- --skip-build
`);
  process.exit(0);
}

const prebuild = await runCommandsInParallel([
  {
    label: 'build:server',
    cmd: 'npm',
    args: ['run', 'build:summary:server'],
    cwd: rootDir,
    env: process.env,
  },
]);

if (prebuild.exitCode !== 0) {
  process.exit(prebuild.exitCode);
}

const results = await runCommandsInParallel([
  {
    label: 'server:unit',
    cmd: 'npm',
    args: ['run', 'test:summary:server:unit', '--', '--skip-build'],
    cwd: rootDir,
    env: process.env,
  },
  {
    label: 'server:cucumber',
    cmd: 'npm',
    args: ['run', 'test:summary:server:cucumber', '--', '--skip-build'],
    cwd: rootDir,
    env: process.env,
  },
]);

process.exit(results.exitCode);
