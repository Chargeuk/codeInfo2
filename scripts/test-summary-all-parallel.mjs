#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCommandsInParallel } from './test-summary-parallel-runner.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`test:summary:all:parallel
Builds the reusable client, server, and e2e compose artifacts first, then runs the main summary test harnesses in parallel without rebuilding shared artifacts.

Usage: node scripts/test-summary-all-parallel.mjs

Flow:
  1. npm run build:summary:client
  2. npm run build:summary:server
  3. npm run compose:build:summary
  4. npm run test:summary:client
  5. npm run test:summary:server:unit -- --skip-build
  6. npm run test:summary:server:cucumber -- --skip-build
  7. npm run test:summary:e2e -- --skip-compose-build
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
  {
    label: 'build:server',
    cmd: 'npm',
    args: ['run', 'build:summary:server'],
    cwd: rootDir,
    env: process.env,
  },
  {
    label: 'compose:build',
    cmd: 'npm',
    args: ['run', 'compose:build:summary'],
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
    args: ['run', 'test:summary:client', '--', '--max-workers', '4'],
    cwd: rootDir,
    env: process.env,
  },
  {
    label: 'server:unit',
    cmd: 'npm',
    args: ['run', 'test:summary:server:unit', '--', '--skip-build'],
    cwd: rootDir,
    env: {
      ...process.env,
      CODEINFO_SERVER_UNIT_CONCURRENCY: '8',
    },
  },
  {
    label: 'server:cucumber',
    cmd: 'npm',
    args: ['run', 'test:summary:server:cucumber', '--', '--skip-build'],
    cwd: rootDir,
    env: process.env,
  },
  {
    label: 'e2e',
    cmd: 'npm',
    args: ['run', 'test:summary:e2e', '--', '--skip-compose-build'],
    cwd: rootDir,
    env: {
      ...process.env,
      PLAYWRIGHT_WORKERS: '4',
    },
  },
]);

process.exit(results.exitCode);
