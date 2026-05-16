import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach, mock } from 'node:test';

import type { ModelInfo } from '@github/copilot-sdk';
import type { LMStudioClient } from '@lmstudio/sdk';
import express from 'express';
import request from 'supertest';

import {
  __resetProviderBootstrapStatusForTests,
  __setProviderBootstrapStatusForTests,
} from '../../config/runtimeConfig.js';
import { baseLogger } from '../../logger.js';
import { resetMcpStatusCache } from '../../providers/mcpStatus.js';
import {
  createChatModelsRouter,
  TASK6_LOG_MARKER,
} from '../../routes/chatModels.js';
import { createMockCopilotSdkHarness } from '../support/mockCopilotSdk.js';

type EnvSnapshot = Map<string, string | undefined>;

const env = {
  snapshot: new Map() as EnvSnapshot,
  set(key: string, value: string | undefined) {
    if (!this.snapshot.has(key)) {
      this.snapshot.set(key, process.env[key]);
    }
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  },
  restore() {
    for (const [key, value] of this.snapshot.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    this.snapshot.clear();
  },
};

function createClient(): LMStudioClient {
  return {
    system: {
      listDownloadedModels: async () => [],
    },
  } as unknown as LMStudioClient;
}

async function startServer(params: {
  mcpAvailable?: boolean;
  copilotModels?: ModelInfo[];
  startError?: Error;
}) {
  const app = express();
  app.use(express.json());

  app.post('/mcp', (_req, res) => {
    if (params.mcpAvailable ?? true) {
      res.json({ result: { ok: true } });
    } else {
      res.status(200).json({ error: { message: 'unavailable' } });
    }
  });

  const copilotHarness = createMockCopilotSdkHarness({
    name: 'chat-models-copilot',
    models: params.copilotModels,
    startError: params.startError,
  });

  app.use(
    '/chat',
    createChatModelsRouter({
      clientFactory: () => createClient(),
      copilotRuntimeFactory: () => copilotHarness.createLifecycle(),
    }),
  );

  const httpServer = http.createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  env.set('CODEINFO_SERVER_PORT', String(address.port));
  env.set('MCP_URL', `http://127.0.0.1:${address.port}/mcp`);

  return {
    httpServer,
  };
}

async function stopServer(server: { httpServer: http.Server }) {
  await new Promise<void>((resolve) =>
    server.httpServer.close(() => resolve()),
  );
}

beforeEach(() => {
  resetMcpStatusCache();
  __resetProviderBootstrapStatusForTests();
});

afterEach(async () => {
  env.restore();
  resetMcpStatusCache();
  __resetProviderBootstrapStatusForTests();
  mock.restoreAll();
});

test('copilot models route returns readiness-driven unavailable response before discovery', async () => {
  const server = await startServer({
    startError: new Error('copilot offline'),
  });

  try {
    const res = await request(server.httpServer)
      .get('/chat/models?provider=copilot')
      .expect(200);

    assert.equal(res.body.provider, 'copilot');
    assert.equal(res.body.available, false);
    assert.equal(res.body.toolsAvailable, false);
    assert.equal(res.body.reason, 'copilot connectivity unavailable');
    assert.deepEqual(res.body.models, []);
  } finally {
    await stopServer(server);
  }
});

test('copilot models route handles an empty model list deterministically', async () => {
  const server = await startServer({
    copilotModels: [],
  });

  try {
    const res = await request(server.httpServer)
      .get('/chat/models?provider=copilot')
      .expect(200);

    assert.equal(res.body.provider, 'copilot');
    assert.equal(res.body.available, false);
    assert.equal(res.body.toolsAvailable, false);
    assert.equal(res.body.reason, 'copilot models unavailable');
    assert.deepEqual(res.body.models, []);
  } finally {
    await stopServer(server);
  }
});

test('copilot models route keeps top-level availability aligned with degraded bootstrap status', async () => {
  __setProviderBootstrapStatusForTests('copilot', {
    healthy: false,
    reason: 'copilot bootstrap degraded',
  });

  const server = await startServer({
    copilotModels: [
      {
        id: 'copilot-gpt-5',
        name: 'Copilot GPT-5',
      } as ModelInfo,
    ],
  });

  try {
    const res = await request(server.httpServer)
      .get('/chat/models?provider=copilot')
      .expect(200);

    assert.equal(res.body.provider, 'copilot');
    assert.equal(res.body.available, false);
    assert.equal(res.body.toolsAvailable, false);
    assert.equal(res.body.reason, 'copilot bootstrap degraded');
    assert.equal(res.body.providerInfo.available, false);
    assert.equal(res.body.providerInfo.toolsAvailable, false);
    assert.equal(res.body.providerInfo.reason, 'copilot bootstrap degraded');
    assert.deepEqual(res.body.models, []);
  } finally {
    await stopServer(server);
  }
});

test('chat models route rejects malformed provider query values deterministically', async () => {
  const server = await startServer({
    copilotModels: [
      {
        id: 'copilot-gpt-5',
        name: 'Copilot GPT-5',
      } as ModelInfo,
    ],
  });

  try {
    const res = await request(server.httpServer)
      .get('/chat/models?provider=bogus')
      .expect(400);

    assert.deepEqual(res.body, {
      error: 'invalid_request',
      message: 'provider must be one of: codex, copilot, lmstudio',
    });
  } finally {
    await stopServer(server);
  }
});

test('copilot models route maps only verified shared-contract fields and logs ignored extras', async () => {
  const tempCopilotHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'chat-models-copilot-home-'),
  );
  env.set('CODEINFO_COPILOT_HOME', tempCopilotHome);
  const markerPayloads: Array<Record<string, unknown>> = [];
  mock.method(baseLogger, 'info', (first: unknown, second: unknown) => {
    if (second === TASK6_LOG_MARKER && first && typeof first === 'object') {
      markerPayloads.push(first as Record<string, unknown>);
    }
  });

  const server = await startServer({
    copilotModels: [
      {
        id: 'copilot-gpt-5',
        name: 'Copilot GPT-5',
        capabilities: {
          supports: { vision: false, reasoningEffort: true },
          limits: { max_context_window_tokens: 200000 },
        },
        supportedReasoningEfforts: ['low', 'medium', 'high', 'medium'],
        defaultReasoningEffort: 'medium',
        experimentalMetadata: { provider: 'copilot' },
      } as ModelInfo,
      {
        id: 'missing-name',
        name: '   ',
        supportedReasoningEfforts: ['high'],
        defaultReasoningEffort: 'high',
      } as ModelInfo,
    ],
  });

  try {
    const res = await request(server.httpServer)
      .get('/chat/models?provider=copilot')
      .expect(200);

    assert.equal(res.body.provider, 'copilot');
    assert.equal(res.body.available, true);
    assert.equal(res.body.toolsAvailable, true);
    assert.equal(res.body.reason, undefined);
    assert.deepEqual(res.body.models, [
      {
        key: 'copilot-gpt-5',
        displayName: 'Copilot GPT-5',
        type: 'copilot',
        supportedReasoningEfforts: ['low', 'medium', 'high'],
        defaultReasoningEffort: 'medium',
        flagOverrides: [
          {
            key: 'modelReasoningEffort',
            resolvedDefault: 'medium',
            supportedValues: [
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ],
          },
        ],
      },
    ]);
    assert.equal(res.body.providerInfo.id, 'copilot');
    assert.equal(res.body.defaultModel, 'copilot-gpt-5');
    assert.equal(res.body.defaultModelSource, 'hardcoded');
    assert.deepEqual(
      res.body.agentFlags.map((entry: { key: string }) => entry.key),
      ['modelReasoningEffort', 'toolAccess'],
    );
    assert.equal(
      'capabilities' in (res.body.models[0] as Record<string, unknown>),
      false,
    );
    assert.equal(
      'experimentalMetadata' in (res.body.models[0] as Record<string, unknown>),
      false,
    );

    const marker = markerPayloads.at(-1);
    assert.ok(marker);
    assert.equal(marker.provider, 'copilot');
    assert.equal(marker.mappedModelCount, 1);
    assert.equal(marker.ignoredUnsupportedFields, true);
  } finally {
    await stopServer(server);
    await fs.rm(tempCopilotHome, { recursive: true, force: true });
  }
});

