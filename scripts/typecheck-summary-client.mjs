#!/usr/bin/env node
// Purpose: reduce token usage by printing only a compact client typecheck summary in the terminal.
// Use: `npm run typecheck:summary:client` from repository root.
// Behavior: runs `npm run typecheck --workspace client`, writes full output to logs/test-summaries/typecheck-client-latest.log,
// and prints only status, TypeScript error count, and log location.
// Note: until Task 17 converts the client workspace command to a non-emitting check, this wrapper still reflects the current `tsc -b` behavior.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const resultsDir = path.join(rootDir, 'logs', 'test-summaries');
const logPath = path.join(resultsDir, 'typecheck-client-latest.log');

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

const errorCount = (output) =>
  output.split(/\r?\n/).filter((line) => /error TS\d+:/i.test(line)).length;

const result = await run('npm', ['run', 'typecheck', '--workspace', 'client'], rootDir);
writeFileSync(logPath, result.output, 'utf8');

const status = result.code === 0 ? 'passed' : 'failed';

console.log(`[typecheck:client] status: ${status}`);
console.log(`[typecheck:client] errors: ${errorCount(result.output)}`);
console.log(`[typecheck:client] log: ${path.relative(rootDir, logPath)}`);

process.exit(result.code);
