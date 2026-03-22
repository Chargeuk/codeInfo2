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
const legacyServerEnv = (...parts: string[]) => parts.join('_');
const assertDefinedString = (value: string | undefined) => {
  assert.equal(typeof value, 'string');
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

  writeEnvFile(
    serverRoot,
    '.env',
    ['CODEINFO_SERVER_PORT=5010', ''].join('\n'),
  );

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

test('runtime server env rename inventory is surfaced through startup env resolution', () => {
  const serverRoot = createServerRoot();
  const targetEnv: Record<string, string | undefined> = {};

  writeEnvFile(
    serverRoot,
    '.env',
    [
      'CODEINFO_SERVER_PORT=5510',
      'CODEINFO_MONGO_URI=mongodb://example/db',
      'CODEINFO_CHROMA_URL=http://example:8000',
      'CODEINFO_CHAT_MCP_PORT=5511',
      'CODEINFO_AGENTS_MCP_PORT=5512',
      'CODEINFO_HOST_INGEST_DIR=/host/base',
      'CODEINFO_OPENAI_INGEST_MAX_RETRIES=8',
      '',
    ].join('\n'),
  );

  const result = loadStartupEnv({ serverRoot, targetEnv });
  const resolutions = resolveCodeinfoEnvResolutions({
    env: targetEnv,
    loadResult: result,
  });

  for (const name of [
    'CODEINFO_SERVER_PORT',
    'CODEINFO_MONGO_URI',
    'CODEINFO_CHROMA_URL',
    'CODEINFO_CHAT_MCP_PORT',
    'CODEINFO_AGENTS_MCP_PORT',
    'CODEINFO_HOST_INGEST_DIR',
    'CODEINFO_OPENAI_INGEST_MAX_RETRIES',
  ] as const) {
    assertDefinedString(targetEnv[name]);
    assert.equal(
      resolutions.find((entry) => entry.name === name)?.source,
      'server/.env',
    );
    assert.equal(
      resolutions.find((entry) => entry.name === name)?.defined,
      true,
    );
    assert.equal(
      resolutions.find((entry) => entry.name === name)?.nonEmpty,
      true,
    );
  }
});

test('runtime startup env resolution also surfaces CODEINFO_CHAT_MCP_PORT when it is defined', () => {
  const serverRoot = createServerRoot();
  const targetEnv: Record<string, string | undefined> = {};

  writeEnvFile(
    serverRoot,
    '.env',
    ['CODEINFO_CHAT_MCP_PORT=6511', ''].join('\n'),
  );

  const result = loadStartupEnv({ serverRoot, targetEnv });
  const resolutions = resolveCodeinfoEnvResolutions({
    env: targetEnv,
    loadResult: result,
  });

  assert.equal(targetEnv.CODEINFO_CHAT_MCP_PORT, '6511');
  assert.equal(
    resolutions.find((entry) => entry.name === 'CODEINFO_CHAT_MCP_PORT')
      ?.defined,
    true,
  );
  assert.equal(
    resolutions.find((entry) => entry.name === 'CODEINFO_CHAT_MCP_PORT')
      ?.source,
    'server/.env',
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

test('pre-cutover-only env values fail deterministically instead of silently succeeding', () => {
  const serverRoot = createServerRoot();
  const targetEnv: Record<string, string | undefined> = {
    [legacyServerEnv('OPENAI', 'EMBEDDING', 'KEY')]: 'legacy-only',
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
    legacyServerEnv('SERVER', 'PORT'),
    legacyServerEnv('MONGO', 'URI'),
    legacyServerEnv('CHROMA', 'URL'),
    legacyServerEnv('MCP', 'PORT'),
    legacyServerEnv('AGENTS', 'MCP', 'PORT'),
    legacyServerEnv('HOST', 'INGEST', 'DIR'),
    legacyServerEnv('OPENAI', 'INGEST', 'MAX', 'RETRIES'),
    legacyServerEnv('LMSTUDIO', 'BASE', 'URL'),
    legacyServerEnv('OPENAI', 'EMBEDDING', 'KEY'),
    legacyServerEnv('CHAT', 'DEFAULT', 'PROVIDER'),
    legacyServerEnv('CHAT', 'DEFAULT', 'MODEL'),
    legacyServerEnv('INGEST', 'INCLUDE'),
    legacyServerEnv('INGEST', 'EXCLUDE'),
    legacyServerEnv('INGEST', 'FLUSH', 'EVERY'),
    legacyServerEnv('INGEST', 'COLLECTION'),
    legacyServerEnv('INGEST', 'ROOTS', 'COLLECTION'),
    legacyServerEnv('INGEST', 'TEST', 'GIT', 'PATHS'),
    legacyServerEnv('LOG', 'FILE', 'PATH'),
    legacyServerEnv('LOG', 'LEVEL'),
    legacyServerEnv('LOG', 'BUFFER', 'MAX'),
    legacyServerEnv('LOG', 'MAX', 'CLIENT', 'BYTES'),
    legacyServerEnv('LOG', 'INGEST', 'WS', 'THROTTLE', 'MS'),
    legacyServerEnv('LOG', 'FILE', 'ROTATE'),
  ];

  for (const relativePath of files) {
    const text = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    assert.match(text, /CODEINFO_/);
    for (const legacyName of legacyNames) {
      assert.equal(
        new RegExp(`\\b${legacyName}\\b`).test(text),
        false,
        `${relativePath} should not seed pre-cutover env ${legacyName}`,
      );
    }
  }
});
