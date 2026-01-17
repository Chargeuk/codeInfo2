import assert from 'node:assert/strict';
import http from 'node:http';
import test, { afterEach, beforeEach } from 'node:test';

import type { LMStudioClient } from '@lmstudio/sdk';
import express from 'express';
import request from 'supertest';

import { setCodexDetection } from '../../providers/codexRegistry.js';
import { resetMcpStatusCache } from '../../providers/mcpStatus.js';
import { createChatModelsRouter } from '../../routes/chatModels.js';

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
  clientFactory?: () => LMStudioClient;
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
    createChatModelsRouter({
      clientFactory:
        params.clientFactory ??
        (() => createClient([{ modelKey: 'm', displayName: 'm' }])),
    }),
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

test('codex env model list parsing surfaces defaults and warnings', async () => {
  env.set('Codex_model_list', 'alpha,beta');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const server = await startServer({ mcpAvailable: true });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);
  try {
    const res = await request(server.httpServer)
      .get('/chat/models?provider=codex')
      .expect(200);

    assert.equal(res.body.provider, 'codex');
    assert.equal(res.body.models.length, 2);
    assert.ok(res.body.codexDefaults);
    assert.ok(Array.isArray(res.body.codexWarnings));
  } finally {
    await stopServer(server);
  }
});

test('codex response includes defaults and warnings when unavailable', async () => {
  setCodexDetection({
    available: false,
    authPresent: false,
    configPresent: false,
    reason: 'missing-cli',
  });

  const server = await startServer({ mcpAvailable: true });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);
  try {
    const res = await request(server.httpServer)
      .get('/chat/models?provider=codex')
      .expect(200);

    assert.equal(res.body.available, false);
    assert.equal(res.body.models.length, 0);
    assert.ok(res.body.codexDefaults);
    assert.ok(Array.isArray(res.body.codexWarnings));
  } finally {
    await stopServer(server);
  }
});

test('codex env default warnings propagate into codexWarnings', async () => {
  env.set('Codex_sandbox_mode', 'invalid');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const server = await startServer({ mcpAvailable: true });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);
  try {
    const res = await request(server.httpServer)
      .get('/chat/models?provider=codex')
      .expect(200);

    assert.ok(
      res.body.codexWarnings.some((warning: string) =>
        warning.includes('Codex_sandbox_mode'),
      ),
    );
  } finally {
    await stopServer(server);
  }
});

test('codex model list CSV trims, drops empties, and de-duplicates', async () => {
  env.set(
    'Codex_model_list',
    ' gpt-5.1-codex-max , , gpt-5.1, gpt-5.1 , gpt-5.2 ',
  );
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const server = await startServer({ mcpAvailable: true });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);
  try {
    const res = await request(server.httpServer)
      .get('/chat/models?provider=codex')
      .expect(200);

    const modelKeys = res.body.models.map(
      (model: { key: string }) => model.key,
    );
    assert.deepEqual(modelKeys, ['gpt-5.1-codex-max', 'gpt-5.1', 'gpt-5.2']);
  } finally {
    await stopServer(server);
  }
});

test('codex model list empty CSV falls back with warning', async () => {
  env.set('Codex_model_list', ' , , ');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const server = await startServer({ mcpAvailable: true });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);
  try {
    const res = await request(server.httpServer)
      .get('/chat/models?provider=codex')
      .expect(200);

    const modelKeys = res.body.models.map(
      (model: { key: string }) => model.key,
    );
    assert.ok(modelKeys.includes('gpt-5.2-codex'));
    assert.ok(
      res.body.codexWarnings.some((warning: string) =>
        warning.includes('Codex_model_list is empty'),
      ),
    );
  } finally {
    await stopServer(server);
  }
});

test('codex model list whitespace-only CSV falls back with warning', async () => {
  env.set('Codex_model_list', '   ');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const server = await startServer({ mcpAvailable: true });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);
  try {
    const res = await request(server.httpServer)
      .get('/chat/models?provider=codex')
      .expect(200);

    const modelKeys = res.body.models.map(
      (model: { key: string }) => model.key,
    );
    assert.ok(modelKeys.includes('gpt-5.2-codex'));
    assert.ok(
      res.body.codexWarnings.some((warning: string) =>
        warning.includes('Codex_model_list is empty'),
      ),
    );
  } finally {
    await stopServer(server);
  }
});

test('codex runtime warning when web search enabled but tools unavailable', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const server = await startServer({ mcpAvailable: false });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);
  try {
    const res = await request(server.httpServer)
      .get('/chat/models?provider=codex')
      .expect(200);

    assert.ok(
      res.body.codexWarnings.some((warning: string) =>
        warning.includes('web search is enabled'),
      ),
    );
  } finally {
    await stopServer(server);
  }
});

test('non-codex provider omits codex defaults fields', async () => {
  env.set('LMSTUDIO_BASE_URL', 'http://localhost:1234');

  const server = await startServer({
    mcpAvailable: true,
    clientFactory: () =>
      createClient([
        {
          modelKey: 'openai/gpt-oss-20b',
          displayName: 'OpenAI gpt-oss 20B',
          type: 'llm',
        },
      ]),
  });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);
  try {
    const res = await request(server.httpServer)
      .get('/chat/models?provider=lmstudio')
      .expect(200);

    assert.equal(res.body.provider, 'lmstudio');
    assert.equal(res.body.models.length, 1);
    assert.equal('codexDefaults' in res.body, false);
    assert.equal('codexWarnings' in res.body, false);
  } finally {
    await stopServer(server);
  }
});
