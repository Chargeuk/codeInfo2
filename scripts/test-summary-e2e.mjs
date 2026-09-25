#!/usr/bin/env node
// Purpose: reduce token usage by printing only a compact e2e summary in the terminal.
// Use: `npm run test:summary:e2e` from repository root.
// Behavior: runs compose build/up, executes Playwright e2e tests with JSON reporter, always performs teardown,
// and prints the shared heartbeat/final-action protocol plus total/passed/failed counts and failing test names.
// Logging: writes a timestamped log in logs/test-summaries/ and refreshes e2e-tests-latest.log on every run.
// Optional targeting:
//   --file <path>  repeatable; forwarded as Playwright test file selectors.
//   --grep <expr>  forwarded to Playwright --grep.
//   --skip-compose-build  reuse existing e2e images instead of rebuilding before compose up.
// Why: this keeps routine AI-assisted runs low-noise while still preserving full logs when failures need diagnosis.

import path from 'node:path';

import { runLoggedCommand, writeLogLine } from './summary-wrapper-protocol.mjs';
import { createSummaryWrapperRun } from './summary-wrapper-runner.mjs';
import {
  formatWorkerSummaryLine,
  resolveWorkerSetting,
} from './test-parallelism.mjs';
import {
  TEST_DOCKER_TARGETS,
  acquireTestDockerLock,
  createComposeCommand,
  listComposeProjectResources,
  waitForHttpReadiness,
  waitForProjectRemoval,
} from './test-docker-harness-lifecycle.mjs';

const wrapper = createSummaryWrapperRun({
  wrapperName: 'e2e',
  logBaseName: 'e2e-tests',
  logDir: 'logs/test-summaries',
  initialPhase: 'compose_config',
  description:
    'Runs compose-backed Playwright e2e checks with preflight validation, compact wrapper output, and saved full logs.',
  allowedFlags: [
    {
      name: 'help',
      alias: 'h',
      type: 'boolean',
      description: 'Show wrapper help and exit without starting e2e checks.',
    },
    {
      name: 'file',
      type: 'value',
      multiple: true,
      description: 'Run one or more selected Playwright spec files.',
    },
    {
      name: 'grep',
      type: 'value',
      description: 'Filter Playwright specs with --grep.',
    },
    {
      name: 'skip-compose-build',
      type: 'boolean',
      description:
        'Reuse existing compose-backed e2e images instead of running npm run compose:e2e:build first.',
    },
    {
      name: 'reuse-compose',
      type: 'boolean',
      description:
        'Use the already-ready E2E Compose project owned by the all-tests wrapper.',
    },
  ],
  examples: [
    'node scripts/test-summary-e2e.mjs --help',
    'npm run test:summary:e2e -- --grep "env runtime config"',
    'npm run test:summary:e2e -- --skip-compose-build --file e2e/env-runtime-config.spec.ts',
  ],
});
const e2eArtifactDir = path.posix.join('playwright-output', wrapper.timestamp);
const e2eOutputDir = 'logs/test-summaries';
const args = process.argv.slice(2);

const parsedArgs = wrapper.parseArgs(args);

if (parsedArgs.helpRequested) {
  process.stdout.write(wrapper.renderHelp());
  await wrapper.closeLog({ promoteLatest: false });
  process.exit(0);
}

if (parsedArgs.error) {
  console.error(parsedArgs.error);
  process.exit(
    await wrapper.failCli(parsedArgs.error, { promoteLatest: false }),
  );
}

wrapper.startHeartbeat();

const options = {
  files: parsedArgs.values.file ?? [],
  grep: parsedArgs.values.grep ?? undefined,
  skipComposeBuild: parsedArgs.values['skip-compose-build'] ?? false,
  reuseCompose: parsedArgs.values['reuse-compose'] ?? false,
};
const playwrightParallelism = resolveWorkerSetting(
  process.env.PLAYWRIGHT_WORKERS,
);

const defaultBrowserBaseUrl = 'http://host.docker.internal:6001';
const defaultApiBaseUrl = 'http://host.docker.internal:6010';
const defaultMcpControlUrl = 'http://host.docker.internal:8932/mcp';

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

const parsePlaywrightStatsFallback = (text) => {
  if (!text) return null;
  const expected = text.match(/"expected"\s*:\s*(\d+)/);
  const unexpected = text.match(/"unexpected"\s*:\s*(\d+)/);
  const flaky = text.match(/"flaky"\s*:\s*(\d+)/);
  if (!expected || !unexpected || !flaky) return null;

  const passed = Number(expected[1]);
  const failed = Number(unexpected[1]) + Number(flaky[1]);
  return {
    total: passed + failed,
    passed,
    failed,
    failingNames: [],
  };
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
  mcpControlUrl: process.env.E2E_MCP_CONTROL_URL ?? defaultMcpControlUrl,
  useMockChat: process.env.E2E_USE_MOCK_CHAT ?? 'true',
  copilotScenario: process.env.E2E_COPILOT_SCENARIO ?? 'copilot-happy-path',
};

