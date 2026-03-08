#!/usr/bin/env node
// Purpose: prove the shared wrapper heartbeat and final agent-action protocol
// before it is rolled across the existing summary wrappers in later tasks.

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
const resultsDir = path.join(rootDir, 'logs', 'test-summaries');
const logPath = path.join(resultsDir, 'summary-wrapper-protocol-fixture.log');

const args = process.argv.slice(2);
const options = {
  mode: 'success',
  durationMs: 2_500,
};

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--mode') {
    const value = args[i + 1];
    if (!value) {
      console.error('Missing value for --mode');
      process.exit(1);
    }
    options.mode = value;
    i += 1;
    continue;
  }
  if (arg === '--duration-ms') {
    const value = Number(args[i + 1]);
    if (!Number.isFinite(value) || value < 0) {
      console.error('Missing or invalid value for --duration-ms');
      process.exit(1);
    }
    options.durationMs = value;
    i += 1;
    continue;
  }
  if (arg === '--help') {
    console.log(
      'Usage: node ./scripts/summary-wrapper-protocol-fixture.mjs [--mode success|failure|warning|ambiguous] [--duration-ms <n>]',
    );
    process.exit(0);
  }
  console.error(`Unknown argument: ${arg}`);
  process.exit(1);
}

const exitCodeByMode = {
  success: 0,
  failure: 1,
  warning: 0,
  ambiguous: 0,
};

if (!(options.mode in exitCodeByMode)) {
  console.error(`Unsupported mode: ${options.mode}`);
  process.exit(1);
}

const childScript = `
  console.log('fixture-start');
  let tick = 0;
  const mode = ${JSON.stringify(options.mode)};
  const interval = setInterval(() => {
    tick += 1;
    console.log('fixture-tick-' + tick);
    if (mode === 'warning' && tick === 1) {
      console.log('warning: simulated warning');
    }
  }, 250);
  setTimeout(() => {
    clearInterval(interval);
    console.log('fixture-complete');
    process.exit(${exitCodeByMode[options.mode]});
  }, ${options.durationMs});
`;

const logStream = createSummaryLogStream(logPath);
const protocol = createSummaryWrapperProtocol({
  wrapperName: 'fixture:protocol',
  logPath,
  logDisplayPath: path.relative(rootDir, logPath),
  initialPhase: 'fixture',
});

protocol.startHeartbeat();

const result = await runLoggedCommand({
  cmd: 'node',
  args: ['-e', childScript],
  cwd: rootDir,
  logStream,
  protocol,
  phase: 'fixture',
});

await new Promise((resolve) => logStream.end(resolve));

const warningCount = options.mode === 'warning' ? 1 : 0;
const ambiguousCounts = options.mode === 'ambiguous';
const status = result.code === 0 ? 'passed' : 'failed';

protocol.emitFinal({
  status,
  warningCount,
  ambiguousCounts,
  reason:
    options.mode === 'ambiguous'
      ? 'ambiguous_counts'
      : options.mode === 'warning'
        ? 'warnings_present'
        : options.mode === 'failure'
          ? 'failed'
          : 'clean_success',
});

console.log(`[fixture:protocol] exit_code: ${result.code}`);

process.exit(result.code);
