#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runCommand,
  runCommandsInParallel,
} from './test-summary-parallel-runner.mjs';
import {
  allocateWeightedParallelBudget,
  formatWorkerSummaryLine,
} from './test-parallelism.mjs';
import {
  TEST_DOCKER_TARGETS,
  acquireTestDockerLock,
  createComposeCommand,
  listComposeProjectResources,
  waitForHttpReadiness,
  waitForProjectRemoval,
} from './test-docker-harness-lifecycle.mjs';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const requestedServerUnitConcurrency = Number.parseInt(
  process.env.CODEINFO_ALL_PARALLEL_SERVER_UNIT_CONCURRENCY ?? '',
  10,
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
const serverUnitConcurrency =
  Number.isFinite(requestedServerUnitConcurrency) &&
  requestedServerUnitConcurrency > 0
    ? requestedServerUnitConcurrency
    : Math.min(sharedParallelBudget.workerCounts['server:unit'], 1);
const serverUnitConcurrencySource =
  Number.isFinite(requestedServerUnitConcurrency) &&
  requestedServerUnitConcurrency > 0
    ? 'env-override'
    : serverUnitConcurrency === sharedParallelBudget.workerCounts['server:unit']
      ? sharedParallelBudget.source
      : 'max-one-cap';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`test:summary:all:parallel
Builds the reusable client, server, and e2e compose artifacts first, then runs the main summary test harnesses in parallel without rebuilding shared artifacts.

Usage: node scripts/test-summary-all-parallel.mjs

Flow:
  1. npm run build:summary:client
  2. npm run build:summary:server
  3. npm run compose:build:summary
  4. npm run compose:e2e:build:summary
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
  - server:unit defaults to one worker during the normal parallel run and uses
    CODEINFO_TEST_TIMEOUT_MS=60000 so it remains isolated beside client,
    cucumber, and e2e
  - set CODEINFO_ALL_PARALLEL_SERVER_UNIT_CONCURRENCY to override the
    server:unit concurrency for stress or diagnosis runs
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
    workerCount: serverUnitConcurrency,
    source: serverUnitConcurrencySource,
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
    args: ['run', 'compose:e2e:build:summary'],
    cwd: rootDir,
    env: process.env,
  },
]);

if (prebuild.exitCode !== 0) {
  process.exit(prebuild.exitCode);
}

const runLifecycleCommand = async (target, action) => {
  const command = createComposeCommand({ rootDir, target, action });
  const result = await runCommand({
    ...command,
    label: `${target}:compose:${action}`,
  });
  if (result.code !== 0) {
    throw new Error(
      `${target} Compose ${action} failed with exit code ${result.code}`,
    );
  }
};

const verifyProjectRemoved = async (target) => {
  await waitForProjectRemoval({
    projectName: TEST_DOCKER_TARGETS[target].projectName,
    listResources: listComposeProjectResources,
  });
};

const startedTargets = new Set();
let dockerLock = null;
let testsExitCode = 1;
let lifecycleFailed = false;

try {
  dockerLock = await acquireTestDockerLock({
    onWait: (owner) => {
      console.log(
        `[all:parallel] waiting_for_test_docker_lock owner_pid=${owner.pid}`,
      );
    },
  });

  for (const target of ['cucumber', 'e2e']) {
    await runLifecycleCommand(target, 'down');
    await verifyProjectRemoved(target);
    startedTargets.add(target);
    await runLifecycleCommand(target, 'up');
    await waitForHttpReadiness({
      urls: TEST_DOCKER_TARGETS[target].readyUrls,
      onAttempt: ({ pending }) => {
        if (pending.length > 0) {
          console.log(
            `[all:parallel] ${target}_readiness_pending=${pending.join(',')}`,
          );
        }
      },
    });
    console.log(`[all:parallel] ${target}_infrastructure=ready`);
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
        CODEINFO_SERVER_UNIT_CONCURRENCY: String(serverUnitConcurrency),
        CODEINFO_TEST_TIMEOUT_MS: '60000',
      },
    },
    {
      label: 'server:cucumber',
      cmd: 'npm',
      args: [
        'run',
        'test:summary:server:cucumber',
        '--',
        '--skip-build',
        '--reuse-compose',
      ],
      cwd: rootDir,
      env: process.env,
    },
    {
      label: 'e2e',
      cmd: 'npm',
      args: [
        'run',
        'test:summary:e2e',
        '--',
        '--skip-compose-build',
        '--reuse-compose',
      ],
      cwd: rootDir,
      env: {
        ...process.env,
        PLAYWRIGHT_WORKERS: String(sharedParallelBudget.workerCounts.e2e),
      },
    },
  ]);
  testsExitCode = results.exitCode;
} catch (error) {
  lifecycleFailed = true;
  console.error(
    `[all:parallel] Docker lifecycle failed: ${
      error instanceof Error ? error.stack : String(error)
    }`,
  );
} finally {
  for (const target of [...startedTargets].reverse()) {
    try {
      await runLifecycleCommand(target, 'down');
      await verifyProjectRemoved(target);
      console.log(`[all:parallel] ${target}_infrastructure=removed`);
    } catch (error) {
      lifecycleFailed = true;
      console.error(
        `[all:parallel] ${target} teardown failed: ${
          error instanceof Error ? error.stack : String(error)
        }`,
      );
    }
  }
  await dockerLock?.release();
}

process.exit(lifecycleFailed ? 1 : testsExitCode);
