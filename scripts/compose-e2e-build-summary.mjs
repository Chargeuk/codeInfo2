#!/usr/bin/env node
// Purpose: reduce token usage by printing only a compact docker compose e2e build summary in the terminal.
// Use: `npm run compose:e2e:build:summary` from repository root.
// Behavior: runs `npm run compose:e2e:build` exactly as-is, streams full output to
// logs/test-summaries/compose-e2e-build-latest.log, and prints the shared heartbeat/final-action
// protocol plus overall status, best-effort pass/fail counts, failed item names (when detectable),
// and log location.

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
const logPath = path.join(resultsDir, 'compose-e2e-build-latest.log');

const stripAnsi = (value) => value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');

const parseComposeBuildSummary = (rawOutput) => {
  const output = stripAnsi(rawOutput);
  const passed = new Set();
  const failed = new Set();

  for (const line of output.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;

    const imagePassed = text.match(
      /^Image\s+(.+?)\s+(Built|CACHED|Loaded)\s*$/i,
    );
    if (imagePassed) {
      passed.add(imagePassed[1]);
      continue;
    }

    const imageFailed = text.match(
      /^Image\s+(.+?)\s+(Error|Failed|Canceled|Cancelled)\b/i,
    );
    if (imageFailed) {
      failed.add(imageFailed[1]);
      continue;
    }

    const servicePassed = text.match(/^([a-zA-Z0-9_.-]+)\s+(Built|CACHED)\s*$/);
    if (servicePassed) {
      passed.add(servicePassed[1]);
      continue;
    }

    const serviceFailed = text.match(/^([a-zA-Z0-9_.-]+)\s+(ERROR|failed)\b/i);
    if (serviceFailed) {
      failed.add(serviceFailed[1]);
      continue;
    }

    const errorStep = text.match(/^ERROR\s+\[([^\]]+)\]/i);
    if (errorStep) {
      failed.add(errorStep[1]);
      continue;
    }

    const targetFailed = text.match(
      /^target\s+([a-zA-Z0-9_.-]+):\s+failed to solve:/i,
    );
    if (targetFailed) {
      failed.add(targetFailed[1]);
      continue;
    }
  }

  for (const name of failed) {
    passed.delete(name);
  }

  return {
    passedCount: passed.size,
    failedCount: failed.size,
    failedNames: [...failed],
  };
};

const logStream = createSummaryLogStream(logPath);
const protocol = createSummaryWrapperProtocol({
  wrapperName: 'compose:e2e:build',
  logPath,
  logDisplayPath: path.relative(rootDir, logPath),
  initialPhase: 'compose_e2e_build',
});

protocol.startHeartbeat();

const result = await runLoggedCommand({
  cmd: 'npm',
  args: ['run', 'compose:e2e:build'],
  cwd: rootDir,
  logStream,
  protocol,
  phase: 'compose_e2e_build',
  bannerPrefix: '',
});
const parsed = parseComposeBuildSummary(result.output);
const status = result.code === 0 ? 'passed' : 'failed';
const passedLabel =
  parsed.passedCount > 0 ? String(parsed.passedCount) : 'unknown';
const failedLabel =
  parsed.failedCount > 0
    ? String(parsed.failedCount)
    : result.code === 0
      ? '0'
      : 'unknown';
const ambiguousCounts = passedLabel === 'unknown' || failedLabel === 'unknown';

console.log(`[compose:e2e:build] status: ${status}`);
console.log(`[compose:e2e:build] items passed: ${passedLabel}`);
console.log(`[compose:e2e:build] items failed: ${failedLabel}`);
if (parsed.failedNames.length > 0) {
  console.log('[compose:e2e:build] failed items:');
  for (const name of parsed.failedNames) {
    console.log(`- ${name}`);
  }
}

await new Promise((resolve) => logStream.end(resolve));

protocol.emitFinal({
  status,
  ambiguousCounts,
  reason:
    status === 'passed'
      ? ambiguousCounts
        ? 'ambiguous_counts'
        : 'clean_success'
      : 'compose_e2e_build_failed',
});

process.exit(result.code);