console.log(
  `[e2e] ${formatWorkerSummaryLine({
    label: 'playwright_workers',
    availableCores: playwrightParallelism.availableCores,
    workerCount: playwrightParallelism.workerCount,
    source: playwrightParallelism.source,
  })}`,
);
wrapper.appendLogSection('Parallelism', [
  formatWorkerSummaryLine({
    label: 'playwright_workers',
    availableCores: playwrightParallelism.availableCores,
    workerCount: playwrightParallelism.workerCount,
    source: playwrightParallelism.source,
  }),
]);

let testExitCode = 1;
let summary = { total: 0, passed: 0, failed: 0, failingNames: [] };
let setupFailed = false;
let teardownFailed = false;
let parseFailed = false;
let task13MarkerLine = '';
let testResultReason = '';
let testResultProgressLine = '';
let summarySource = 'not_run';
let preflightPassed = false;
let setupFailureLabel = '';
let teardownFailureLabel = '';
let dockerLock = null;
const e2eDocker = TEST_DOCKER_TARGETS.e2e;

const runCompose = async (action) => {
  const command = createComposeCommand({
    rootDir: wrapper.rootDir,
    target: 'e2e',
    action,
  });
  return runLoggedCommand({
    ...command,
    logStream: wrapper.logStream,
    protocol: wrapper.protocol,
    phase: `compose_${action}`,
    bannerPrefix: action === 'config' ? '' : undefined,
  });
};

