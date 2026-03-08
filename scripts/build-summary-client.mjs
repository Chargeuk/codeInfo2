#!/usr/bin/env node
// Purpose: reduce token usage by printing only a compact client build summary in the terminal.
// Use: `npm run build:summary:client` from repository root.
// Behavior: runs `npm run typecheck --workspace client` and then `npm run build --workspace client`,
// streams full output to logs/test-summaries/build-client-latest.log, and prints the shared wrapper
// heartbeat/final-action protocol plus the final status (passed/failed), failed phase (typecheck/build),
// warning count for the build phase, and log location.
// Warning count: best-effort line-based parsing of build output for warning markers.
// Why: this keeps routine AI-assisted runs low-noise while preserving full build output for troubleshooting.

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
const logPath = path.join(resultsDir, 'build-client-latest.log');

const stripAnsi = (value) => value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');

const countWarnings = (output) => {
  const lines = stripAnsi(output).split(/\r?\n/);
  const warningLines = new Set();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (
      /\bwarning\b/i.test(line) ||
      /warning TS\d+:/i.test(line) ||
      /\bnpm warn\b/i.test(line)
    ) {
      warningLines.add(line);
    }
  }

  return warningLines.size;
};

const runPhase = async (phase, args) => {
  protocol.setPhase(phase);
  writeLogLine(logStream, `===== phase: ${phase} =====`);
  const result = await runLoggedCommand({
    cmd: 'npm',
    args,
    cwd: rootDir,
    logStream,
    protocol,
    phase,
    bannerPrefix: '',
  });
  return result;
};

const logStream = createSummaryLogStream(logPath);
const protocol = createSummaryWrapperProtocol({
  wrapperName: 'build:client',
  logPath,
  logDisplayPath: path.relative(rootDir, logPath),
  initialPhase: 'typecheck',
});

protocol.startHeartbeat();

const typecheckResult = await runPhase('typecheck', [
  'run',
  'typecheck',
  '--workspace',
  'client',
]);

let failedPhase = 'none';
let buildResult = { code: 0, output: '' };

if (typecheckResult.code !== 0) {
  failedPhase = 'typecheck';
} else {
  buildResult = await runPhase('build', [
    'run',
    'build',
    '--workspace',
    'client',
  ]);
  if (buildResult.code !== 0) {
    failedPhase = 'build';
  }
}

await new Promise((resolve) => logStream.end(resolve));

const warningCount = countWarnings(buildResult.output);
const status = failedPhase === 'none' ? 'passed' : 'failed';

protocol.emitFinal({
  status,
  warningCount,
  reason:
    status === 'passed'
      ? warningCount > 0
        ? 'warnings_present'
        : 'clean_success'
      : failedPhase === 'typecheck'
        ? 'typecheck_failed'
        : 'build_failed',
  extraFields: {
    warning_count: warningCount,
  },
});

process.exit(failedPhase === 'none' ? 0 : 1);
