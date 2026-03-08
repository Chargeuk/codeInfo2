#!/usr/bin/env node
// Purpose: reduce token usage by printing only a compact server build summary in the terminal.
// Use: `npm run build:summary:server` from repository root.
// Behavior: runs `npm run build --workspace server`, streams full output to logs/test-summaries/build-server-latest.log,
// and prints the shared heartbeat/final-action protocol plus the final status (passed/failed), warning count, and log location.
// Warning count: best-effort line-based parsing of build output for warning markers.
// Why: this keeps routine AI-assisted runs low-noise while preserving full build output for troubleshooting.

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
const logPath = path.join(resultsDir, 'build-server-latest.log');

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

const logStream = createSummaryLogStream(logPath);
const protocol = createSummaryWrapperProtocol({
  wrapperName: 'build:server',
  logPath,
  logDisplayPath: path.relative(rootDir, logPath),
  initialPhase: 'build',
});

protocol.startHeartbeat();

const result = await runLoggedCommand({
  cmd: 'npm',
  args: ['run', 'build', '--workspace', 'server'],
  cwd: rootDir,
  logStream,
  protocol,
  phase: 'build',
  bannerPrefix: '',
});

await new Promise((resolve) => logStream.end(resolve));

const warningCount = countWarnings(result.output);
const status = result.code === 0 ? 'passed' : 'failed';

protocol.emitFinal({
  status,
  warningCount,
  reason:
    status === 'passed'
      ? warningCount > 0
        ? 'warnings_present'
        : 'clean_success'
      : 'build_failed',
  extraFields: {
    warning_count: warningCount,
  },
});

process.exit(result.code);
