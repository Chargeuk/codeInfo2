#!/usr/bin/env node
// Purpose: reduce token usage by printing only a compact client test summary in the terminal.
// Use: `npm run test:summary:client` from the repository root.
// Behavior: executes the existing client workspace test command, streams full output to test-results/ for inspection,
// and prints the shared heartbeat/final-action protocol plus total/passed/failed counts and failing test names when present.
// Optional targeting:
//   --file <path>       repeatable; mapped to Jest --runTestsByPath
//   --subset <pattern>  mapped to Jest --testPathPatterns
//   --test-name <expr>  mapped to Jest --testNamePattern
// Why: this keeps routine AI-assisted runs low-noise while still preserving full logs when failures need diagnosis.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { runLoggedCommand } from './summary-wrapper-protocol.mjs';
import {
  createSummaryWrapperRun,
  resolveWritableYarnEnv,
} from './summary-wrapper-runner.mjs';

const wrapper = createSummaryWrapperRun({
  wrapperName: 'client',
  logBaseName: 'client-tests',
  logDir: 'test-results',
  initialPhase: 'test',
  description:
    'Runs the client workspace test command with compact wrapper output and saved full logs.',
  allowedFlags: [
    {
      name: 'help',
      alias: 'h',
      type: 'boolean',
      description: 'Show wrapper help and exit without starting client tests.',
    },
    {
      name: 'file',
      type: 'value',
      multiple: true,
      description:
        'Run one or more exact Jest test files with --runTestsByPath.',
    },
    {
      name: 'subset',
      type: 'value',
      description: 'Filter test files with Jest --testPathPatterns.',
    },
    {
      name: 'test-name',
      type: 'value',
      description: 'Filter assertions with Jest --testNamePattern.',
    },
  ],
  examples: [
    'node scripts/test-summary-client.mjs --help',
    'npm run test:summary:client -- --subset smoke',
    'npm run test:summary:client -- --file client/src/__tests__/example.test.tsx',
  ],
});
const resultsDir = wrapper.logDirPath;
const jsonPath = path.join(
  resultsDir,
  `client-tests-${wrapper.timestamp}.json`,
);

const parsedArgs = wrapper.parseArgs(process.argv.slice(2));

if (parsedArgs.helpRequested) {
  process.stdout.write(wrapper.renderHelp());
  await wrapper.closeLog();
  process.exit(0);
}

if (parsedArgs.error) {
  console.error(parsedArgs.error);
  process.exit(await wrapper.failCli(parsedArgs.error));
}

const options = {
  files: parsedArgs.values.file ?? [],
  subset: parsedArgs.values.subset ?? undefined,
  testName: parsedArgs.values['test-name'] ?? undefined,
};

const normalizeClientPath = (value) => {
  if (path.isAbsolute(value)) return value;
  const normalized = value.replace(/\\/g, '/');
  const withoutDotPrefix = normalized.startsWith('./')
    ? normalized.slice(2)
    : normalized;
  if (withoutDotPrefix.startsWith('client/')) {
    return withoutDotPrefix.slice('client/'.length);
  }
  return withoutDotPrefix;
};

const jestArgs = [];
if (options.files.length > 0) {
  jestArgs.push(
    '--runTestsByPath',
    ...options.files.map((file) => normalizeClientPath(file)),
  );
}
if (options.subset) {
  jestArgs.push('--testPathPatterns', options.subset);
}
if (options.testName) {
  jestArgs.push('--testNamePattern', options.testName);
}

wrapper.startHeartbeat();

// Ensure sufficient Node heap for large client test runs when the wrapper spawns npm/jest
process.env.NODE_OPTIONS =
  process.env.NODE_OPTIONS || '--max-old-space-size=8192';

const clientTestEnv = resolveWritableYarnEnv();
const result = await runLoggedCommand({
  cmd: 'npm',
  args: [
    'run',
    'test',
    '--workspace',
    'client',
    '--',
    '--runInBand',
    '--silent',
    ...jestArgs,
    '--json',
    '--outputFile',
    jsonPath,
  ],
  cwd: wrapper.rootDir,
  env: clientTestEnv,
  logStream: wrapper.logStream,
  protocol: wrapper.protocol,
  phase: 'test',
  bannerPrefix: '',
  semanticProgressPatterns: [/^PASS /, /^FAIL /, /^Tests:/, /^Test Suites:/],
  terminalSummaryPatterns: [/^Tests:/, /^Test Suites:/, /^Ran all test suites/],
});

await wrapper.closeLog();

let total = 0;
let passed = 0;
let failed = 0;
const failingNames = new Set();
let parseFailed = false;

try {
  const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
  total = Number(parsed?.numTotalTests ?? 0);
  passed = Number(parsed?.numPassedTests ?? 0);
  failed = Number(parsed?.numFailedTests ?? 0);
  for (const suite of parsed?.testResults ?? []) {
    for (const assertion of suite?.assertionResults ?? []) {
      if (assertion?.status === 'failed') {
        failingNames.add(assertion.fullName || assertion.title || suite.name);
      }
    }
  }
} catch {
  parseFailed = true;
  const failMatches = result.output.matchAll(/^FAIL\s+(.+)$/gm);
  for (const match of failMatches) {
    failingNames.add(match[1].trim());
  }
}

console.log(`[client] tests run: ${total}`);
console.log(`[client] passed: ${passed}`);
console.log(`[client] failed: ${failed}`);
if (failingNames.size > 0) {
  console.log('[client] failing tests:');
  for (const name of failingNames) {
    console.log(`- ${name}`);
  }
}

const status = result.code === 0 ? 'passed' : 'failed';
const ambiguousCounts = parseFailed || (status === 'passed' && total === 0);
const finalReason =
  result.forcedReason === 'terminal_summary_without_close'
    ? 'terminal_summary_without_close'
    : result.forcedReason === 'semantic_progress_stalled'
      ? 'semantic_progress_stalled'
      : status === 'passed'
        ? ambiguousCounts
          ? 'ambiguous_counts'
          : 'clean_success'
        : 'test_failed';

wrapper.protocol.emitFinal({
  status,
  ambiguousCounts,
  reason: finalReason,
  extraFields: result.forcedReason
    ? { last_progress: result.lastProgressLine || undefined }
    : {},
});

process.exit(result.code);
