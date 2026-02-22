import assert from 'node:assert/strict';
import http from 'node:http';
import test, { afterEach, beforeEach } from 'node:test';

import type { LMStudioClient } from '@lmstudio/sdk';
import express from 'express';
import request from 'supertest';

import { setCodexDetection } from '../../providers/codexRegistry.js';
import { resetMcpStatusCache } from '../../providers/mcpStatus.js';
import { createChatProvidersRouter } from '../../routes/chatProviders.js';

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

const defaultDetection = {
  available: false,
  authPresent: false,
  configPresent: false,
  reason: 'not detected',
};

function createClient(
  models: {
    modelKey: string;
    displayName: string;
    type?: string;
  }[],
): LMStudioClient {
  return {
    system: {
      listDownloadedModels: async () => models,
    },
  } as LMStudioClient;
}

async function startServer(params: {
  mcpAvailable: boolean;
  clientFactory: () => LMStudioClient;
}) {
  const app = express();
  app.use(express.json());

  app.post('/mcp', (_req, res) => {
    if (params.mcpAvailable) {
      res.json({ result: { ok: true } });
    } else {
      res.status(200).json({ error: { message: 'unavailable' } });
    }
  });

  app.use(
    '/chat',
    createChatProvidersRouter({ clientFactory: params.clientFactory }),
  );

  const httpServer = http.createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  return {
    httpServer,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(server: { httpServer: http.Server }) {
  await new Promise<void>((resolve) =>
    server.httpServer.close(() => resolve()),
  );
}

beforeEach(() => {
  resetMcpStatusCache();
  setCodexDetection(defaultDetection);
});

afterEach(() => {
  env.restore();
  resetMcpStatusCache();
  setCodexDetection(defaultDetection);
});

test('providers route orders lmstudio first when codex default is unavailable and lmstudio is available', async () => {
  env.set('CHAT_DEFAULT_PROVIDER', 'codex');
  env.set('CHAT_DEFAULT_MODEL', 'gpt-5.3-codex');
  env.set('LMSTUDIO_BASE_URL', 'ws://localhost:1234');
  setCodexDetection({
    available: false,
    authPresent: false,
    configPresent: false,
    reason: 'CODE_INFO_LLM_UNAVAILABLE',
  });

  const server = await startServer({
    mcpAvailable: true,
    clientFactory: () =>
      createClient([{ modelKey: 'model-1', displayName: 'model-1' }]),
  });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);

  try {
    const res = await request(server.httpServer)
      .get('/chat/providers')
      .expect(200);

    assert.equal(res.body.providers[0].id, 'lmstudio');
    assert.equal(res.body.providers[0].available, true);
    assert.equal(res.body.providers[1].id, 'codex');
    assert.equal(res.body.providers[1].available, false);
    assert.equal(res.body.providers[1].reason, 'CODE_INFO_LLM_UNAVAILABLE');
  } finally {
    await stopServer(server);
  }
});

test('providers route keeps codex first when lmstudio has no selectable model', async () => {
  env.set('CHAT_DEFAULT_PROVIDER', 'lmstudio');
  env.set('CHAT_DEFAULT_MODEL', 'model-1');
  env.set('LMSTUDIO_BASE_URL', 'ws://localhost:1234');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const server = await startServer({
    mcpAvailable: true,
    clientFactory: () => createClient([]),
  });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);

  try {
    const res = await request(server.httpServer)
      .get('/chat/providers')
      .expect(200);

    assert.equal(res.body.providers[0].id, 'codex');
    assert.equal(res.body.providers[0].available, true);
    assert.equal(res.body.providers[1].id, 'lmstudio');
    assert.equal(res.body.providers[1].available, false);
    assert.equal(res.body.providers[1].reason, 'lmstudio unavailable');
  } finally {
    await stopServer(server);
  }
});