test('copilot models route normalizes stale configured defaults to a live runnable model and avoids fake reasoning defaults on unsupported models', async () => {
  const tempCopilotHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'chat-models-copilot-normalized-home-'),
  );
  await fs.mkdir(path.join(tempCopilotHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCopilotHome, 'chat', 'config.toml'),
    ['model = "copilot-gpt-5"', 'reasoning_effort = "high"', ''].join('\n'),
    'utf8',
  );
  env.set('CODEINFO_COPILOT_HOME', tempCopilotHome);

  const server = await startServer({
    copilotModels: [
      {
        id: 'gpt-5-mini',
        name: 'GPT-5 Mini',
      } as ModelInfo,
      {
        id: 'gpt-5',
        name: 'GPT-5',
        supportedReasoningEfforts: ['low', 'medium', 'high'],
        defaultReasoningEffort: 'medium',
      } as ModelInfo,
    ],
  });

  try {
    const res = await request(server.httpServer)
      .get('/chat/models?provider=copilot')
      .expect(200);

    assert.equal(res.body.defaultModel, 'gpt-5-mini');
    assert.equal(res.body.providerInfo.defaultModel, 'gpt-5-mini');
    assert.equal(res.body.models[0]?.key, 'gpt-5-mini');
    assert.equal(
      'supportedReasoningEfforts' in
        (res.body.models[0] as Record<string, unknown>),
      false,
    );
    assert.equal(
      'defaultReasoningEffort' in
        (res.body.models[0] as Record<string, unknown>),
      false,
    );
    assert.deepEqual(res.body.models[0]?.flagOverrides, []);
    assert.match(
      (res.body.warnings ?? []).join('\n'),
      /normalized to "gpt-5-mini"/u,
    );
  } finally {
    await stopServer(server);
    await fs.rm(tempCopilotHome, { recursive: true, force: true });
  }
});

