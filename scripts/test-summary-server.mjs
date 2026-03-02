#!/usr/bin/env node
// Purpose: reduce token usage by printing only a compact server test summary in the terminal.
// Use: `npm run test:summary:server` from the repository root.
// Behavior: executes the existing server workspace test command, writes full output to test-results/ for inspection,
// and prints only total/passed/failed counts plus failing test names when present.
// Why: this keeps routine AI-assisted runs low-noise while still preserving full logs when failures need diagnosis.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const resultsDir = path.join(rootDir, 'test-results');
const timestamp = new Date()
  .toISOString()
  .replaceAll(':', '-')
  .replaceAll('.', '-');
const logPath = path.join(resultsDir, `server-tests-${timestamp}.log`);

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

const sumFromMatches = (output, pattern) =>
  [...output.matchAll(pattern)].reduce(
    (sum, match) => sum + Number(match[1]),
    0,
  );

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

  for (const match of output.matchAll(/not ok \d+ - (.+)$/gim)) {
    names.add(match[1].trim());
  }
  for (const match of output.matchAll(
    /^[ \t]*✖[ \t]+(.+?)(?: \(\d+(?:\.\d+)?ms\))?$/gm,
  )) {
    names.add(match[1].trim());
  }

  return [...names];
};

const result = await run(
  'npm',
  ['run', 'test', '--workspace', 'server'],
  rootDir,
);
writeFileSync(logPath, result.output, 'utf8');

const unitTestsTotal = sumFromMatches(result.output, /^# tests (\d+)$/gim);
const unitTestsPassed = sumFromMatches(result.output, /^# pass (\d+)$/gim);
const unitTestsFailed = sumFromMatches(result.output, /^# fail (\d+)$/gim);
const { scenariosTotal, scenariosPassed, scenariosFailed } =
  parseCucumberScenarioCounts(result.output);

const total = unitTestsTotal + scenariosTotal;
const passed = unitTestsPassed + scenariosPassed;
const failed = unitTestsFailed + scenariosFailed;
const failingNames = parseFailureNames(result.output);

console.log(`[server] log: ${path.relative(rootDir, logPath)}`);
console.log(`[server] tests run: ${total}`);
console.log(`[server] passed: ${passed}`);
console.log(`[server] failed: ${failed}`);
if (failingNames.length > 0) {
  console.log('[server] failing tests:');
  for (const name of failingNames) {
    console.log(`- ${name}`);
  }
}

process.exit(result.code);
