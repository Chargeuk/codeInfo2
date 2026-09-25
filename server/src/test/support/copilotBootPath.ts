import assert from 'node:assert/strict';
import http from 'node:http';

import type { LMStudioClient } from '@lmstudio/sdk';
import express, { type Request, type RequestHandler, type Response } from 'express';

import {
  getMemoryTurns,
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import {
  resetStore,
  append as appendLog,
  query as queryLogs,
} from '../../logStore.js';
import { baseLogger } from '../../logger.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { createChatRouter } from '../../routes/chat.js';
import { createChatModelsRouter } from '../../routes/chatModels.js';
import { createChatProvidersRouter } from '../../routes/chatProviders.js';
import { createCopilotDeviceAuthRouter } from '../../routes/copilotDeviceAuth.js';
import {
  createCopilotAlreadyAuthenticatedResponse,
  createCopilotCompletedResponse,
  createCopilotCompletionPendingResponse,
  createCopilotFailedResponse,
  createCopilotUnavailableBeforeStartResponse,
  createCopilotVerificationReadyResponse,
  type CopilotDeviceAuthCompletion,
  type CopilotDeviceAuthResultWithCompletion,
} from '../../utils/copilotDeviceAuth.js';
import { attachWs, type WsServerHandle } from '../../ws/server.js';
import {
  TASK16_LOG_MARKER,
  getTask16BootLogContext,
  getTask16LmStudioModels,
  resolveNamedCopilotScenario,
  type NamedCopilotScenario,
} from './copilotScenarioCatalog.js';
import {
  createMockCopilotDeviceAuthHarness,
  type MockCopilotDeviceAuthHarness,
  type MockCopilotDeviceAuthCompletionState,
  type MockCopilotDeviceAuthStartResult,
} from './mockCopilotDeviceAuth.js';
import {
  createMockCopilotSdkHarness,
  type MockCopilotSdkHarness,
} from './mockCopilotSdk.js';
import {
  bindCurrentTestEnvOverrides,
  enterTestEnvOverrides,
} from './testEnvOverrideScope.js';
import { resolveConfiguredTestTimeoutMs } from './testTimeouts.js';

type EnvSnapshot = Map<string, string | undefined>;

const env = {
  snapshot: new Map() as EnvSnapshot,
  set(key: string, value: string | undefined) {
    if (!this.snapshot.has(key)) {
      this.snapshot.set(key, process.env[key]);
    }
    enterTestEnvOverrides({ [key]: value });
  },
  restore() {
    for (const [key, value] of this.snapshot.entries()) {
      enterTestEnvOverrides({ [key]: value });
    }
    this.snapshot.clear();
  },
};

const createDummyClientFactory = (available: boolean) => () =>
  ({
    system: {
      listDownloadedModels: async () =>
        available
          ? getTask16LmStudioModels().map((model) => ({
              modelKey: model.key,
              displayName: model.displayName,
              type: model.type,
            }))
          : [],
    },
    llm: {
      model: async () => ({
        act: async () => undefined,
      }),
    },
  }) as unknown as LMStudioClient;

function toCompletionResult(
  state: MockCopilotDeviceAuthCompletionState,
  verification?: {
    verificationUrl: string;
    userCode: string;
    displayOutput: string;
  },
): CopilotDeviceAuthCompletion['result'] {
  switch (state.status) {
    case 'completion_pending':
      return createCopilotCompletionPendingResponse({
        verificationUrl: verification?.verificationUrl,
        userCode: verification?.userCode,
        displayOutput: verification?.displayOutput,
      });
    case 'completed':
      return createCopilotCompletedResponse();
    case 'already_authenticated':
      return createCopilotAlreadyAuthenticatedResponse();
    case 'failed':
      return createCopilotFailedResponse(state.reason);
    case 'unavailable_before_start':
      return createCopilotUnavailableBeforeStartResponse(state.reason);
  }
}

function toDeviceAuthResult(
  startResult: MockCopilotDeviceAuthStartResult,
): CopilotDeviceAuthResultWithCompletion {
  switch (startResult.status) {
    case 'verification_ready': {
      const verification = {
        verificationUrl: startResult.verificationUrl,
        userCode: startResult.userCode,
        displayOutput: startResult.rawOutput,
      };
      return {
        ...createCopilotVerificationReadyResponse(verification),
        completion: startResult.completion.then((state) => ({
          exitCode:
            state.status === 'failed' ||
            state.status === 'unavailable_before_start'
              ? 1
              : 0,
          result: toCompletionResult(state, verification),
        })),
      };
    }
    case 'already_authenticated': {
      const result = createCopilotAlreadyAuthenticatedResponse();
      return {
        ...result,
        completion: Promise.resolve({ exitCode: 0, result }),
      };
    }
    case 'failed': {
      const result = createCopilotFailedResponse(startResult.reason);
      return {
        ...result,
        completion: Promise.resolve({ exitCode: 1, result }),
      };
    }
    case 'unavailable_before_start': {
      const result = createCopilotUnavailableBeforeStartResponse(
        startResult.reason,
      );
      return {
        ...result,
        completion: Promise.resolve({ exitCode: 1, result }),
      };
    }
  }
}

export type StartedNamedCopilotScenarioServer = {
  scenarioName: NamedCopilotScenario;
  baseUrl: string;
  sdkHarness: MockCopilotSdkHarness;
  authHarness: MockCopilotDeviceAuthHarness;
  httpServer: http.Server;
  wsHandle: WsServerHandle;
  stop: () => Promise<void>;
};

export async function startNamedCopilotScenarioServer(params: {
  scenarioName: NamedCopilotScenario;
}) {
  const scenario = resolveNamedCopilotScenario(params.scenarioName);

  memoryConversations.clear();
  memoryTurns.clear();
  resetStore();
  setCodexDetection({
    available: false,
    authPresent: false,
    configPresent: false,
    reason: 'not detected',
  });

  const sdkHarness = createMockCopilotSdkHarness({
    name: scenario.sdkScenario.name ?? scenario.name,
    ...scenario.sdkScenario,
  });
  const authHarness = createMockCopilotDeviceAuthHarness({
    name: scenario.authScenario.name ?? `${scenario.name}-auth`,
    ...scenario.authScenario,
  });

  const bootContext = getTask16BootLogContext({
    scenarioName: scenario.name,
    surface: 'integration',
  });
  appendLog({
    level: 'info',
    message: TASK16_LOG_MARKER,
    timestamp: new Date().toISOString(),
    source: 'server',
    context: bootContext,
  });
  baseLogger.info(bootContext, TASK16_LOG_MARKER);

  const app = express();
  app.use(express.json());
  const clientFactory = createDummyClientFactory(scenario.lmstudioAvailable);
  const copilotRuntimeFactory = () => sdkHarness.createLifecycle();

  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) =>
    httpServer.listen(0, bindCurrentTestEnvOverrides(resolve)),
  );
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  env.set('CODEINFO_SERVER_PORT', String(address.port));
  env.set('MCP_URL', `http://127.0.0.1:${address.port}/mcp`);
  env.set('CODEX_HOME', undefined);
  env.set('CODEINFO_CODEX_HOME', undefined);
  env.set('CODEINFO_COPILOT_HOME', '/tmp/codeinfo2-task16-fake-copilot');
  env.set('CODEINFO_LMSTUDIO_HOME', undefined);
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', undefined);
  env.set('CODEINFO_CHAT_DEFAULT_MODEL', undefined);
  env.set(
    'CODEINFO_LMSTUDIO_BASE_URL',
    scenario.lmstudioAvailable ? 'http://127.0.0.1:1234' : 'http://127.0.0.1:9',
  );
  env.set('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS', undefined);
  env.set('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS', undefined);

  app.post('/mcp', bindCurrentTestEnvOverrides(((_req: Request, res: Response) => {
    if (!scenario.mcpAvailable) {
      res.status(200).json({ error: { message: 'unavailable' } });
      return;
    }
    res.json({ result: { ok: true } });
  }) as RequestHandler));
  app.use(
    '/chat',
    bindCurrentTestEnvOverrides(createChatRouter({
      clientFactory,
      copilotLifecycleFactory: copilotRuntimeFactory,
    })),
  );
  app.use(
    '/chat',
    bindCurrentTestEnvOverrides(createChatProvidersRouter({
      clientFactory,
      copilotRuntimeFactory,
    })),
  );
  app.use(
    '/chat',
    bindCurrentTestEnvOverrides(createChatModelsRouter({
      clientFactory,
      copilotRuntimeFactory,
    })),
  );
  app.use(
    '/copilot',
    bindCurrentTestEnvOverrides(createCopilotDeviceAuthRouter({
      getCopilotHome: () => '/tmp/codeinfo2-task16-fake-copilot',
      getCopilotConfigDirForHome: (home) => `${home}/config`,
      ensureCopilotAuthFileStore: async () => ({
        changed: false,
        configDir: '/tmp/codeinfo2-task16-fake-copilot/config',
      }),
      runCopilotDeviceAuth: async () =>
        toDeviceAuthResult(await authHarness.startDeviceAuth()),
      readDeviceAuthState: async () =>
        (await authHarness.readDeviceAuthState()) as
          | { status: 'completion_pending' }
          | { status: 'completed' }
          | { status: 'already_authenticated' }
          | { status: 'failed'; reason: string }
          | { status: 'unavailable_before_start'; reason: string },
      resolveCopilotCli: () => ({ available: true }),
      createRuntime: () => copilotRuntimeFactory(),
      env: process.env,
    })),
  );

  return {
    scenarioName: scenario.name,
    baseUrl: `http://127.0.0.1:${address.port}`,
    sdkHarness,
    authHarness,
    httpServer,
    wsHandle,
    stop: async () => {
      await wsHandle.close();
      await new Promise<void>((resolve) => {
        httpServer.close(bindCurrentTestEnvOverrides(() => resolve()));
        httpServer.closeIdleConnections?.();
        httpServer.closeAllConnections?.();
      });
      env.restore();
      memoryConversations.clear();
      memoryTurns.clear();
    },
  } satisfies StartedNamedCopilotScenarioServer;
}

export async function waitForAssistantTurn(
  conversationId: string,
  timeoutMs = 4000,
) {
  const deadline = Date.now() + resolveConfiguredTestTimeoutMs(timeoutMs);
  while (Date.now() < deadline) {
    const turns = getMemoryTurns(conversationId);
    if (turns.some((turn) => turn.role === 'assistant')) {
      return turns;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for assistant turn: ${conversationId}`);
}

export function queryTask16BootLogs() {
  return queryLogs({ text: TASK16_LOG_MARKER });
}
