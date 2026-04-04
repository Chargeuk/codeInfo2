#!/usr/bin/env node
// Purpose: run the checked-in vendored Bats shell harness with the shared
// summary-wrapper protocol so shell proofs behave like the other repo wrappers.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSummaryLogStream,
  createSummaryWrapperProtocol,
  runLoggedCommand,
  writeLogLine,
} from './summary-wrapper-protocol.mjs';

const DEV_0000050_T08_SHELL_HARNESS_READY =
  'DEV-0000050:T08:shell_harness_ready';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const resultsDir = path.join(rootDir, 'logs', 'test-summaries');
const timestamp = new Date()
  .toISOString()
  .replaceAll(':', '-')
  .replaceAll('.', '-');
const logPath = path.join(resultsDir, `shell-tests-${timestamp}.log`);
const batsDir = path.join(rootDir, 'scripts', 'test', 'bats');
const vendorDir = path.join(batsDir, 'vendor');
const batsExecutable = path.join(vendorDir, 'bats-core', 'bin', 'bats');

const args = process.argv.slice(2);
const options = {
  files: [],
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
  if (arg === '--help') {
    console.log(
      'Usage: npm run test:summary:shell -- [--file <path>] [--file <path>]',
    );
    process.exit(0);
  }
  console.error(`Unknown argument: ${arg}`);
  process.exit(1);
}

const normalizeShellPath = (value) => {
  if (path.isAbsolute(value)) return value;
  const normalized = value.replace(/\\/g, '/');
  const withoutDotPrefix = normalized.startsWith('./')
    ? normalized.slice(2)
    : normalized;
  return withoutDotPrefix;
};

const listBatsFiles = async (dirPath) => {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.name !== 'vendor')
      .map(async (entry) => {
        const entryPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          return listBatsFiles(entryPath);
        }
        return entry.name.endsWith('.bats') ? [entryPath] : [];
      }),
  );
  return files.flat().sort();
};

const ensureFileExists = async (filePath) => {
  const stats = await fs.stat(filePath).catch(() => null);
  return stats?.isFile() ?? false;
};

const parseFailureNames = (output) => {
  const names = new Set();
  for (const match of output.matchAll(/not ok \d+ (.+)$/gim)) {
    names.add(match[1].trim().replace(/^-\s*/u, ''));
  }
  return [...names];
};

const parseCounts = (output) => {
  const passed = [...output.matchAll(/^ok \d+/gim)].length;
  const failed = [...output.matchAll(/^not ok \d+/gim)].length;
  const planMatch = output.match(/^1\.\.(\d+)$/gim);
  const total = planMatch
    ? Number(planMatch[planMatch.length - 1].slice(3))
    : passed + failed;
  return { total, passed, failed };
};

const logStream = createSummaryLogStream(logPath);
const protocol = createSummaryWrapperProtocol({
  wrapperName: 'shell',
  logPath,
  logDisplayPath: path.relative(rootDir, logPath),
  initialPhase: 'test',
});

protocol.startHeartbeat();

const requestedFiles = options.files.map((file) =>
  path.resolve(rootDir, normalizeShellPath(file)),
);

if (!(await ensureFileExists(batsExecutable))) {
  await new Promise((resolve) => logStream.end(resolve));
  console.error(`Missing vendored bats executable: ${batsExecutable}`);
  process.exit(1);
}

let suiteFiles = [];
if (requestedFiles.length > 0) {
  for (const filePath of requestedFiles) {
    if (!(await ensureFileExists(filePath))) {
      writeLogLine(logStream, `Missing requested shell suite: ${filePath}`);
      await new Promise((resolve) => logStream.end(resolve));
      protocol.emitFinal({
        status: 'failed',
        reason: 'missing_requested_suite',
      });
      console.error(`Missing requested shell suite: ${filePath}`);
      process.exit(1);
    }
    suiteFiles.push(filePath);
  }
} else {
  suiteFiles = await listBatsFiles(batsDir);
}

writeLogLine(
  logStream,
  `${DEV_0000050_T08_SHELL_HARNESS_READY} ${JSON.stringify({
    suiteCount: suiteFiles.length,
    vendorMode: 'vendored',
    targetedRunSupported: true,
  })}`,
);
writeLogLine(
  logStream,
  `[shell] suites: ${suiteFiles
    .map((filePath) => path.relative(rootDir, filePath))
    .join(', ')}`,
);

const batsEnv = {
  ...process.env,
  BATS_LIB_PATH: [vendorDir, process.env.BATS_LIB_PATH]
    .filter(Boolean)
    .join(path.delimiter),
};

const batsResult = await runLoggedCommand({
  cmd: batsExecutable,
  args: suiteFiles,
  cwd: rootDir,
  env: batsEnv,
  logStream,
  protocol,
  phase: 'test',
});

await new Promise((resolve) => logStream.end(resolve));

const { total, passed, failed } = parseCounts(batsResult.output);
const failingNames = parseFailureNames(batsResult.output);
const status = batsResult.code === 0 ? 'passed' : 'failed';
const ambiguousCounts = status === 'passed' && total === 0;

console.log(`[shell] tests run: ${total}`);
console.log(`[shell] passed: ${passed}`);
console.log(`[shell] failed: ${failed}`);
if (failingNames.length > 0) {
  console.log('[shell] failing tests:');
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

process.exit(batsResult.code);