test('copilot models route degrades malformed chat defaults to warnings instead of failing discovery', async () => {
  const tempCopilotHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'chat-models-copilot-malformed-home-'),
  );
  await fs.mkdir(path.join(tempCopilotHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCopilotHome, 'chat', 'config.toml'),
    'tool_access = [\n',
    'utf8',
  );
  env.set('CODEINFO_COPILOT_HOME', tempCopilotHome);

  const server = await startServer({
    copilotModels: [
      {
        id: 'copilot-gpt-5',
        name: 'Copilot GPT-5',
      } as ModelInfo,
    ],
  });

  try {
    const res = await request(server.httpServer)
      .get('/chat/models?provider=copilot')
      .expect(200);

    assert.equal(res.body.provider, 'copilot');
    assert.equal(res.body.available, true);
    assert.equal(res.body.defaultModel, 'copilot-gpt-5');
    assert.equal(res.body.defaultModelSource, 'hardcoded');
    assert.deepEqual(
      res.body.agentFlags.map(
        (entry: { key: string; resolvedDefault: unknown }) => ({
          key: entry.key,
          resolvedDefault: entry.resolvedDefault,
        }),
      ),
      [
        { key: 'modelReasoningEffort', resolvedDefault: 'medium' },
        { key: 'toolAccess', resolvedDefault: 'on' },
      ],
    );
    assert.match(
      (res.body.warnings ?? []).join('\n'),
      /default model resolution/i,
    );
    assert.match(
      (res.body.warnings ?? []).join('\n'),
      /agentFlags resolution/i,
    );
  } finally {
    await stopServer(server);
    await fs.rm(tempCopilotHome, { recursive: true, force: true });
  }
});

test('copilot models route clamps unsupported configured defaults to the runtime-supported Copilot defaults', async () => {
  const tempCopilotHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'chat-models-copilot-unsupported-home-'),
  );
  await fs.mkdir(path.join(tempCopilotHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCopilotHome, 'chat', 'config.toml'),
    ['reasoning_effort = "turbo"', 'tool_access = "maybe"', ''].join('\n'),
    'utf8',
  );
  env.set('CODEINFO_COPILOT_HOME', tempCopilotHome);

  const server = await startServer({
    copilotModels: [
      {
        id: 'copilot-gpt-5',
        name: 'Copilot GPT-5',
        supportedReasoningEfforts: ['low', 'medium', 'high'],
        defaultReasoningEffort: 'medium',
      } as ModelInfo,
    ],
  });

  try {
    const res = await request(server.httpServer)
      .get('/chat/models?provider=copilot')
      .expect(200);

    assert.equal(res.body.provider, 'copilot');
    assert.deepEqual(
      res.body.agentFlags.map(
        (entry: { key: string; resolvedDefault: unknown }) => ({
          key: entry.key,
          resolvedDefault: entry.resolvedDefault,
        }),
      ),
      [
        { key: 'modelReasoningEffort', resolvedDefault: 'medium' },
        { key: 'toolAccess', resolvedDefault: 'on' },
      ],
    );
    assert.equal(res.body.warnings?.length ?? 0, 0);
  } finally {
    await stopServer(server);
    await fs.rm(tempCopilotHome, { recursive: true, force: true });
  }
});
