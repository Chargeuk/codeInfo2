#!/usr/bin/env node
// Purpose: run the checked-in vendored Bats shell harness with the shared
// summary-wrapper protocol so shell proofs behave like the other repo wrappers.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runLoggedCommand, writeLogLine } from './summary-wrapper-protocol.mjs';
import { createSummaryWrapperRun } from './summary-wrapper-runner.mjs';

const DEV_0000050_T08_SHELL_HARNESS_READY =
  'DEV-0000050:T08:shell_harness_ready';

const wrapper = createSummaryWrapperRun({
  wrapperName: 'shell',
  logBaseName: 'shell-tests',
  logDir: 'logs/test-summaries',
  initialPhase: 'test',
  description:
    'Runs the vendored Bats shell harness with compact wrapper output and saved full logs.',
  allowedFlags: [
    {
      name: 'help',
      alias: 'h',
      type: 'boolean',
      description: 'Show wrapper help and exit without starting shell tests.',
    },
    {
      name: 'file',
      type: 'value',
      multiple: true,
      description: 'Run one or more selected Bats suite files.',
    },
  ],
  examples: [
    'node scripts/test-summary-shell.mjs --help',
    'npm run test:summary:shell -- --file scripts/test/example.bats',
  ],
});
const batsDir = path.join(wrapper.rootDir, 'scripts', 'test', 'bats');
const vendorDir = path.join(batsDir, 'vendor');
const batsExecutable = path.join(vendorDir, 'bats-core', 'bin', 'bats');
const batsCoreDir = path.join(vendorDir, 'bats-core');

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
};

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

const chmodTree = async (dirPath, mode) => {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await chmodTree(entryPath, mode);
        return;
      }
      if (entry.isFile()) {
        await fs.chmod(entryPath, mode);
      }
    }),
  );
};

const prepareVendoredBatsRuntime = async () => {
  const runtimeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codeinfo2-bats-runtime-'),
  );
  const runtimeBatsCoreDir = path.join(runtimeRoot, 'bats-core');
  await fs.cp(batsCoreDir, runtimeBatsCoreDir, { recursive: true });
  await chmodTree(path.join(runtimeBatsCoreDir, 'bin'), 0o755);
  await chmodTree(path.join(runtimeBatsCoreDir, 'libexec', 'bats-core'), 0o755);
  return {
    runtimeRoot,
    batsExecutable: path.join(runtimeBatsCoreDir, 'bin', 'bats'),
  };
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

wrapper.startHeartbeat();

const requestedFiles = options.files.map((file) =>
  path.resolve(wrapper.rootDir, normalizeShellPath(file)),
);

if (!(await ensureFileExists(batsExecutable))) {
  await wrapper.closeLog();
  console.error(`Missing vendored bats executable: ${batsExecutable}`);
  process.exit(1);
}

let suiteFiles = [];
if (requestedFiles.length > 0) {
  for (const filePath of requestedFiles) {
    if (!(await ensureFileExists(filePath))) {
      writeLogLine(
        wrapper.logStream,
        `Missing requested shell suite: ${filePath}`,
      );
      await wrapper.closeLog();
      wrapper.protocol.emitFinal({
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
  wrapper.logStream,
  `${DEV_0000050_T08_SHELL_HARNESS_READY} ${JSON.stringify({
    suiteCount: suiteFiles.length,
    vendorMode: 'vendored',
    targetedRunSupported: true,
  })}`,
);
writeLogLine(
  wrapper.logStream,
  `[shell] suites: ${suiteFiles
    .map((filePath) => path.relative(wrapper.rootDir, filePath))
    .join(', ')}`,
);

const batsEnv = {
  ...process.env,
  BATS_LIB_PATH: [vendorDir, process.env.BATS_LIB_PATH]
    .filter(Boolean)
    .join(path.delimiter),
};

const runtime = await prepareVendoredBatsRuntime();
let batsResult;
try {
  batsResult = await runLoggedCommand({
    cmd: 'bash',
    args: [runtime.batsExecutable, ...suiteFiles],
    cwd: wrapper.rootDir,
    env: batsEnv,
    logStream: wrapper.logStream,
    protocol: wrapper.protocol,
    phase: 'test',
  });
} finally {
  await fs.rm(runtime.runtimeRoot, { recursive: true, force: true });
}

await wrapper.closeLog();

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

wrapper.protocol.emitFinal({
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
