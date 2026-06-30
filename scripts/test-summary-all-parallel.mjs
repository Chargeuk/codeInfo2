#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCommandsInParallel } from './test-summary-parallel-runner.mjs';
import {
  allocateWeightedParallelBudget,
  formatWorkerSummaryLine,
} from './test-parallelism.mjs';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const sharedParallelBudget = allocateWeightedParallelBudget({
  budgetFraction: 0.6,
  weights: {
    client: 3,
    e2e: 3,
    'server:unit': 12,
  },
  reservedWorkers: {
    'server:cucumber': 1,
  },
});

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`test:summary:all:parallel
Builds the reusable client, server, and e2e compose artifacts first, then runs the main summary test harnesses in parallel without rebuilding shared artifacts.

Usage: node scripts/test-summary-all-parallel.mjs

Flow:
  1. npm run build:summary:client
  2. npm run build:summary:server
  3. npm run compose:build:summary
  4. npm run compose:e2e:build
  5. npm run test:summary:client
  6. npm run test:summary:server:unit -- --skip-build
  7. npm run test:summary:server:cucumber -- --skip-build
  8. npm run test:summary:e2e -- --skip-compose-build

Shared worker budget:
  Uses 60% of available cores as a shared worker budget.
  - server:cucumber always reserves 1 worker from that budget
  - the remaining worker budget is allocated with a server-heavy split:
  - server:unit weight 12
  - client weight 3
  - e2e weight 3
`);
  process.exit(0);
}

console.log(
  `[all:parallel] shared_budget=${sharedParallelBudget.budget} effective_budget=${sharedParallelBudget.effectiveBudget} available_cores=${sharedParallelBudget.availableCores} source=${sharedParallelBudget.source}`,
);
console.log(
  `[all:parallel] reserved_budget=${sharedParallelBudget.reservedBudget} remaining_budget=${sharedParallelBudget.weightedBudget} available_cores=${sharedParallelBudget.availableCores} source=${sharedParallelBudget.source}`,
);
console.log(
  `[all:parallel] ${formatWorkerSummaryLine({
    label: 'client_workers',
    availableCores: sharedParallelBudget.availableCores,
    workerCount: sharedParallelBudget.workerCounts.client,
    source: sharedParallelBudget.source,
  })}`,
);
console.log(
  `[all:parallel] ${formatWorkerSummaryLine({
    label: 'server_unit_concurrency',
    availableCores: sharedParallelBudget.availableCores,
    workerCount: sharedParallelBudget.workerCounts['server:unit'],
    source: sharedParallelBudget.source,
  })}`,
);
console.log(
  `[all:parallel] ${formatWorkerSummaryLine({
    label: 'server_cucumber_workers',
    availableCores: sharedParallelBudget.availableCores,
    workerCount: sharedParallelBudget.workerCounts['server:cucumber'],
    source: sharedParallelBudget.source,
  })}`,
);
console.log(
  `[all:parallel] ${formatWorkerSummaryLine({
    label: 'playwright_workers',
    availableCores: sharedParallelBudget.availableCores,
    workerCount: sharedParallelBudget.workerCounts.e2e,
    source: sharedParallelBudget.source,
  })}`,
);

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
  {
    label: 'compose:e2e:build',
    cmd: 'npm',
    args: ['run', 'compose:e2e:build'],
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
    args: [
      'run',
      'test:summary:client',
      '--',
      '--max-workers',
      String(sharedParallelBudget.workerCounts.client),
    ],
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
      CODEINFO_SERVER_UNIT_CONCURRENCY: String(
        sharedParallelBudget.workerCounts['server:unit'],
      ),
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
      PLAYWRIGHT_WORKERS: String(sharedParallelBudget.workerCounts.e2e),
    },
  },
]);

process.exit(results.exitCode);
