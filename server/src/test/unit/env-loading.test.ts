import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadStartupEnv } from '../../config/startupEnv.js';

const createServerRoot = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'codeinfo2-env-loading-'));

const writeEnvFile = (
  root: string,
  name: '.env' | '.env.local',
  body: string,
) => {
  fs.writeFileSync(path.join(root, name), body, 'utf8');
};

test('loads .env then .env.local with override precedence', () => {
  const serverRoot = createServerRoot();
  const targetEnv: Record<string, string | undefined> = {};

  writeEnvFile(
    serverRoot,
    '.env',
    ['OPENAI_EMBEDDING_KEY=from-env', 'OPENAI_MODE=base', ''].join('\n'),
  );
  writeEnvFile(
    serverRoot,
    '.env.local',
    ['OPENAI_EMBEDDING_KEY=from-env-local', ''].join('\n'),
  );

  const result = loadStartupEnv({ serverRoot, targetEnv });

  assert.equal(targetEnv.OPENAI_EMBEDDING_KEY, 'from-env-local');
  assert.equal(targetEnv.OPENAI_MODE, 'base');
  assert.deepEqual(result.orderedFiles, ['server/.env', 'server/.env.local']);
  assert.deepEqual(result.loadedFiles, ['server/.env', 'server/.env.local']);
  assert.equal(result.overrideApplied, true);
});

test('loads only .env when .env.local is absent', () => {
  const serverRoot = createServerRoot();
  const targetEnv: Record<string, string | undefined> = {};

  writeEnvFile(
    serverRoot,
    '.env',
    ['OPENAI_EMBEDDING_KEY=from-env', 'OPENAI_MODE=base', ''].join('\n'),
  );

  const result = loadStartupEnv({ serverRoot, targetEnv });

  assert.equal(targetEnv.OPENAI_EMBEDDING_KEY, 'from-env');
  assert.equal(targetEnv.OPENAI_MODE, 'base');
  assert.deepEqual(result.orderedFiles, ['server/.env', 'server/.env.local']);
  assert.deepEqual(result.loadedFiles, ['server/.env']);
  assert.equal(result.overrideApplied, false);
});

test('preserves runtime pre-seeded values when both env files are present', () => {
  const serverRoot = createServerRoot();
  const targetEnv: Record<string, string | undefined> = {
    OPENAI_EMBEDDING_KEY: 'from-runtime',
  };

  writeEnvFile(
    serverRoot,
    '.env',
    [
      'OPENAI_EMBEDDING_KEY=from-env',
      'OPENAI_MODE=from-env',
      'OPENAI_REGION=from-env',
      '',
    ].join('\n'),
  );
  writeEnvFile(
    serverRoot,
    '.env.local',
    [
      'OPENAI_EMBEDDING_KEY=from-env-local',
      'OPENAI_MODE=from-env-local',
      '',
    ].join('\n'),
  );

  const result = loadStartupEnv({ serverRoot, targetEnv });

  assert.equal(targetEnv.OPENAI_EMBEDDING_KEY, 'from-runtime');
  assert.equal(targetEnv.OPENAI_MODE, 'from-env-local');
  assert.equal(targetEnv.OPENAI_REGION, 'from-env');
  assert.deepEqual(result.loadedFiles, ['server/.env', 'server/.env.local']);
  assert.equal(result.overrideApplied, true);
});

test('preserves runtime pre-seeded values when only .env exists', () => {
  const serverRoot = createServerRoot();
  const targetEnv: Record<string, string | undefined> = {
    OPENAI_EMBEDDING_KEY: 'from-runtime',
  };

  writeEnvFile(
    serverRoot,
    '.env',
    ['OPENAI_EMBEDDING_KEY=from-env', 'OPENAI_MODE=from-env', ''].join('\n'),
  );

  const result = loadStartupEnv({ serverRoot, targetEnv });

  assert.equal(targetEnv.OPENAI_EMBEDDING_KEY, 'from-runtime');
  assert.equal(targetEnv.OPENAI_MODE, 'from-env');
  assert.deepEqual(result.loadedFiles, ['server/.env']);
  assert.equal(result.overrideApplied, false);
});
