#!/usr/bin/env node
// Purpose: reduce token usage by printing only a compact server cucumber summary in the terminal.
// Use: `npm run test:summary:server:cucumber` from repository root.
// Behavior: builds the server workspace, runs cucumber features, writes full output to test-results/,
// and prints only total/passed/failed counts plus failing scenario names when present.
// Optional targeting:
//   --tags <expr>      cucumber tag expression.
//   --feature <path>   repeatable; run only selected feature files.
//   --scenario <expr>  forwarded to cucumber --name.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const serverDir = path.join(rootDir, 'server');
const resultsDir = path.join(rootDir, 'test-results');
const timestamp = new Date()
  .toISOString()
  .replaceAll(':', '-')
  .replaceAll('.', '-');
const logPath = path.join(resultsDir, `server-cucumber-tests-${timestamp}.log`);

mkdirSync(resultsDir, { recursive: true });

const args = process.argv.slice(2);
const options = {
  tags: undefined,
  features: [],
  scenario: undefined,
};

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--tags') {
    const value = args[i + 1];
    if (!value) {
      console.error('Missing value for --tags');
      process.exit(1);
    }
    options.tags = value;
    i += 1;
    continue;
  }
  if (arg === '--feature') {
    const value = args[i + 1];
    if (!value) {
      console.error('Missing value for --feature');
      process.exit(1);
    }
    options.features.push(value);
    i += 1;
    continue;
  }
  if (arg === '--scenario') {
    const value = args[i + 1];
    if (!value) {
      console.error('Missing value for --scenario');
      process.exit(1);
    }
    options.scenario = value;
    i += 1;
    continue;
  }
  if (arg === '--help') {
    console.log(
      'Usage: npm run test:summary:server:cucumber -- [--tags <expr>] [--feature <path>] [--scenario <pattern>]',
    );
    process.exit(0);
  }
  console.error(`Unknown argument: ${arg}`);
  process.exit(1);
}

const run = (cmd, argsValue, cwd, env = process.env) =>
  new Promise((resolve) => {
    const child = spawn(cmd, argsValue, {
      cwd,
      env,
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

const normalizeServerPath = (value) => {
  if (path.isAbsolute(value)) return value;
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('server/')) return normalized.slice('server/'.length);
  return normalized;
};

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
  for (const match of output.matchAll(
    /^[ \t]*✖[ \t]+(.+?)(?: \(\d+(?:\.\d+)?ms\))?$/gm,
  )) {
    names.add(match[1].trim());
  }
  return [...names];
};

const buildResult = await run(
  'npm',
  ['run', 'build', '--workspace', 'server'],
  rootDir,
);

const featureArgs =
  options.features.length > 0
    ? options.features.map((file) => normalizeServerPath(file))
    : ['src/test/features/**/*.feature'];
const tagsExpression = options.tags
  ? `(${options.tags}) and (not @skip)`
  : 'not @skip';

const cucumberArgs = [
  ...featureArgs,
  '--import',
  'src/test/support/chromaContainer.ts',
  '--import',
  'src/test/support/mongoContainer.ts',
  '--import',
  'src/test/steps/**/*.ts',
  '--tags',
  tagsExpression,
];
if (options.scenario) {
  cucumberArgs.push('--name', options.scenario);
}

const cucumberEnv = {
  ...process.env,
  LOG_FILE_PATH: '../logs/server-cucumber.log',
  CHROMA_URL: '',
  MONGO_URI: '',
  TS_NODE_FILES: 'true',
  TS_NODE_PROJECT: './tsconfig.json',
  NODE_OPTIONS:
    '--import ./scripts/register-ts-node-esm-loader.mjs --disable-warning=DEP0180',
};

let output = '';
output += '$ npm run build --workspace server\n';
output += buildResult.output;

let exitCode = buildResult.code;
if (buildResult.code === 0) {
  const cucumberResult = await run(
    'cucumber-js',
    cucumberArgs,
    serverDir,
    cucumberEnv,
  );
  output += `\n$ cucumber-js ${cucumberArgs.join(' ')}\n`;
  output += cucumberResult.output;
  exitCode = cucumberResult.code;
}

writeFileSync(logPath, output, 'utf8');

if (buildResult.code !== 0) {
  console.log(`[server:cucumber] log: ${path.relative(rootDir, logPath)}`);
  console.log('[server:cucumber] tests run: 0');
  console.log('[server:cucumber] passed: 0');
  console.log('[server:cucumber] failed: 1');
  console.log('[server:cucumber] failing tests:');
  console.log('- build failed');
  process.exit(buildResult.code);
}

const { scenariosTotal, scenariosPassed, scenariosFailed } =
  parseCucumberScenarioCounts(output);
const failingNames = parseFailureNames(output);

console.log(`[server:cucumber] log: ${path.relative(rootDir, logPath)}`);
console.log(`[server:cucumber] tests run: ${scenariosTotal}`);
console.log(`[server:cucumber] passed: ${scenariosPassed}`);
console.log(`[server:cucumber] failed: ${scenariosFailed}`);
if (failingNames.length > 0) {
  console.log('[server:cucumber] failing tests:');
  for (const name of failingNames) {
    console.log(`- ${name}`);
  }
}

process.exit(exitCode);
