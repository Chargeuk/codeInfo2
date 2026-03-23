import assert from 'assert';
import type { Server } from 'http';
import { mockModelsResponse } from '@codeinfo2/common';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import type { LMStudioClient } from '@lmstudio/sdk';
import cors from 'cors';
import express from 'express';
import { append as appendLog, query } from '../../logStore.js';
import { baseLogger, createRequestLogger } from '../../logger.js';
import { createChatModelsRouter } from '../../routes/chatModels.js';
import { createChatProvidersRouter } from '../../routes/chatProviders.js';
import { createLogsRouter } from '../../routes/logs.js';
import {
  startNamedCopilotScenarioServer,
  type StartedNamedCopilotScenarioServer,
} from '../support/copilotBootPath.js';
import {
  NAMED_COPILOT_SCENARIOS,
  type NamedCopilotScenario,
} from '../support/copilotScenarioCatalog.js';
import {
  MockLMStudioClient,
  type MockScenario,
  startMock,
  stopMock,
} from '../support/mockLmStudioSdk.js';

const TASK17_LOG_MARKER = 'story.0000051.task17.cucumber_scenarios_registered';

let server: Server | null = null;
let baseUrl = '';
let response: { status: number; body: unknown | null } | null = null;
let namedCopilotScenarioServer: StartedNamedCopilotScenarioServer | null = null;

function isNamedCopilotScenario(name: string): name is NamedCopilotScenario {
  return (NAMED_COPILOT_SCENARIOS as readonly string[]).includes(name);
}

async function startLegacyModelsServer() {
  const app = express();
  app.use(cors());
  app.use(createRequestLogger());
  app.use((req, res, next) => {
    const requestId = (req as unknown as { id?: string }).id;
    if (requestId) res.locals.requestId = requestId;
    next();
  });
  app.use(
    '/chat',
    createChatModelsRouter({
      clientFactory: () =>
        new MockLMStudioClient() as unknown as LMStudioClient,
    }),
  );
  app.use(
    '/chat',
    createChatProvidersRouter({
      clientFactory: () =>
        new MockLMStudioClient() as unknown as LMStudioClient,
    }),
  );
  app.use('/logs', createLogsRouter());

  await new Promise<void>((resolve) => {
    const listener = app.listen(0, () => {
      server = listener;
      const address = listener.address();
      if (!address || typeof address === 'string') {
        throw new Error('Unable to start test server');
      }
      baseUrl = `http://localhost:${address.port}`;
      resolve();
    });
  });
}

function registerTask17Scenario(scenarioName: NamedCopilotScenario) {
  const context = {
    scenario: scenarioName,
    surface: 'cucumber',
    feature: 'chat_models',
  };
  appendLog({
    level: 'info',
    message: TASK17_LOG_MARKER,
    timestamp: new Date().toISOString(),
    source: 'server',
    context,
  });
  baseLogger.info(context, TASK17_LOG_MARKER);
}

Before(async () => {
  process.env.CODEINFO_LMSTUDIO_BASE_URL = 'ws://localhost:1234';
  response = null;
  baseUrl = '';
});

After(async () => {
  stopMock();
  if (namedCopilotScenarioServer) {
    await namedCopilotScenarioServer.stop();
    namedCopilotScenarioServer = null;
  }
  if (server) {
    server.close();
    server = null;
  }
});

Given('chat models scenario {string}', async (name: string) => {
  if (isNamedCopilotScenario(name)) {
    namedCopilotScenarioServer = await startNamedCopilotScenarioServer({
      scenarioName: name,
    });
    baseUrl = namedCopilotScenarioServer.baseUrl;
    registerTask17Scenario(name);
    return;
  }

  startMock({ scenario: name as MockScenario });
  await startLegacyModelsServer();
});

When('I request chat models', async () => {
  const res = await fetch(`${baseUrl}/chat/models`);
  response = { status: res.status, body: await res.json() };
});

When(
  'I request chat models for provider {string}',
  async (provider: string) => {
    const res = await fetch(`${baseUrl}/chat/models?provider=${provider}`);
    response = { status: res.status, body: await res.json() };
  },
);

When('I request chat providers', async () => {
  const res = await fetch(`${baseUrl}/chat/providers`);
  response = { status: res.status, body: await res.json() };
});

Then('the chat models response status code is {int}', (status: number) => {
  assert(response, 'expected response');
  assert.equal(response.status, status);
});

Then('the chat providers response status code is {int}', (status: number) => {
  assert(response, 'expected response');
  assert.equal(response.status, status);
});

Then('the chat models body equals the mock models fixture', () => {
  assert(response, 'expected response');
  const body = response.body as Record<string, unknown>;
  const normalized = {
    ...body,
    codexDefaults: body.codexDefaults ?? undefined,
    codexWarnings: body.codexWarnings ?? undefined,
  };
  assert.deepStrictEqual(normalized, mockModelsResponse);
});

Then(
  'the chat models field {string} equals {string}',
  (field: string, expected: string) => {
    assert(response?.body, 'expected response body');
    const value = (response.body as Record<string, unknown>)[field];
    assert.equal(String(value), expected);
  },
);

Then(
  'the chat provider {string} is visible with availability {string} and reason {string}',
  (providerId: string, availability: string, reason: string) => {
    assert(response?.body, 'expected response body');
    const providers = (
      response.body as { providers?: Array<Record<string, unknown>> }
    ).providers;
    assert(Array.isArray(providers), 'expected providers array');
    const provider = providers.find((entry) => entry.id === providerId);
    assert(provider, `expected provider ${providerId}`);
    assert.equal(String(provider.available), availability);
    assert.equal(String(provider.reason), reason);
  },
);

Then('the chat models response provider is {string}', (provider: string) => {
  assert(response?.body, 'expected response body');
  assert.equal(
    String((response.body as Record<string, unknown>).provider),
    provider,
  );
});

Then('the chat models list includes model {string}', (modelKey: string) => {
  assert(response?.body, 'expected response body');
  const models = (response.body as { models?: Array<Record<string, unknown>> })
    .models;
  assert(Array.isArray(models), 'expected models array');
  const model = models.find((entry) => entry.key === modelKey);
  assert(model, `expected model ${modelKey}`);
});

Then(
  'the Copilot Cucumber registration log records scenario {string}',
  (scenarioName: string) => {
    const entries = query({ text: TASK17_LOG_MARKER });
    assert(entries.length > 0, 'expected Task 17 registration log entry');
    const match = entries.find(
      (entry) => entry.context?.scenario === scenarioName,
    );
    assert(match, `expected registration log for ${scenarioName}`);
  },
);
