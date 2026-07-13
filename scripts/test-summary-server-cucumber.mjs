#!/usr/bin/env node
// Purpose: reduce token usage by printing only a compact server cucumber summary in the terminal.
// Use: `npm run test:summary:server:cucumber` from repository root.
// Behavior: builds the server workspace, runs cucumber features, streams full output to test-results/,
// and prints the shared heartbeat/final-action protocol plus total/passed/failed counts and failing scenario names when present.
// Optional targeting:
//   --tags <expr>      repeatable; cucumber tag expressions combined with AND.
//   --feature <path>   repeatable; run only selected feature files.
//   --scenario <expr>  forwarded to cucumber --name.
//   --skip-build       reuse an existing server build instead of rebuilding first.

import path from 'node:path';

import { runLoggedCommand } from './summary-wrapper-protocol.mjs';
import { createSummaryWrapperRun } from './summary-wrapper-runner.mjs';
import {
  buildCucumberImportArgs,
  normalizeServerPath,
} from './test-summary-server-cucumber-imports.mjs';

const wrapper = createSummaryWrapperRun({
  wrapperName: 'server:cucumber',
  logBaseName: 'server-cucumber-tests',
  logDir: 'test-results',
  initialPhase: 'build',
  description:
    'Builds the server workspace and runs the server cucumber features with compact wrapper output.',
  allowedFlags: [
    {
      name: 'help',
      alias: 'h',
      type: 'boolean',
      description:
        'Show wrapper help and exit without starting server cucumber.',
    },
    {
      name: 'tags',
      type: 'value',
      multiple: true,
      description:
        'Filter scenarios with one or more cucumber tag expressions.',
    },
    {
      name: 'feature',
      type: 'value',
      multiple: true,
      description: 'Run one or more selected feature files.',
    },
    {
      name: 'scenario',
      type: 'value',
      description: 'Filter scenarios with cucumber --name.',
    },
    {
      name: 'skip-build',
      type: 'boolean',
      description:
        'Reuse an existing server build instead of running npm run build --workspace server first.',
    },
  ],
  examples: [
    'node scripts/test-summary-server-cucumber.mjs --help',
    'npm run test:summary:server:cucumber -- --tags "@smoke"',
    'npm run test:summary:server:cucumber -- --tags "@logs" --tags "@smoke"',
    'npm run test:summary:server:cucumber -- --skip-build --feature server/src/test/features/chat_models.feature',
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
  tags: parsedArgs.values.tags ?? [],
  features: parsedArgs.values.feature ?? [],
  scenario: parsedArgs.values.scenario ?? undefined,
  skipBuild: parsedArgs.values['skip-build'] ?? false,
};

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

const featureArgs =
  options.features.length > 0
    ? options.features.map((file) => normalizeServerPath(file))
    : ['src/test/features/**/*.feature'];
const tagsExpression =
  options.tags.length > 0
    ? `${options.tags.map((tag) => `(${tag})`).join(' and ')} and (not @skip)`
    : 'not @skip';

const cucumberImportArgs = buildCucumberImportArgs(serverDir, featureArgs);

const cucumberArgs = [
  ...featureArgs,
  ...cucumberImportArgs,
  '--force-exit',
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
    logStream: wrapper.logStream,
    protocol: wrapper.protocol,
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

await wrapper.closeLog();

if (buildResult.code !== 0) {
  console.log('[server:cucumber] tests run: 0');
  console.log('[server:cucumber] passed: 0');
  console.log('[server:cucumber] failed: 1');
  console.log('[server:cucumber] failing tests:');
  console.log('- build failed');
  wrapper.protocol.emitFinal({
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

wrapper.protocol.emitFinal({
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
