#!/usr/bin/env node
// Purpose: reduce token usage by printing only a compact docker compose build summary in the terminal.
// Use: `npm run compose:build:summary` from repository root.
// Behavior: runs `npm run compose:build` exactly as-is (no build-step changes), writes full output to
// logs/test-summaries/compose-build-latest.log, and prints only overall status, best-effort pass/fail counts,
// failed item names (when detectable), and log location.
// Caveats: pass/fail item counts are best-effort because docker/compose output format can vary by version/platform;
// overall pass/fail status is always reliable via process exit code.
// Why: this keeps routine AI-assisted runs low-noise while preserving full output for troubleshooting.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const resultsDir = path.join(rootDir, 'logs', 'test-summaries');
const logPath = path.join(resultsDir, 'compose-build-latest.log');

mkdirSync(resultsDir, { recursive: true });

const run = (cmd, args, cwd) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      resolve({ code: code ?? 1, output });
    };
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', (err) => {
      const message = err?.message ?? String(err);
      output += `\nSpawn error: ${message}\n`;
      finish(1);
    });
    child.on('close', (code) => finish(code));
  });

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

const result = await run('npm', ['run', 'compose:build'], rootDir);
writeFileSync(logPath, result.output, 'utf8');

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

console.log(`[compose:build] status: ${status}`);
console.log(`[compose:build] items passed: ${passedLabel}`);
console.log(`[compose:build] items failed: ${failedLabel}`);
if (parsed.failedNames.length > 0) {
  console.log('[compose:build] failed items:');
  for (const name of parsed.failedNames) {
    console.log(`- ${name}`);
  }
}
console.log(`[compose:build] log: ${path.relative(rootDir, logPath)}`);

process.exit(result.code);
