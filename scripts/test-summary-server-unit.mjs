#!/usr/bin/env node
// Purpose: reduce token usage by printing only a compact server unit summary in the terminal.
// Use: `npm run test:summary:server:unit` from repository root.
// Behavior: builds the server workspace, runs node:test suites, streams full output to test-results/,
// and prints the shared heartbeat/final-action protocol plus total/passed/failed counts and failing test names when present.
// Optional targeting:
//   --file <path>       repeatable; run only selected test files.
//   --test-name <expr>  forwarded to node --test-name-pattern.
//   --skip-build        reuse an existing server build instead of rebuilding first.

import path from 'node:path';
import fs from 'node:fs/promises';

import { runLoggedCommand } from './summary-wrapper-protocol.mjs';
import { createSummaryWrapperRun } from './summary-wrapper-runner.mjs';
import {
  formatWorkerSummaryLine,
  resolveWorkerSetting,
} from './test-parallelism.mjs';
import { DEFAULT_SERVER_UNIT_TEST_FILES } from './test-summary-server-unit-files.mjs';
import {
  buildServerUnitProviderHomeRoot,
  buildServerUnitWrapperEnv,
} from './test-summary-server-unit-env.mjs';

const wrapper = createSummaryWrapperRun({
  wrapperName: 'server:unit',
  logBaseName: 'server-unit-tests',
  logDir: 'test-results',
  initialPhase: 'build',
  description:
    'Builds the server workspace and runs the node:test server unit/integration suites.',
  allowedFlags: [
    {
      name: 'help',
      alias: 'h',
      type: 'boolean',
      description:
        'Show wrapper help and exit without starting server unit tests.',
    },
    {
      name: 'file',
      type: 'value',
      multiple: true,
      description: 'Run one or more exact test files.',
    },
    {
      name: 'test-name',
      type: 'value',
      description: 'Filter tests with node --test-name-pattern.',
    },
    {
      name: 'skip-build',
      type: 'boolean',
      description:
        'Reuse an existing server build instead of running npm run build --workspace server first.',
    },
  ],
  examples: [
    'node scripts/test-summary-server-unit.mjs --help',
    'npm run test:summary:server:unit -- --file server/src/test/unit/ingest-models.test.ts',
    'npm run test:summary:server:unit -- --skip-build --file server/src/test/unit/ingest-models.test.ts',
  ],
});
const serverDir = path.join(wrapper.rootDir, 'server');

const parsedArgs = wrapper.parseArgs(process.argv.slice(2));

if (parsedArgs.helpRequested) {
  process.stdout.write(wrapper.renderHelp());
  await wrapper.closeLog({ promoteLatest: false });
  process.exit(0);
}

if (parsedArgs.error) {
  console.error(parsedArgs.error);
  process.exit(await wrapper.failCli(parsedArgs.error));
}

const options = {
  files: parsedArgs.values.file ?? [],
  testName: parsedArgs.values['test-name'] ?? undefined,
  skipBuild: parsedArgs.values['skip-build'] ?? false,
};
const serverUnitParallelism = resolveWorkerSetting(
  process.env.CODEINFO_SERVER_UNIT_CONCURRENCY,
);

const normalizeServerPath = (value) => {
  if (path.isAbsolute(value)) return value;
  const normalized = value.replace(/\\/g, '/');
  const withoutDotPrefix = normalized.startsWith('./')
    ? normalized.slice(2)
    : normalized;
  if (withoutDotPrefix.startsWith('server/')) {
    return withoutDotPrefix.slice('server/'.length);
  }
  return withoutDotPrefix;
};

const sumFromMatches = (output, pattern) =>
  [...output.matchAll(pattern)].reduce(
    (sum, match) => sum + Number(match[1]),
    0,
  );

const parseFailureNames = (output) => {
  const names = new Set();
  for (const match of output.matchAll(/not ok \d+ - (.+)$/gim)) {
    names.add(match[1].trim());
  }
  for (const match of output.matchAll(
    /^[ \t]*✖[ \t]+(.+?)(?: \(\d+(?:\.\d+)?ms\))?$/gm,
  )) {
    names.add(match[1].trim());
  }
  return [...names];
};

