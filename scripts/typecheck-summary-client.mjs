#!/usr/bin/env node
// Purpose: reduce token usage by printing only a compact client typecheck summary in the terminal.
// Use: `npm run typecheck:summary:client` from repository root.
// Behavior: runs `npm run typecheck --workspace client`, streams full output to logs/test-summaries/typecheck-client-latest.log,
// and prints the shared heartbeat/final-action protocol plus the final status, TypeScript error count, and log location.
// Note: this wrapper follows the client workspace `typecheck` script, which is expected to stay non-emitting for repeatable diagnosis.

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
const logPath = path.join(resultsDir, 'typecheck-client-latest.log');

const errorCount = (output) =>
  output.split(/\r?\n/).filter((line) => /error TS\d+:/i.test(line)).length;

const logStream = createSummaryLogStream(logPath);
const protocol = createSummaryWrapperProtocol({
  wrapperName: 'typecheck:client',
  logPath,
  logDisplayPath: path.relative(rootDir, logPath),
  initialPhase: 'typecheck',
});

protocol.startHeartbeat();

const result = await runLoggedCommand({
  cmd: 'npm',
  args: ['run', 'typecheck', '--workspace', 'client'],
  cwd: rootDir,
  logStream,
  protocol,
  phase: 'typecheck',
  bannerPrefix: '',
});

await new Promise((resolve) => logStream.end(resolve));

const tsErrorCount = errorCount(result.output);
const status = result.code === 0 ? 'passed' : 'failed';

protocol.emitFinal({
  status,
  reason: status === 'passed' ? 'clean_success' : 'typecheck_failed',
  extraFields: {
    error_count: tsErrorCount,
  },
});

process.exit(result.code);
