import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  loadStartupEnv,
  resolveCodeinfoEnvResolutions,
  resolveOpenAiEmbeddingCapabilityState,
} from '../../config/startupEnv.js';
import { createOpenAiEmbeddingProvider } from '../../ingest/providers/index.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

const createServerRoot = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'codeinfo2-env-loading-'));

const writeEnvFile = (
  root: string,
  name: '.env' | '.env.local',
  body: string,
) => {
  fs.writeFileSync(path.join(root, name), body, 'utf8');
};

test('loads renamed CODEINFO env keys with .env.local override precedence', () => {
  const serverRoot = createServerRoot();
  const targetEnv: Record<string, string | undefined> = {};

  writeEnvFile(
    serverRoot,
    '.env',
    [
      'CODEINFO_OPENAI_EMBEDDING_KEY=from-env',
      'CODEINFO_CHAT_DEFAULT_PROVIDER=codex',
      '',
    ].join('\n'),
  );
  writeEnvFile(
    serverRoot,
    '.env.local',
    ['CODEINFO_OPENAI_EMBEDDING_KEY=from-env-local', ''].join('\n'),
  );

  const result = loadStartupEnv({ serverRoot, targetEnv });

  assert.equal(targetEnv.CODEINFO_OPENAI_EMBEDDING_KEY, 'from-env-local');
  assert.equal(targetEnv.CODEINFO_CHAT_DEFAULT_PROVIDER, 'codex');
  assert.deepEqual(result.orderedFiles, ['server/.env', 'server/.env.local']);
  assert.deepEqual(result.loadedFiles, ['server/.env', 'server/.env.local']);
  assert.equal(result.overrideApplied, true);
  assert.equal(
    result.valueSources.CODEINFO_OPENAI_EMBEDDING_KEY,
    'server/.env.local',
  );
  assert.equal(
    result.valueSources.CODEINFO_CHAT_DEFAULT_PROVIDER,
    'server/.env',
  );
});

test('optional renamed CODEINFO env keys stay absent and defaults can still resolve', () => {
  const serverRoot = createServerRoot();
  const targetEnv: Record<string, string | undefined> = {};

  writeEnvFile(serverRoot, '.env', ['SERVER_PORT=5010', ''].join('\n'));

  const result = loadStartupEnv({ serverRoot, targetEnv });
  const resolutions = resolveCodeinfoEnvResolutions({
    env: targetEnv,
    loadResult: result,
  });

  assert.equal(targetEnv.CODEINFO_LOG_LEVEL, undefined);
  assert.equal(targetEnv.CODEINFO_CHAT_DEFAULT_MODEL, undefined);
  assert.deepEqual(result.loadedFiles, ['server/.env']);
  assert.equal(result.overrideApplied, false);
  assert.equal(resolveOpenAiEmbeddingCapabilityState(targetEnv).enabled, false);
  assert.equal(
    resolutions.find((entry) => entry.name === 'CODEINFO_LOG_LEVEL')?.source,
    'absent',
  );
  assert.equal(
    resolutions.find((entry) => entry.name === 'CODEINFO_CHAT_DEFAULT_MODEL')
      ?.defined,
    false,
  );
});

test('runtime pre-seeded renamed CODEINFO values override file defaults', () => {
  const serverRoot = createServerRoot();
  const targetEnv: Record<string, string | undefined> = {
    CODEINFO_OPENAI_EMBEDDING_KEY: 'from-runtime',
  };

  writeEnvFile(
    serverRoot,
    '.env',
    [
      'CODEINFO_OPENAI_EMBEDDING_KEY=from-env',
      'CODEINFO_CHAT_DEFAULT_MODEL=from-env',
      '',
    ].join('\n'),
  );
  writeEnvFile(
    serverRoot,
    '.env.local',
    ['CODEINFO_CHAT_DEFAULT_MODEL=from-env-local', ''].join('\n'),
  );

  const result = loadStartupEnv({ serverRoot, targetEnv });

  assert.equal(targetEnv.CODEINFO_OPENAI_EMBEDDING_KEY, 'from-runtime');
  assert.equal(targetEnv.CODEINFO_CHAT_DEFAULT_MODEL, 'from-env-local');
  assert.equal(result.valueSources.CODEINFO_OPENAI_EMBEDDING_KEY, 'preseeded');
  assert.equal(
    result.valueSources.CODEINFO_CHAT_DEFAULT_MODEL,
    'server/.env.local',
  );
});

test('required renamed CODEINFO key errors still fire when the key is missing', () => {
  assert.throws(
    () => createOpenAiEmbeddingProvider({ apiKey: undefined }),
    /CODEINFO_OPENAI_EMBEDDING_KEY/,
  );
});

test('legacy-only env values fail deterministically instead of silently succeeding', () => {
  const serverRoot = createServerRoot();
  const targetEnv: Record<string, string | undefined> = {
    OPENAI_EMBEDDING_KEY: 'legacy-only',
  };

  const result = loadStartupEnv({ serverRoot, targetEnv });

  assert.equal(targetEnv.CODEINFO_OPENAI_EMBEDDING_KEY, undefined);
  assert.equal(resolveOpenAiEmbeddingCapabilityState(targetEnv).enabled, false);
  assert.equal(
    resolveCodeinfoEnvResolutions({
      env: targetEnv,
      loadResult: result,
    }).find((entry) => entry.name === 'CODEINFO_OPENAI_EMBEDDING_KEY')?.source,
    'absent',
  );
  assert.throws(
    () =>
      createOpenAiEmbeddingProvider({
        apiKey: targetEnv.CODEINFO_OPENAI_EMBEDDING_KEY,
      }),
    /CODEINFO_OPENAI_EMBEDDING_KEY/,
  );
});

test('checked-in defaults and wrappers seed only renamed CODEINFO server env names', () => {
  const files = [
    'server/.env',
    'server/.env.e2e',
    'docker-compose.yml',
    'docker-compose.local.yml',
    'docker-compose.e2e.yml',
    'scripts/test-summary-server-unit.mjs',
    'scripts/test-summary-server-cucumber.mjs',
    'server/package.json',
  ];
  const legacyNames = [
    'LMSTUDIO_BASE_URL',
    'OPENAI_EMBEDDING_KEY',
    'CHAT_DEFAULT_PROVIDER',
    'CHAT_DEFAULT_MODEL',
    'INGEST_INCLUDE',
    'INGEST_EXCLUDE',
    'INGEST_FLUSH_EVERY',
    'INGEST_COLLECTION',
    'INGEST_ROOTS_COLLECTION',
    'INGEST_TEST_GIT_PATHS',
    'LOG_FILE_PATH',
    'LOG_LEVEL',
    'LOG_BUFFER_MAX',
    'LOG_MAX_CLIENT_BYTES',
    'LOG_INGEST_WS_THROTTLE_MS',
    'LOG_FILE_ROTATE',
  ];

  for (const relativePath of files) {
    const text = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    assert.match(text, /CODEINFO_/);
    for (const legacyName of legacyNames) {
      assert.equal(
        new RegExp(`\\b${legacyName}\\b`).test(text),
        false,
        `${relativePath} should not seed legacy env ${legacyName}`,
      );
    }
  }
});