console.log(
  `[server:unit] ${formatWorkerSummaryLine({
    label: 'test_concurrency',
    availableCores: serverUnitParallelism.availableCores,
    workerCount: serverUnitParallelism.workerCount,
    source: serverUnitParallelism.source,
  })}`,
);
wrapper.appendLogSection('Parallelism', [
  formatWorkerSummaryLine({
    label: 'test_concurrency',
    availableCores: serverUnitParallelism.availableCores,
    workerCount: serverUnitParallelism.workerCount,
    source: serverUnitParallelism.source,
  }),
]);
wrapper.startHeartbeat();

let buildResult = {
  code: 0,
  output: '',
};
if (options.skipBuild) {
  wrapper.protocol.setPhase('test');
  wrapper.appendLogSection('Build', [
    'build_step=skipped',
    'reason=wrapper_flag_skip_build',
  ]);
} else {
  buildResult = await runLoggedCommand({
    cmd: 'npm',
    args: ['run', 'build', '--workspace', 'server'],
    cwd: wrapper.rootDir,
    logStream: wrapper.logStream,
    protocol: wrapper.protocol,
    phase: 'build',
    bannerPrefix: '',
  });
}

const unitFiles =
  options.files.length > 0
    ? options.files.map((file) => normalizeServerPath(file))
    : DEFAULT_SERVER_UNIT_TEST_FILES;

const testArgs = [
  '--test',
  '--experimental-test-isolation=process',
  `--test-concurrency=${serverUnitParallelism.workerCount}`,
];
if (options.testName) {
  testArgs.push('--test-name-pattern', options.testName);
}
testArgs.push(...unitFiles);

const testProviderHomeRoot = buildServerUnitProviderHomeRoot();
const unitEnv = {
  ...buildServerUnitWrapperEnv(process.env, { testProviderHomeRoot }),
};

let exitCode = buildResult.code;
let output = buildResult.output;
let testForcedReason = '';
let testLastProgressLine = '';
try {
  if (buildResult.code === 0) {
    const testResult = await runLoggedCommand({
      cmd: 'node',
      args: testArgs,
      cwd: serverDir,
      env: unitEnv,
      logStream: wrapper.logStream,
      protocol: wrapper.protocol,
      phase: 'test',
      semanticProgressPatterns: [
        /^# Subtest: /,
        /^ok \d+ - /,
        /^not ok \d+ - /,
      ],
      terminalSummaryPatterns: [/^1\.\./, /^# tests /, /^# pass /, /^# fail /],
    });
    output += testResult.output;
    exitCode = testResult.code;
    testForcedReason = testResult.forcedReason ?? '';
    testLastProgressLine = testResult.lastProgressLine ?? '';
  }
} finally {
  await wrapper.closeLog();
  await fs.rm(testProviderHomeRoot, { recursive: true, force: true });
}

if (buildResult.code !== 0) {
  console.log('[server:unit] tests run: 0');
  console.log('[server:unit] passed: 0');
  console.log('[server:unit] failed: 1');
  console.log('[server:unit] failing tests:');
  console.log('- build failed');
  wrapper.protocol.emitFinal({
    status: 'failed',
    reason: 'build_failed',
  });
  process.exit(buildResult.code);
}

const total = sumFromMatches(output, /^# tests (\d+)$/gim);
const passed = sumFromMatches(output, /^# pass (\d+)$/gim);
const failed = sumFromMatches(output, /^# fail (\d+)$/gim);
const failingNames = parseFailureNames(output);
const status = exitCode === 0 ? 'passed' : 'failed';
const ambiguousCounts = status === 'passed' && total === 0;
const finalReason =
  testForcedReason === 'terminal_summary_without_close'
    ? 'terminal_summary_without_close'
    : testForcedReason === 'semantic_progress_stalled'
      ? 'semantic_progress_stalled'
      : status === 'passed'
        ? ambiguousCounts
          ? 'ambiguous_counts'
          : 'clean_success'
        : 'test_failed';

console.log(`[server:unit] tests run: ${total}`);
console.log(`[server:unit] passed: ${passed}`);
console.log(`[server:unit] failed: ${failed}`);
if (failingNames.length > 0) {
  console.log('[server:unit] failing tests:');
  for (const name of failingNames) {
    console.log(`- ${name}`);
  }
}

wrapper.protocol.emitFinal({
  status,
  ambiguousCounts,
  reason: finalReason,
  extraFields: testForcedReason
    ? { last_progress: testLastProgressLine || undefined }
    : {},
});

process.exit(exitCode);
