#!/usr/bin/env node
// Purpose: reduce token usage by printing only a compact e2e summary in the terminal.
// Use: `npm run test:summary:e2e` from repository root.
// Behavior: runs compose build/up, executes Playwright e2e tests with JSON reporter, always performs teardown,
// and prints the shared heartbeat/final-action protocol plus total/passed/failed counts and failing test names.
// Logging: writes full output to logs/test-summaries/e2e-tests-latest.log on every run (overwrites previous run).
// Optional targeting:
//   --file <path>  repeatable; forwarded as Playwright test file selectors.
//   --grep <expr>  forwarded to Playwright --grep.
// Why: this keeps routine AI-assisted runs low-noise while still preserving full logs when failures need diagnosis.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSummaryLogStream,
  createSummaryWrapperProtocol,
  runLoggedCommand,
  writeLogLine,
} from './summary-wrapper-protocol.mjs';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const resultsDir = path.join(rootDir, 'logs', 'test-summaries');
const logPath = path.join(resultsDir, 'e2e-tests-latest.log');

const logStream = createSummaryLogStream(logPath);
const protocol = createSummaryWrapperProtocol({
  wrapperName: 'e2e',
  logPath,
  logDisplayPath: path.relative(rootDir, logPath),
  initialPhase: 'compose_build',
});

protocol.startHeartbeat();

const args = process.argv.slice(2);
const options = {
  files: [],
  grep: undefined,
};

const defaultBrowserBaseUrl = 'http://host.docker.internal:6001';
const defaultApiBaseUrl = 'http://host.docker.internal:6010';
const defaultMcpControlUrl = 'http://host.docker.internal:8932/mcp';

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
  if (arg === '--grep') {
    const value = args[i + 1];
    if (!value) {
      console.error('Missing value for --grep');
      process.exit(1);
    }
    options.grep = value;
    i += 1;
    continue;
  }
  if (arg === '--help') {
    console.log(
      'Usage: npm run test:summary:e2e -- [--file <path>] [--grep <pattern>]',
    );
    process.exit(0);
  }
  console.error(`Unknown argument: ${arg}`);
  process.exit(1);
}

const parsePlaywrightJson = (stdout) => {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // npm script wrappers may prepend non-JSON lines before the reporter payload.
  }

  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) return null;

  try {
    return JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
  } catch {
    return null;
  }
};

const classifyTest = (test) => {
  if (typeof test?.outcome === 'string') {
    if (test.outcome === 'expected') return 'passed';
    if (test.outcome === 'flaky') return 'flaky';
    if (test.outcome === 'skipped') return 'skipped';
    return 'failed';
  }

  const results = Array.isArray(test?.results) ? test.results : [];
  const statuses = results.map((r) => r?.status).filter(Boolean);
  const finalStatus = statuses.at(-1);
  const hasFailure = statuses.some((s) =>
    ['failed', 'timedOut', 'interrupted'].includes(s),
  );

  if (finalStatus === 'passed' && hasFailure) return 'flaky';
  if (finalStatus === 'passed') return 'passed';
  if (finalStatus === 'skipped' || test?.expectedStatus === 'skipped')
    return 'skipped';
  if (['failed', 'timedOut', 'interrupted'].includes(finalStatus))
    return 'failed';
  return 'failed';
};

const collectSummary = (report) => {
  let passed = 0;
  let failed = 0;
  const failingNames = new Set();

  const walkSuites = (suites, parents = []) => {
    for (const suite of suites ?? []) {
      const suiteParts = suite?.title
        ? [...parents, suite.title]
        : [...parents];
      walkSuites(suite?.suites ?? [], suiteParts);

      for (const spec of suite?.specs ?? []) {
        const titleParts = [...suiteParts, spec?.title].filter(Boolean);
        const fullTitle = titleParts.join(' > ');

        for (const test of spec?.tests ?? []) {
          const outcome = classifyTest(test);
          if (outcome === 'passed') {
            passed += 1;
          } else if (outcome === 'failed' || outcome === 'flaky') {
            failed += 1;
            const projectPrefix = test?.projectName
              ? `[${test.projectName}] `
              : '';
            failingNames.add(`${projectPrefix}${fullTitle}`.trim());
          }
        }
      }
    }
  };

  walkSuites(report?.suites ?? []);
  if (passed + failed === 0) {
    const expected = Number(report?.stats?.expected ?? 0);
    const unexpected = Number(report?.stats?.unexpected ?? 0);
    const flaky = Number(report?.stats?.flaky ?? 0);
    return {
      total: expected + unexpected + flaky,
      passed: expected,
      failed: unexpected + flaky,
      failingNames: [...failingNames],
    };
  }
  return {
    total: passed + failed,
    passed,
    failed,
    failingNames: [...failingNames],
  };
};

const normalizeE2ePath = (value) => {
  if (path.isAbsolute(value)) return value;
  const normalized = value.replace(/\\/g, '/');
  const withoutDotPrefix = normalized.startsWith('./')
    ? normalized.slice(2)
    : normalized;
  if (withoutDotPrefix.startsWith('e2e/')) return withoutDotPrefix;
  if (withoutDotPrefix.endsWith('.spec.ts')) return `e2e/${withoutDotPrefix}`;
  return withoutDotPrefix;
};

