import assert from 'node:assert/strict';
import http from 'node:http';
import test, { afterEach, beforeEach } from 'node:test';

import type { LMStudioClient } from '@lmstudio/sdk';
import express from 'express';
import request from 'supertest';

import type { CodexCapabilityResolution } from '../../codex/capabilityResolver.js';
import { baseLogger } from '../../logger.js';
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
  codexCapabilityResolver?: (options: {
    consumer: 'chat_models' | 'chat_validation';
  }) => CodexCapabilityResolution;
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
      codexCapabilityResolver: params.codexCapabilityResolver,
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

test('codex models include non-empty supportedReasoningEfforts arrays', async () => {
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

    for (const model of res.body.models as Array<Record<string, unknown>>) {
      assert.equal(model.type, 'codex');
      assert.ok(Array.isArray(model.supportedReasoningEfforts));
      assert.ok(model.supportedReasoningEfforts.length > 0);
      for (const effort of model.supportedReasoningEfforts) {
        assert.equal(typeof effort, 'string');
        assert.ok(effort.length > 0);
      }
    }
  } finally {
    await stopServer(server);
  }
});

test('codex models include defaultReasoningEffort present in supportedReasoningEfforts', async () => {
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

    for (const model of res.body.models as Array<Record<string, unknown>>) {
      const supported = model.supportedReasoningEfforts as string[];
      const defaultEffort = model.defaultReasoningEffort as string;
      assert.equal(typeof defaultEffort, 'string');
      assert.ok(defaultEffort.length > 0);
      assert.ok(supported.includes(defaultEffort));
    }
  } finally {
    await stopServer(server);
  }
});

test('chat models payload is derived from shared capability resolver fixture', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const fixture: CodexCapabilityResolution = {
    defaults: {
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'on-failure',
      modelReasoningEffort: 'minimal',
      networkAccessEnabled: true,
      webSearchEnabled: true,
    },
    models: [
      {
        model: 'fixture-model',
        supportedReasoningEfforts: ['minimal', 'high'],
        defaultReasoningEffort: 'minimal',
      },
    ],
    byModel: new Map([
      [
        'fixture-model',
        {
          model: 'fixture-model',
          supportedReasoningEfforts: ['minimal', 'high'],
          defaultReasoningEffort: 'minimal',
        },
      ],
    ]),
    warnings: ['fixture warning'],
    fallbackUsed: false,
  };

  const server = await startServer({
    mcpAvailable: true,
    codexCapabilityResolver: () => fixture,
  });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);
  try {
    const res = await request(server.httpServer)
      .get('/chat/models?provider=codex')
      .expect(200);

    assert.deepEqual(res.body.models, [
      {
        key: 'fixture-model',
        displayName: 'fixture-model',
        type: 'codex',
        supportedReasoningEfforts: ['minimal', 'high'],
        defaultReasoningEffort: 'minimal',
      },
    ]);
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
    assert.deepEqual(res.body.models, []);
    assert.ok(res.body.codexDefaults);
    assert.ok(Array.isArray(res.body.codexWarnings));
  } finally {
    await stopServer(server);
  }
});

test('codex capability resolver fallback is deterministic when metadata resolution fails', async () => {
  env.set('Codex_reasoning_efforts_metadata', '__throw__');
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

    assert.ok(res.body.models.length > 0);
    for (const model of res.body.models as Array<Record<string, unknown>>) {
      assert.ok(Array.isArray(model.supportedReasoningEfforts));
      assert.ok((model.supportedReasoningEfforts as string[]).length > 0);
      assert.equal(typeof model.defaultReasoningEffort, 'string');
    }
    assert.ok(
      res.body.codexWarnings.some((warning: string) =>
        warning.includes('fallback capabilities'),
      ),
    );
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

test('codex defaults include SDK-native minimal reasoning effort when configured', async () => {
  env.set('Codex_reasoning_effort', 'minimal');
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

    assert.equal(res.body.codexDefaults?.modelReasoningEffort, 'minimal');
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
  } finally {
    await stopServer(server);
  }
});

test('emits deterministic T12 success log when codex capabilities are returned', async (t) => {
  env.set('Codex_model_list', 'alpha,beta');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const infoLines: string[] = [];
  const errorLines: string[] = [];
  t.mock.method(baseLogger, 'info', (...args: unknown[]) => {
    const message = args.find((arg) => typeof arg === 'string') as
      | string
      | undefined;
    if (message) infoLines.push(message);
  });
  t.mock.method(baseLogger, 'error', (...args: unknown[]) => {
    const message = args.find((arg) => typeof arg === 'string') as
      | string
      | undefined;
    if (message) errorLines.push(message);
  });

  const server = await startServer({ mcpAvailable: true });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);
  try {
    await request(server.httpServer)
      .get('/chat/models?provider=codex')
      .expect(200);
    assert.ok(
      infoLines.some((line) =>
        line.includes(
          '[DEV-0000037][T12] event=chat_models_codex_capabilities_returned result=success',
        ),
      ),
    );
    assert.equal(
      errorLines.some((line) =>
        line.includes(
          '[DEV-0000037][T12] event=chat_models_codex_capabilities_returned result=error',
        ),
      ),
      false,
    );
  } finally {
    await stopServer(server);
  }
});

