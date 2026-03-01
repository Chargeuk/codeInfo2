#!/usr/bin/env node
// Purpose: reduce token usage by printing only a compact client build summary in the terminal.
// Use: `npm run build:summary:client` from repository root.
// Behavior: runs `npm run build --workspace client`, writes full output to logs/test-summaries/build-client-latest.log,
// and prints only status (passed/failed), warning count, and log location.
// Warning count: best-effort line-based parsing of build output for warning markers.
// Why: this keeps routine AI-assisted runs low-noise while preserving full build output for troubleshooting.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultsDir = path.join(rootDir, 'logs', 'test-summaries');
const logPath = path.join(resultsDir, 'build-client-latest.log');

mkdirSync(resultsDir, { recursive: true });

const run = (cmd, args, cwd) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });

const stripAnsi = (value) => value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');

const countWarnings = (output) => {
  const lines = stripAnsi(output).split(/\r?\n/);
  const warningLines = new Set();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/\bwarning\b/i.test(line) || /warning TS\d+:/i.test(line) || /\bnpm warn\b/i.test(line)) {
      warningLines.add(line);
    }
  }

  return warningLines.size;
};

const result = await run('npm', ['run', 'build', '--workspace', 'client'], rootDir);
writeFileSync(logPath, result.output, 'utf8');

const warningCount = countWarnings(result.output);
const status = result.code === 0 ? 'passed' : 'failed';

console.log(`[build:client] status: ${status}`);
console.log(`[build:client] warnings: ${warningCount}`);
console.log(`[build:client] log: ${path.relative(rootDir, logPath)}`);

process.exit(result.code);