const playwrightArgs = [...options.files.map((file) => normalizeE2ePath(file))];
if (options.grep) {
  playwrightArgs.push('--grep', options.grep);
}

const e2eRuntimeConfig = {
  browserBaseUrl: process.env.E2E_BASE_URL ?? defaultBrowserBaseUrl,
  apiBaseUrl: process.env.E2E_API_URL ?? defaultApiBaseUrl,
  mcpControlUrl:
    process.env.E2E_MCP_CONTROL_URL ??
    process.env.CODEINFO_PLAYWRIGHT_MCP_URL ??
    defaultMcpControlUrl,
  useMockChat: process.env.E2E_USE_MOCK_CHAT ?? 'true',
};

let testExitCode = 1;
let summary = { total: 0, passed: 0, failed: 0, failingNames: [] };
let setupFailed = false;
let teardownFailed = false;
let parseFailed = false;
let task13MarkerLine = '';

try {
  const buildResult = await runLoggedCommand({
    cmd: 'npm',
    args: ['run', 'compose:e2e:build'],
    cwd: rootDir,
    logStream,
    protocol,
    phase: 'compose_build',
    bannerPrefix: '',
  });
  if (buildResult.code !== 0) {
    setupFailed = true;
  } else {
    const upResult = await runLoggedCommand({
      cmd: 'npm',
      args: ['run', 'e2e:up'],
      cwd: rootDir,
      logStream,
      protocol,
      phase: 'compose_up',
    });
    if (upResult.code !== 0) {
      setupFailed = true;
    } else {
      const testResult = await runLoggedCommand({
        cmd: 'npm',
        args: ['run', 'e2e:test', '--', '--reporter=json', ...playwrightArgs],
        cwd: rootDir,
        env: {
          ...process.env,
          E2E_BASE_URL: e2eRuntimeConfig.browserBaseUrl,
          E2E_API_URL: e2eRuntimeConfig.apiBaseUrl,
          E2E_MCP_CONTROL_URL: e2eRuntimeConfig.mcpControlUrl,
          E2E_USE_MOCK_CHAT: e2eRuntimeConfig.useMockChat,
        },
        logStream,
        protocol,
        phase: 'test',
        collectStdout: true,
      });
      testExitCode = testResult.code;
      try {
        const report = parsePlaywrightJson(testResult.stdout);
        if (!report)
          throw new Error('Playwright JSON report not found in stdout');
        summary = collectSummary(report);
      } catch {
        parseFailed = true;
        summary = {
          total: 0,
          passed: 0,
          failed: testExitCode === 0 ? 0 : 1,
          failingNames: [],
        };
      }
    }
  }
} finally {
  const downResult = await runLoggedCommand({
    cmd: 'npm',
    args: ['run', 'e2e:down'],
    cwd: rootDir,
    logStream,
    protocol,
    phase: 'teardown',
  });
  if (downResult.code !== 0) {
    teardownFailed = true;
  }
  if (!setupFailed && !teardownFailed && testExitCode === 0) {
    const markerPayload = {
      browserBaseUrl: e2eRuntimeConfig.browserBaseUrl,
      mcpControlUrl: e2eRuntimeConfig.mcpControlUrl,
      baseUrlMatchesMcp:
        e2eRuntimeConfig.browserBaseUrl === e2eRuntimeConfig.mcpControlUrl,
    };
    task13MarkerLine = `DEV-0000050:T13:e2e_host_network_config_verified ${JSON.stringify(markerPayload)}`;
    writeLogLine(logStream, task13MarkerLine);
  }
  await new Promise((resolve) => logStream.end(resolve));
}

const exitCode = setupFailed || teardownFailed ? 1 : testExitCode;
if (setupFailed) {
  summary = {
    total: 0,
    passed: 0,
    failed: 1,
    failingNames: ['e2e setup failed'],
  };
}
if (teardownFailed && !summary.failingNames.includes('e2e teardown failed')) {
  summary.failed += 1;
  summary.failingNames.push('e2e teardown failed');
}

if (task13MarkerLine) {
  console.log(task13MarkerLine);
}

console.log(`[e2e] tests run: ${summary.total}`);
console.log(`[e2e] passed: ${summary.passed}`);
console.log(`[e2e] failed: ${summary.failed}`);
if (summary.failingNames.length > 0) {
  console.log('[e2e] failing tests:');
  for (const name of summary.failingNames) {
    console.log(`- ${name}`);
  }
}

const status = exitCode === 0 ? 'passed' : 'failed';
const ambiguousCounts =
  parseFailed || (status === 'passed' && summary.total === 0);

protocol.emitFinal({
  status,
  ambiguousCounts,
  reason:
    setupFailed || teardownFailed
      ? 'setup_or_teardown_failed'
      : status === 'passed'
        ? ambiguousCounts
          ? 'ambiguous_counts'
          : 'clean_success'
        : 'test_failed',
});

process.exit(exitCode);
