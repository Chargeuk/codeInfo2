import assert from 'node:assert/strict';
import http from 'node:http';

import type { LMStudioClient } from '@lmstudio/sdk';
import express from 'express';

import {
  getMemoryTurns,
  memoryConversations,
  memoryTurns,
} from '../../../chat/memoryPersistence.js';
import { resetStore } from '../../../logStore.js';
import { setCodexDetection } from '../../../providers/codexRegistry.js';
import { createChatRouter } from '../../../routes/chat.js';
import { attachWs, type WsServerHandle } from '../../../ws/server.js';
import {
  createMockCopilotSdkHarness,
  type MockCopilotSdkHarness,
  type MockCopilotSdkScenario,
} from '../../support/mockCopilotSdk.js';

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

const createDummyClientFactory = (available: boolean) => () =>
  ({
    system: {
      listDownloadedModels: async () =>
        available
          ? [
              {
                modelKey: 'lmstudio-test-model',
                displayName: 'LM Studio Test Model',
                type: 'llm',
              },
            ]
          : [],
    },
    llm: {
      model: async () => ({
        act: async () => undefined,
      }),
    },
  }) as unknown as LMStudioClient;

export type StartedCopilotChatServer = {
  baseUrl: string;
  harness: MockCopilotSdkHarness;
  httpServer: http.Server;
  stop: () => Promise<void>;
  wsHandle?: WsServerHandle;
};

export async function startCopilotChatServer(params?: {
  scenario?: Partial<MockCopilotSdkScenario> & { name?: string };
  withWs?: boolean;
  lmstudioAvailable?: boolean;
  mcpAvailable?: boolean;
}) {
  memoryConversations.clear();
  memoryTurns.clear();
  resetStore();
  setCodexDetection({
    available: false,
    authPresent: false,
    configPresent: false,
    reason: 'not detected',
  });

  const harness = createMockCopilotSdkHarness({
    name: params?.scenario?.name ?? 'copilot-chat-integration',
    ...(params?.scenario ?? {}),
  });

  const app = express();
  app.use(express.json());
  app.post('/mcp', (_req, res) => {
    if (params?.mcpAvailable === false) {
      res.status(200).json({ error: { message: 'unavailable' } });
      return;
    }
    res.json({ result: { ok: true } });
  });
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: createDummyClientFactory(
        params?.lmstudioAvailable === true,
      ),
      copilotLifecycleFactory: () => harness.createLifecycle(),
    }),
  );

  const httpServer = http.createServer(app);
  const wsHandle = params?.withWs ? attachWs({ httpServer }) : undefined;
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  env.set('CODEINFO_SERVER_PORT', String(address.port));
  env.set('MCP_URL', `http://127.0.0.1:${address.port}/mcp`);
  env.set(
    'CODEINFO_LMSTUDIO_BASE_URL',
    params?.lmstudioAvailable === true
      ? 'http://127.0.0.1:1234'
      : 'http://127.0.0.1:9',
  );

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    harness,
    httpServer,
    wsHandle,
    stop: async () => {
      await wsHandle?.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      env.restore();
      memoryConversations.clear();
      memoryTurns.clear();
    },
  } satisfies StartedCopilotChatServer;
}

export async function waitForAssistantTurn(
  conversationId: string,
  timeoutMs = 4000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const turns = getMemoryTurns(conversationId);
    if (turns.some((turn) => turn.role === 'assistant')) {
      return turns;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for assistant turn: ${conversationId}`);
}
