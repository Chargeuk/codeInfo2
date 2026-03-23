import assert from 'node:assert/strict';
import http from 'node:http';
import test, { afterEach, beforeEach, mock } from 'node:test';

import type { ModelInfo } from '@github/copilot-sdk';
import type { LMStudioClient } from '@lmstudio/sdk';
import express from 'express';
import request from 'supertest';

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
});

afterEach(async () => {
  env.restore();
  resetMcpStatusCache();
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

test('copilot models route maps only verified shared-contract fields and logs ignored extras', async () => {
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
      },
    ]);
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
  }
});
