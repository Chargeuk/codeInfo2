#!/usr/bin/env node
// Purpose: reduce token usage by printing only a compact server cucumber summary in the terminal.
// Use: `npm run test:summary:server:cucumber` from repository root.
// Behavior: builds the server workspace, runs cucumber features, streams full output to test-results/,
// and prints the shared heartbeat/final-action protocol plus total/passed/failed counts and failing scenario names when present.
// Optional targeting:
//   --tags <expr>      cucumber tag expression.
//   --feature <path>   repeatable; run only selected feature files.
//   --scenario <expr>  forwarded to cucumber --name.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSummaryLogStream,
  createSummaryWrapperProtocol,
  runLoggedCommand,
} from './summary-wrapper-protocol.mjs';
import {
  buildCucumberImportArgs,
  normalizeServerPath,
} from './test-summary-server-cucumber-imports.mjs';

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
const logPath = path.join(resultsDir, `server-cucumber-tests-${timestamp}.log`);

const args = process.argv.slice(2);
const options = {
  tags: undefined,
  features: [],
  scenario: undefined,
};

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--tags') {
    const value = args[i + 1];
    if (!value) {
      console.error('Missing value for --tags');
      process.exit(1);
    }
    options.tags = value;
    i += 1;
    continue;
  }
  if (arg === '--feature') {
    const value = args[i + 1];
    if (!value) {
      console.error('Missing value for --feature');
      process.exit(1);
    }
    options.features.push(value);
    i += 1;
    continue;
  }
  if (arg === '--scenario') {
    const value = args[i + 1];
    if (!value) {
      console.error('Missing value for --scenario');
      process.exit(1);
    }
    options.scenario = value;
    i += 1;
    continue;
  }
  if (arg === '--help') {
    console.log(
      'Usage: npm run test:summary:server:cucumber -- [--tags <expr>] [--feature <path>] [--scenario <pattern>]',
    );
    process.exit(0);
  }
  console.error(`Unknown argument: ${arg}`);
  process.exit(1);
}

const parseCucumberScenarioCounts = (output) => {
  let scenariosTotal = 0;
  let scenariosPassed = 0;
  let scenariosFailed = 0;

  const scenarioLines = [
    ...output.matchAll(/(\d+)\s+scenarios?\s+\(([^)]+)\)/gim),
  ];
  for (const line of scenarioLines) {
    scenariosTotal += Number(line[1]);
    const breakdown = line[2];
    const passed = breakdown.match(/(\d+)\s+passed/i);
    const failed = breakdown.match(/(\d+)\s+failed/i);
    scenariosPassed += Number(passed?.[1] ?? 0);
    scenariosFailed += Number(failed?.[1] ?? 0);
  }

  return { scenariosTotal, scenariosPassed, scenariosFailed };
};

const parseFailureNames = (output) => {
  const names = new Set();
  for (const match of output.matchAll(
    /^[ \t]*✖[ \t]+(.+?)(?: \(\d+(?:\.\d+)?ms\))?$/gm,
  )) {
    names.add(match[1].trim());
  }
  return [...names];
};

