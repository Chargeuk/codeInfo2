#!/usr/bin/env node
// Purpose: reduce token usage by printing only a compact server unit summary in the terminal.
// Use: `npm run test:summary:server:unit` from repository root.
// Behavior: builds the server workspace, runs node:test suites, streams full output to test-results/,
// and prints the shared heartbeat/final-action protocol plus total/passed/failed counts and failing test names when present.
// Optional targeting:
//   --file <path>       repeatable; run only selected test files.
//   --test-name <expr>  forwarded to node --test-name-pattern.

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
const serverDir = path.join(rootDir, 'server');
const resultsDir = path.join(rootDir, 'test-results');
const timestamp = new Date()
  .toISOString()
  .replaceAll(':', '-')
  .replaceAll('.', '-');
const logPath = path.join(resultsDir, `server-unit-tests-${timestamp}.log`);

const args = process.argv.slice(2);
const options = {
  files: [],
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
      'Usage: npm run test:summary:server:unit -- [--file <path>] [--test-name <pattern>]',
    );
    process.exit(0);
  }
  console.error(`Unknown argument: ${arg}`);
  process.exit(1);
}

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

const logStream = createSummaryLogStream(logPath);
const protocol = createSummaryWrapperProtocol({
  wrapperName: 'server:unit',
  logPath,
  logDisplayPath: path.relative(rootDir, logPath),
  initialPhase: 'build',
});

protocol.startHeartbeat();

const buildResult = await runLoggedCommand({
  cmd: 'npm',
  args: ['run', 'build', '--workspace', 'server'],
  cwd: rootDir,
  logStream,
  protocol,
  phase: 'build',
  bannerPrefix: '',
});

const defaultFiles = [
  'src/test/unit/*.test.ts',
  'src/test/integration/*.test.ts',
  'src/test/mcp2/**/*.test.ts',
];
const unitFiles =
  options.files.length > 0
    ? options.files.map((file) => normalizeServerPath(file))
    : defaultFiles;

const testArgs = ['--test', '--test-concurrency=1'];
if (options.testName) {
  testArgs.push('--test-name-pattern', options.testName);
}
testArgs.push(...unitFiles);

const unitEnv = {
  ...process.env,
  CODEINFO_LOG_FILE_PATH: '../logs/server-test.log',
  CODEINFO_CHROMA_URL: '',
  CODEINFO_MONGO_URI: '',
  TS_NODE_DEBUG: 'false',
  TS_NODE_LOG_ERROR: 'true',
  TS_NODE_FILES: 'true',
  TS_NODE_PROJECT: './tsconfig.json',
  NODE_OPTIONS:
    '--import ./scripts/register-ts-node-esm-loader.mjs --trace-uncaught --disable-warning=DEP0180',
};

let exitCode = buildResult.code;
let output = buildResult.output;
if (buildResult.code === 0) {
  const testResult = await runLoggedCommand({
    cmd: 'node',
    args: testArgs,
    cwd: serverDir,
    env: unitEnv,
    logStream,
    protocol,
    phase: 'test',
  });
  output += testResult.output;
  exitCode = testResult.code;
}

await new Promise((resolve) => logStream.end(resolve));

if (buildResult.code !== 0) {
  console.log('[server:unit] tests run: 0');
  console.log('[server:unit] passed: 0');
  console.log('[server:unit] failed: 1');
  console.log('[server:unit] failing tests:');
  console.log('- build failed');
  protocol.emitFinal({
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

console.log(`[server:unit] tests run: ${total}`);
console.log(`[server:unit] passed: ${passed}`);
console.log(`[server:unit] failed: ${failed}`);
if (failingNames.length > 0) {
  console.log('[server:unit] failing tests:');
  for (const name of failingNames) {
    console.log(`- ${name}`);
  }
}

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

process.exit(exitCode);
