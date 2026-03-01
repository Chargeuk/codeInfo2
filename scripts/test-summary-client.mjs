#!/usr/bin/env node
// Purpose: run client tests with minimal terminal output while preserving full logs for debugging.
// Use: `npm run test:summary:client` from the repository root.
// Behavior: executes the existing client workspace test command, writes full output to test-results/,
// and prints only total/passed/failed counts plus failing test names when present.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultsDir = path.join(rootDir, 'test-results');
const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const logPath = path.join(resultsDir, `client-tests-${timestamp}.log`);
const jsonPath = path.join(resultsDir, `client-tests-${timestamp}.json`);

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

const result = await run(
  'npm',
  ['run', 'test', '--workspace', 'client', '--', '--json', '--outputFile', jsonPath],
  rootDir,
);

writeFileSync(logPath, result.output, 'utf8');

let total = 0;
let passed = 0;
let failed = 0;
const failingNames = new Set();

try {
  const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
  total = Number(parsed?.numTotalTests ?? 0);
  passed = Number(parsed?.numPassedTests ?? 0);
  failed = Number(parsed?.numFailedTests ?? 0);
  for (const suite of parsed?.testResults ?? []) {
    for (const assertion of suite?.assertionResults ?? []) {
      if (assertion?.status === 'failed') {
        failingNames.add(assertion.fullName || assertion.title || suite.name);
      }
    }
  }
} catch {
  const failMatches = result.output.matchAll(/^FAIL\s+(.+)$/gm);
  for (const match of failMatches) {
    failingNames.add(match[1].trim());
  }
}

console.log(`[client] log: ${path.relative(rootDir, logPath)}`);
console.log(`[client] tests run: ${total}`);
console.log(`[client] passed: ${passed}`);
console.log(`[client] failed: ${failed}`);
if (failingNames.size > 0) {
  console.log('[client] failing tests:');
  for (const name of failingNames) {
    console.log(`- ${name}`);
  }
}

process.exit(result.code);