const logStream = createSummaryLogStream(logPath);
const protocol = createSummaryWrapperProtocol({
  wrapperName: 'server:cucumber',
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

const featureArgs =
  options.features.length > 0
    ? options.features.map((file) => normalizeServerPath(file))
    : ['src/test/features/**/*.feature'];
const tagsExpression = options.tags
  ? `(${options.tags}) and (not @skip)`
  : 'not @skip';

const cucumberImportArgs = buildCucumberImportArgs(serverDir, featureArgs);

const cucumberArgs = [
  ...featureArgs,
  ...cucumberImportArgs,
  '--tags',
  tagsExpression,
];
if (options.scenario) {
  cucumberArgs.push('--name', options.scenario);
}

const cucumberEnv = {
  ...process.env,
  CODEINFO_LOG_FILE_PATH: '../logs/server-cucumber.log',
  // Match the server-unit wrapper's isolation contract so cucumber uses its
  // scenario-owned containers instead of reusing ambient host services.
  CODEINFO_CHROMA_URL: '',
  CODEINFO_MONGO_URI: '',
  CODEINFO_PLAYWRIGHT_MCP_URL:
    process.env.CODEINFO_PLAYWRIGHT_MCP_URL ?? 'http://localhost:8932/mcp',
  TS_NODE_FILES: 'true',
  TS_NODE_PROJECT: './tsconfig.json',
  NODE_OPTIONS:
    '--import ./scripts/register-ts-node-esm-loader.mjs --disable-warning=DEP0180',
};

// Cucumber's imported testcontainer teardown can outlive the terminal summary
// even after the scenarios themselves have finished cleanly, so give this
// wrapper a longer post-summary grace before treating the child as stuck.
const CUCUMBER_TERMINAL_SUMMARY_GRACE_MS = 90_000;

let exitCode = buildResult.code;
let output = buildResult.output;
let cucumberForcedReason = '';
let cucumberLastProgressLine = '';
if (buildResult.code === 0) {
  const cucumberResult = await runLoggedCommand({
    cmd: 'cucumber-js',
    args: cucumberArgs,
    cwd: serverDir,
    env: cucumberEnv,
    logStream,
    protocol,
    phase: 'test',
    semanticProgressPatterns: [
      /^[ \t]*[✖✔][ \t]+/,
      /^\d+\s+scenarios?\s+\(/i,
      /^\d+\s+steps?\s+\(/i,
    ],
    terminalSummaryPatterns: [/^\d+\s+scenarios?\s+\(/i, /^\d+\s+steps?\s+\(/i],
    terminalSummaryGraceMs: CUCUMBER_TERMINAL_SUMMARY_GRACE_MS,
  });
  output += cucumberResult.output;
  exitCode = cucumberResult.code;
  cucumberForcedReason = cucumberResult.forcedReason ?? '';
  cucumberLastProgressLine = cucumberResult.lastProgressLine ?? '';
}

await new Promise((resolve) => logStream.end(resolve));

if (buildResult.code !== 0) {
  console.log('[server:cucumber] tests run: 0');
  console.log('[server:cucumber] passed: 0');
  console.log('[server:cucumber] failed: 1');
  console.log('[server:cucumber] failing tests:');
  console.log('- build failed');
  protocol.emitFinal({
    status: 'failed',
    reason: 'build_failed',
  });
  process.exit(buildResult.code);
}

const { scenariosTotal, scenariosPassed, scenariosFailed } =
  parseCucumberScenarioCounts(output);
const failingNames = parseFailureNames(output);
const status = exitCode === 0 ? 'passed' : 'failed';
const ambiguousCounts = status === 'passed' && scenariosTotal === 0;
const finalReason =
  cucumberForcedReason === 'terminal_summary_without_close'
    ? 'terminal_summary_without_close'
    : cucumberForcedReason === 'semantic_progress_stalled'
      ? 'semantic_progress_stalled'
      : status === 'passed'
        ? ambiguousCounts
          ? 'ambiguous_counts'
          : 'clean_success'
        : 'test_failed';

console.log(`[server:cucumber] tests run: ${scenariosTotal}`);
console.log(`[server:cucumber] passed: ${scenariosPassed}`);
console.log(`[server:cucumber] failed: ${scenariosFailed}`);
if (failingNames.length > 0) {
  console.log('[server:cucumber] failing tests:');
  for (const name of failingNames) {
    console.log(`- ${name}`);
  }
}

protocol.emitFinal({
  status,
  ambiguousCounts,
  reason: finalReason,
  extraFields:
    finalReason === 'semantic_progress_stalled' ||
    finalReason === 'terminal_summary_without_close'
      ? { last_progress: cucumberLastProgressLine || undefined }
      : {},
});

process.exit(exitCode);