test('emits deterministic T13 success log when shared resolver is consumed by /chat/models', async (t) => {
  env.set('Codex_model_list', 'alpha,beta');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const infoLines: string[] = [];
  t.mock.method(baseLogger, 'info', (...args: unknown[]) => {
    const message = args.find((arg) => typeof arg === 'string') as
      | string
      | undefined;
    if (message) infoLines.push(message);
  });

  const server = await startServer({ mcpAvailable: true });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);
  try {
    await request(server.httpServer)
      .get('/chat/models?provider=codex')
      .expect(200);
    assert.ok(
      infoLines.some((line) =>
        line.includes(
          '[DEV-0000037][T13] event=shared_capability_resolver_parity_enforced result=success',
        ),
      ),
    );
  } finally {
    await stopServer(server);
  }
});

test('emits deterministic T12 error log when codex is unavailable', async (t) => {
  setCodexDetection({
    available: false,
    authPresent: false,
    configPresent: false,
    reason: 'missing-cli',
  });

  const errorLines: string[] = [];
  t.mock.method(baseLogger, 'error', (...args: unknown[]) => {
    const message = args.find((arg) => typeof arg === 'string') as
      | string
      | undefined;
    if (message) errorLines.push(message);
  });

  const server = await startServer({ mcpAvailable: true });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);
  try {
    await request(server.httpServer)
      .get('/chat/models?provider=codex')
      .expect(200);
    assert.ok(
      errorLines.some((line) =>
        line.includes(
          '[DEV-0000037][T12] event=chat_models_codex_capabilities_returned result=error',
        ),
      ),
    );
  } finally {
    await stopServer(server);
  }
});

test('emits deterministic T13 error log when shared resolver metadata path fails intentionally', async (t) => {
  env.set('Codex_reasoning_efforts_metadata', '__throw__');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const errorLines: string[] = [];
  t.mock.method(baseLogger, 'error', (...args: unknown[]) => {
    const message = args.find((arg) => typeof arg === 'string') as
      | string
      | undefined;
    if (message) errorLines.push(message);
  });

  const server = await startServer({ mcpAvailable: true });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);
  try {
    await request(server.httpServer)
      .get('/chat/models?provider=codex')
      .expect(200);
    assert.ok(
      errorLines.some((line) =>
        line.includes(
          '[DEV-0000037][T13] event=shared_capability_resolver_parity_enforced result=error',
        ),
      ),
    );
  } finally {
    await stopServer(server);
  }
});

test('codex payload includes non-standard reasoning effort values from shared capability resolver', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const fixture: CodexCapabilityResolution = {
    defaults: {
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'on-failure',
      modelReasoningEffort: 'high',
      networkAccessEnabled: true,
      webSearchEnabled: true,
    },
    models: [
      {
        model: 'future-model',
        supportedReasoningEfforts: ['minimal', 'turbo'],
        defaultReasoningEffort: 'turbo',
      },
    ],
    byModel: new Map([
      [
        'future-model',
        {
          model: 'future-model',
          supportedReasoningEfforts: ['minimal', 'turbo'],
          defaultReasoningEffort: 'turbo',
        },
      ],
    ]),
    warnings: [],
    fallbackUsed: false,
  };

  const server = await startServer({
    mcpAvailable: true,
    codexCapabilityResolver: () => fixture,
  });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);
  try {
    const res = await request(server.httpServer)
      .get('/chat/models?provider=codex')
      .expect(200);

    assert.deepEqual(res.body.models[0].supportedReasoningEfforts, [
      'minimal',
      'turbo',
    ]);
    assert.equal(res.body.models[0].defaultReasoningEffort, 'turbo');
  } finally {
    await stopServer(server);
  }
});

test('codex models prioritize CHAT_DEFAULT_MODEL when codex is default provider', async () => {
  env.set('CHAT_DEFAULT_PROVIDER', 'codex');
  env.set('CHAT_DEFAULT_MODEL', 'gpt-5.1');
  env.set('Codex_model_list', 'gpt-5.3-codex,gpt-5.1,gpt-5.2');
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
    assert.equal(modelKeys[0], 'gpt-5.1');
  } finally {
    await stopServer(server);
  }
});

test('lmstudio models mark provider unavailable when no chat-capable model is returned', async () => {
  env.set('LMSTUDIO_BASE_URL', 'http://localhost:1234');

  const server = await startServer({
    mcpAvailable: true,
    clientFactory: () =>
      createClient([
        {
          modelKey: 'embed-1',
          displayName: 'Embedding Model',
          type: 'embedding',
        },
      ]),
  });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);
  try {
    const res = await request(server.httpServer)
      .get('/chat/models?provider=lmstudio')
      .expect(200);

    assert.equal(res.body.provider, 'lmstudio');
    assert.equal(res.body.available, false);
    assert.equal(res.body.toolsAvailable, false);
    assert.equal(res.body.reason, 'lmstudio unavailable');
    assert.equal(res.body.models.length, 0);
  } finally {
    await stopServer(server);
  }
});