try {
  const configResult = await runCompose('config');
  if (configResult.code !== 0) {
    setupFailed = true;
    setupFailureLabel = 'compose_config_failed';
  } else {
    preflightPassed = true;
  }

  if (!setupFailed) {
    let buildResult = {
      code: 0,
    };
    if (options.skipComposeBuild) {
      wrapper.protocol.setPhase('compose_up');
      wrapper.appendLogSection('Compose build', [
        'compose_build_step=skipped',
        'reason=wrapper_flag_skip_compose_build',
      ]);
    } else {
      buildResult = await runLoggedCommand({
        cmd: 'npm',
        args: ['run', 'compose:e2e:build'],
        cwd: wrapper.rootDir,
        logStream: wrapper.logStream,
        protocol: wrapper.protocol,
        phase: 'compose_build',
        bannerPrefix: '',
      });
    }
    if (buildResult.code !== 0) {
      setupFailed = true;
      setupFailureLabel = 'compose_build_failed';
    } else {
      if (!options.reuseCompose) {
        dockerLock = await acquireTestDockerLock();
        const downResult = await runCompose('down');
        if (downResult.code !== 0) {
          setupFailed = true;
          setupFailureLabel = 'compose_preflight_down_failed';
        } else {
          await waitForProjectRemoval({
            projectName: e2eDocker.projectName,
            listResources: listComposeProjectResources,
          });
          const upResult = await runCompose('up');
          if (upResult.code !== 0) {
            setupFailed = true;
            setupFailureLabel = 'compose_up_failed';
          }
        }
      }

      if (!setupFailed) {
        await waitForHttpReadiness({ urls: e2eDocker.readyUrls });
        const testResult = await runLoggedCommand({
          cmd: 'npm',
          args: ['run', 'e2e:test', '--', '--reporter=json', ...playwrightArgs],
          cwd: wrapper.rootDir,
          env: {
            ...process.env,
            E2E_BASE_URL: e2eRuntimeConfig.browserBaseUrl,
            E2E_API_URL: e2eRuntimeConfig.apiBaseUrl,
            E2E_MCP_CONTROL_URL: e2eRuntimeConfig.mcpControlUrl,
            E2E_USE_MOCK_CHAT: e2eRuntimeConfig.useMockChat,
            E2E_COPILOT_SCENARIO: e2eRuntimeConfig.copilotScenario,
            PLAYWRIGHT_WORKERS: String(playwrightParallelism.workerCount),
            PLAYWRIGHT_OUTPUT_DIR: e2eArtifactDir,
          },
          logStream: wrapper.logStream,
          protocol: wrapper.protocol,
          phase: 'test',
          collectStdout: true,
        });
        testExitCode = testResult.code;
        testResultReason = testResult.forcedReason ?? '';
        testResultProgressLine = testResult.lastProgressLine ?? '';
        try {
          const report =
            parsePlaywrightJson(testResult.stdout) ??
            parsePlaywrightJson(testResult.output);
          if (report) {
            summary = collectSummary(report);
            summarySource = 'stdout_json';
          } else {
            const fallbackSummary = parsePlaywrightStatsFallback(
              testResult.output,
            );
            if (!fallbackSummary) {
              throw new Error('Playwright JSON report not found in stdout');
            }
            summary = fallbackSummary;
            summarySource = 'stdout_stats_fallback';
          }
        } catch {
          parseFailed = true;
          summarySource = 'parse_failed';
          summary = {
            total: 0,
            passed: 0,
            failed: testExitCode === 0 ? 0 : 1,
            failingNames: [],
          };
        }
      }
    }
  }
} catch (error) {
  setupFailed = true;
  setupFailureLabel ||= 'compose_lifecycle_failed';
  wrapper.appendLogSection(
    'E2E Docker lifecycle failure',
    error instanceof Error ? error.stack : String(error),
  );
} finally {
  if (!options.reuseCompose && dockerLock) {
    const downResult = await runCompose('down');
    if (downResult.code !== 0) {
      teardownFailed = true;
      teardownFailureLabel = 'compose_down_failed';
    }
    try {
      await waitForProjectRemoval({
        projectName: e2eDocker.projectName,
        listResources: listComposeProjectResources,
      });
    } catch (error) {
      teardownFailed = true;
      teardownFailureLabel = 'compose_resources_remain';
      wrapper.appendLogSection(
        'E2E Docker teardown verification failure',
        error instanceof Error ? error.stack : String(error),
      );
    }
    await dockerLock.release();
  }
  if (!setupFailed && !teardownFailed && testExitCode === 0) {
    const markerPayload = {
      browserBaseUrl: e2eRuntimeConfig.browserBaseUrl,
      mcpControlUrl: e2eRuntimeConfig.mcpControlUrl,
      baseUrlMatchesMcp:
        e2eRuntimeConfig.browserBaseUrl === e2eRuntimeConfig.mcpControlUrl,
      copilotScenario: e2eRuntimeConfig.copilotScenario,
    };
    task13MarkerLine = `DEV-0000050:T13:e2e_host_network_config_verified ${JSON.stringify(markerPayload)}`;
    writeLogLine(wrapper.logStream, task13MarkerLine);
  }

  wrapper.appendLogSection('E2E proof summary', [
    `compose_config_validation=${preflightPassed ? 'passed' : 'failed'}`,
    `setup_failure=${setupFailureLabel || 'none'}`,
    `teardown_failure=${teardownFailureLabel || 'none'}`,
    `summary_source=${summarySource}`,
    `artifact_output_dir=${e2eArtifactDir}`,
    `wrapper_log_dir=${e2eOutputDir}`,
    `latest_log_alias=${path.relative(wrapper.rootDir, wrapper.latestLogPath)}`,
    `browser_base_url=${e2eRuntimeConfig.browserBaseUrl}`,
    `api_base_url=${e2eRuntimeConfig.apiBaseUrl}`,
    `mcp_control_url=${e2eRuntimeConfig.mcpControlUrl}`,
    `copilot_scenario=${e2eRuntimeConfig.copilotScenario}`,
  ]);

  await wrapper.closeLog();
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

const status = exitCode === 0 ? 'passed' : 'failed';
const ambiguousCounts =
  parseFailed || (status === 'passed' && summary.total === 0);

const printFailureHints = () => {
  console.log(`artifacts=${e2eArtifactDir}`);
  console.log(`wrapper_logs=${e2eOutputDir}`);
  console.log(
    `latest_log=${path.relative(wrapper.rootDir, wrapper.latestLogPath)}`,
  );
};

console.log(`[e2e] tests run: ${summary.total}`);
console.log(`[e2e] passed: ${summary.passed}`);
console.log(`[e2e] failed: ${summary.failed}`);
if (summary.failingNames.length > 0) {
  console.log('[e2e] failing tests:');
  for (const name of summary.failingNames) {
    console.log(`- ${name}`);
  }
}

if (status === 'failed' || ambiguousCounts) {
  printFailureHints();
}

const finalReason =
  testResultReason === 'terminal_summary_without_close'
    ? 'terminal_summary_without_close'
    : testResultReason === 'semantic_progress_stalled'
      ? 'semantic_progress_stalled'
      : setupFailed || teardownFailed
        ? setupFailureLabel || 'setup_or_teardown_failed'
        : status === 'passed'
          ? ambiguousCounts
            ? 'ambiguous_counts'
            : 'clean_success'
          : 'test_failed';

wrapper.protocol.emitFinal({
  status,
  ambiguousCounts,
  reason: finalReason,
  extraFields: testResultReason
    ? { last_progress: testResultProgressLine || undefined }
    : {},
});

process.exit(exitCode);
