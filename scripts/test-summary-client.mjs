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
import { fileURLToPath } from 'node:url';

import {
  createSummaryLogStream,
  createSummaryWrapperProtocol,
  runLoggedCommand,
} from './summary-wrapper-protocol.mjs';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const resultsDir = path.join(rootDir, 'test-results');
const timestamp = new Date()
  .toISOString()
  .replaceAll(':', '-')
  .replaceAll('.', '-');
const logPath = path.join(resultsDir, `client-tests-${timestamp}.log`);
const jsonPath = path.join(resultsDir, `client-tests-${timestamp}.json`);

const args = process.argv.slice(2);
const options = {
  files: [],
  subset: undefined,
  testName: undefined,
};

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--file') {
    const value = args[i + 1];
    if (!value) {
      console.error('Missing value for --file');
      process.exit(1);
    }
    options.files.push(value);
    i += 1;
    continue;
  }
  if (arg === '--subset') {
    const value = args[i + 1];
    if (!value) {
      console.error('Missing value for --subset');
      process.exit(1);
    }
    options.subset = value;
    i += 1;
    continue;
  }
  if (arg === '--test-name') {
    const value = args[i + 1];
    if (!value) {
      console.error('Missing value for --test-name');
      process.exit(1);
    }
    options.testName = value;
    i += 1;
    continue;
  }
  if (arg === '--help') {
    console.log(
      'Usage: npm run test:summary:client -- [--file <path>] [--subset <pattern>] [--test-name <pattern>]',
    );
    process.exit(0);
  }
  console.error(`Unknown argument: ${arg}`);
  process.exit(1);
}

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

const logStream = createSummaryLogStream(logPath);
const protocol = createSummaryWrapperProtocol({
  wrapperName: 'client',
  logPath,
  logDisplayPath: path.relative(rootDir, logPath),
  initialPhase: 'test',
});

protocol.startHeartbeat();

const result = await runLoggedCommand({
  cmd: 'npm',
  args: [
    'run',
    'test',
    '--workspace',
    'client',
    '--',
    ...jestArgs,
    '--json',
    '--outputFile',
    jsonPath,
  ],
  cwd: rootDir,
  logStream,
  protocol,
  phase: 'test',
  bannerPrefix: '',
});

await new Promise((resolve) => logStream.end(resolve));

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

protocol.emitFinal({
  status,
  ambiguousCounts,
  reason:
    status === 'passed'
      ? ambiguousCounts
        ? 'ambiguous_counts'
        : 'clean_success'
      : 'test_failed',
});

process.exit(result.code);
