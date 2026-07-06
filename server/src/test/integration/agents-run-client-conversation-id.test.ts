import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import supertest from 'supertest';

import {
  __resetAgentServiceDepsForTests,
  __setAgentServiceDepsForTests,
  runAgentCommand,
  runAgentInstruction,
  startAgentInstruction,
  startAgentCommand,
} from '../../agents/service.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import {
  __resetProviderBootstrapStatusForTests,
  __setProviderBootstrapStatusForTests,
} from '../../config/runtimeConfig.js';
import { startFlowRun } from '../../flows/service.js';
import { query, resetStore } from '../../logStore.js';
import { callTool } from '../../mcpAgents/tools.js';
import type { Conversation } from '../../mongo/conversation.js';
import { ConversationModel } from '../../mongo/conversation.js';
import { createAgentsRunRouter } from '../../routes/agentsRun.js';
import { createCodexDeviceAuthRouter } from '../../routes/codexDeviceAuth.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';
import { withConversationMetaNotFoundFixture } from '../support/conversationMetaNotFoundFixture.js';
import { withMockedMongoConversationPersistence } from '../support/conversationMongoPersistenceStub.js';
import { startExternalOpenAiCompatServer } from '../support/externalOpenAiCompatServer.js';
import { bindCurrentTestOverrides } from '../support/testOverrideScope.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';

class MinimalChat extends ChatInterface {
  async execute(
    _message: string,
    _flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _model;
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: 'ok' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

class CapturingChat extends ChatInterface {
  constructor(
    private readonly capture: (flags: Record<string, unknown>) => void,
  ) {
    super();
  }

  async execute(
    _message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _model;
    this.capture({ ...flags });
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: 'ok' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

class CapturingModelChat extends ChatInterface {
  constructor(
    private readonly capture: (payload: {
      flags: Record<string, unknown>;
      model: string;
    }) => void,
  ) {
    super();
  }

  async execute(
    _message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    model: string,
  ) {
    this.capture({ flags: { ...flags }, model });
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: 'ok' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

class DeferredChat extends ChatInterface {
  constructor(private readonly release: Promise<void>) {
    super();
  }

  async execute(
    _message: string,
    _flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _model;
    this.emit('thread', { type: 'thread', threadId: conversationId });
    await this.release;
    this.emit('final', { type: 'final', content: 'ok' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 2000,
  describe?: () => string,
) => {
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  const started = Date.now();
  while (Date.now() - started < resolvedTimeoutMs) {
    if (predicate()) return;
    await delay(25);
  }
  throw new Error(
    [
      'Timed out waiting for condition',
      `timeoutMs=${resolvedTimeoutMs}`,
      `conversationIds=${JSON.stringify([...memoryConversations.keys()].slice(-10))}`,
      `turnConversationIds=${JSON.stringify([...memoryTurns.keys()].slice(-10))}`,
      describe ? `details=${describe()}` : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(' | '),
  );
};

const createExecuteSignal = () => {
  let triggered = false;
  let latestFlags: Record<string, unknown> | null = null;
  let resolvePromise: ((flags: Record<string, unknown>) => void) | null = null;

  const promise = new Promise<Record<string, unknown>>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    wasTriggered: () => triggered,
    latestFlags: () => latestFlags,
    onExecute: (flags: Record<string, unknown>) => {
      latestFlags = { ...flags };
      if (triggered) return;
      triggered = true;
      resolvePromise?.(latestFlags);
    },
  };
};

const summarizeConversation = (
  conversation: Conversation | undefined,
): Record<string, unknown> | null => {
  if (!conversation) return null;
  const flowFlags = conversation.flags?.flow as
    | {
        executionId?: string;
        stepPath?: unknown;
        loopStack?: unknown;
        wait?: unknown;
      }
    | undefined;
  const flowChildFlags = conversation.flags?.flowChild as
    | {
        executionId?: string;
      }
    | undefined;

  return {
    conversationId: conversation._id,
    title: conversation.title,
    agentName: conversation.agentName ?? null,
    flowName: conversation.flowName ?? null,
    provider: conversation.provider,
    model: conversation.model,
    workingFolder:
      typeof conversation.flags?.workingFolder === 'string'
        ? conversation.flags.workingFolder
        : null,
    requestedProviderId:
      typeof conversation.flags?.requestedProviderId === 'string'
        ? conversation.flags.requestedProviderId
        : null,
    endpointId:
      typeof conversation.flags?.endpointId === 'string'
        ? conversation.flags.endpointId
        : null,
    flowExecutionId:
      typeof flowFlags?.executionId === 'string' ? flowFlags.executionId : null,
    flowStepPath: Array.isArray(flowFlags?.stepPath) ? flowFlags.stepPath : null,
    flowLoopDepth: Array.isArray(flowFlags?.loopStack)
      ? flowFlags.loopStack.length
      : null,
    flowWait: flowFlags?.wait ?? null,
    flowChildExecutionId:
      typeof flowChildFlags?.executionId === 'string'
        ? flowChildFlags.executionId
        : null,
    updatedAt:
      conversation.updatedAt instanceof Date
        ? conversation.updatedAt.toISOString()
        : String(conversation.updatedAt ?? ''),
  };
};

const summarizeTurns = (conversationId: string, limit = 6) =>
  (memoryTurns.get(conversationId) ?? []).slice(-limit).map((turn) => ({
    role: turn.role,
    status: turn.status,
    content: turn.content,
    command: turn.command ?? null,
  }));

const findTerminalAssistantTurn = (conversationId: string) => {
  const turns = memoryTurns.get(conversationId) ?? [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.role === 'assistant') return turn;
  }
  return null;
};

const summarizeConversationLogs = (conversationId: string, limit = 25) =>
  query({}, 500)
    .filter((entry) => {
      if (entry.message.includes(conversationId)) return true;
      const context = entry.context as Record<string, unknown> | undefined;
      return context?.conversationId === conversationId;
    })
    .slice(-limit)
    .map((entry) => ({
      sequence: entry.sequence ?? null,
      level: entry.level,
      message: entry.message,
      context: entry.context ?? null,
    }));

const listFlowChildConversations = (params: {
  agentName: string;
  executionId?: string | null;
}) =>
  [...memoryConversations.values()]
    .filter((conversation) => {
      if (conversation.agentName !== params.agentName) return false;
      const flowChildFlags = conversation.flags?.flowChild as
        | { executionId?: string }
        | undefined;
      if (
        params.executionId &&
        flowChildFlags?.executionId === params.executionId
      ) {
        return true;
      }
      return conversation.title?.includes(`(${params.agentName}-step)`) ?? false;
    })
    .map((conversation) => summarizeConversation(conversation));

const waitForFlowExecuteOrTerminal = async (params: {
  agentName: string;
  flowConversationId: string;
  executeSignal: ReturnType<typeof createExecuteSignal>;
  timeoutMs?: number;
}) => {
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(
    params.timeoutMs ?? 5000,
  );
  const started = Date.now();

  while (Date.now() - started < resolvedTimeoutMs) {
    if (params.executeSignal.wasTriggered()) {
      return params.executeSignal.latestFlags();
    }

    const terminalTurn = findTerminalAssistantTurn(params.flowConversationId);
    if (terminalTurn) {
      const parentConversation = memoryConversations.get(params.flowConversationId);
      const executionId = (() => {
        const flowFlags = parentConversation?.flags?.flow as
          | { executionId?: string }
          | undefined;
        return typeof flowFlags?.executionId === 'string'
          ? flowFlags.executionId
          : null;
      })();
      throw new Error(
        [
          'Flow reached a terminal assistant turn before first execute signal',
          `agentName=${params.agentName}`,
          `conversationId=${params.flowConversationId}`,
          `terminalStatus=${terminalTurn.status}`,
          `terminalContent=${JSON.stringify(terminalTurn.content)}`,
          `parentConversation=${JSON.stringify(summarizeConversation(parentConversation))}`,
          `parentTurns=${JSON.stringify(summarizeTurns(params.flowConversationId))}`,
          `childConversations=${JSON.stringify(listFlowChildConversations({ agentName: params.agentName, executionId }))}`,
          `recentLogs=${JSON.stringify(summarizeConversationLogs(params.flowConversationId))}`,
        ].join(' | '),
      );
    }

    await delay(25);
  }

  const parentConversation = memoryConversations.get(params.flowConversationId);
  const executionId = (() => {
    const flowFlags = parentConversation?.flags?.flow as
      | { executionId?: string }
      | undefined;
    return typeof flowFlags?.executionId === 'string'
      ? flowFlags.executionId
      : null;
  })();

  throw new Error(
    [
      'Timed out waiting for flow execute signal',
      `timeoutMs=${resolvedTimeoutMs}`,
      `agentName=${params.agentName}`,
      `conversationId=${params.flowConversationId}`,
      `parentConversation=${JSON.stringify(summarizeConversation(parentConversation))}`,
      `parentTurns=${JSON.stringify(summarizeTurns(params.flowConversationId))}`,
      `childConversations=${JSON.stringify(listFlowChildConversations({ agentName: params.agentName, executionId }))}`,
      `recentLogs=${JSON.stringify(summarizeConversationLogs(params.flowConversationId))}`,
    ].join(' | '),
  );
};

const toRuntimeConfigSnapshot = (flags: Record<string, unknown>) =>
  structuredClone(
    (flags.runtimeConfig as Record<string, unknown> | undefined) ?? {},
  );

const withoutModel = (runtimeConfig: Record<string, unknown>) => {
  const snapshot = structuredClone(runtimeConfig);
  delete snapshot.model;
  return snapshot;
};

const T18_SUCCESS_LOG =
  '[DEV-0000037][T18] event=precedence_normalization_regressions_executed result=success';
const T18_ERROR_LOG =
  '[DEV-0000037][T18] event=precedence_normalization_regressions_executed result=error';
const T19_SUCCESS_LOG =
  '[DEV-0000037][T19] event=migration_safety_regressions_executed result=success';
const T19_ERROR_LOG =
  '[DEV-0000037][T19] event=migration_safety_regressions_executed result=error';

let previousPreferredAgentsHome: string | undefined;

beforeEach(() => {
  previousPreferredAgentsHome = process.env.CODEINFO_AGENT_HOME;
  installDeterministicCodexAvailabilityBootstrap();
});

afterEach(() => {
  resetDeterministicCodexAvailabilityBootstrap();
  __resetProviderBootstrapStatusForTests();
  if (previousPreferredAgentsHome === undefined) {
    delete process.env.CODEINFO_AGENT_HOME;
  } else {
    process.env.CODEINFO_AGENT_HOME = previousPreferredAgentsHome;
  }
  previousPreferredAgentsHome = undefined;
});

test('Agents runs accept a client-supplied conversationId even when it does not exist yet', async () => {
  resetStore();

  const prevPreferredAgentsHome = process.env.CODEINFO_AGENT_HOME;
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  process.env.CODEINFO_AGENT_HOME = path.join(repoRoot, 'codeinfo_agents');
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');

  try {
    const providedConversationId = 'agents-client-provided-conversation-id-1';
    const result = await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Hello',
      conversationId: providedConversationId,
      source: 'REST',
      chatFactory: () => new MinimalChat(),
    });

    assert.equal(result.conversationId, providedConversationId);
    assert.equal(result.agentName, 'coding_agent');
  } finally {
    if (prevPreferredAgentsHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = prevPreferredAgentsHome;
    }
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
  }
});

test('direct agent execution uses the shared execution root when no working folder is provided', async () => {
  resetStore();

  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousCodexWorkdir = process.env.CODEINFO_CODEX_WORKDIR;
  const previousCodeWorkdir = process.env.CODEX_WORKDIR;
  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const sharedExecutionRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-shared-root-'),
  );
  const agentHome = path.join(tempAgentsHome, 'coding_agent');
  const capturedFlags: Array<Record<string, unknown>> = [];

  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['model = "gpt-5.3-codex"', 'approval_policy = "never"'].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(tempCodexHome, 'config.toml'), '', 'utf8');
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    '',
    'utf8',
  );

  delete process.env.CODEINFO_AGENT_HOME;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;
  process.env.CODEINFO_CODEX_WORKDIR = sharedExecutionRoot;
  delete process.env.CODEX_WORKDIR;

  try {
    await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Use the default repository root',
      conversationId: 'legacy-alias-default-root',
      source: 'REST',
      chatFactory: () =>
        new CapturingChat((flags) => {
          capturedFlags.push(flags);
        }),
    });

    const flags = capturedFlags.at(-1) as Record<string, unknown>;
    assert.equal(flags.workingDirectoryOverride, sharedExecutionRoot);
    assert.notEqual(flags.workingDirectoryOverride, process.cwd());
  } finally {
    memoryConversations.delete('legacy-alias-default-root');
    memoryTurns.delete('legacy-alias-default-root');
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    if (previousAgentsHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    }
    if (previousCodexHome === undefined) {
      delete process.env.CODEINFO_CODEX_HOME;
    } else {
      process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    }
    if (previousCodexWorkdir === undefined) {
      delete process.env.CODEINFO_CODEX_WORKDIR;
    } else {
      process.env.CODEINFO_CODEX_WORKDIR = previousCodexWorkdir;
    }
    if (previousCodeWorkdir === undefined) {
      delete process.env.CODEX_WORKDIR;
    } else {
      process.env.CODEX_WORKDIR = previousCodeWorkdir;
    }
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
    await fs.rm(sharedExecutionRoot, { recursive: true, force: true });
  }
});

test('direct agent start persists the final execution identity before background completion, and later runs ignore contradictory config drift', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-run-'));
  const agentsHome = path.join(tempRoot, 'agents');
  const agentHome = path.join(agentsHome, 'coding_agent');
  const codexHome = path.join(tempRoot, 'codex-home');
  await fs.mkdir(path.join(agentHome), { recursive: true });
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    'codeinfo_provider = "codex"\nmodel = "missing-codex-model"\n',
    'utf8',
  );
  await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    'model = "codex-repaired"\n',
    'utf8',
  );

  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;
  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: true,
      authPresent: true,
      configPresent: true,
    }),
    resolveCodexCapabilities: async () => ({
      defaults: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        modelReasoningEffort: 'high',
        networkAccessEnabled: true,
        webSearchEnabled: false,
        webSearchMode: 'disabled',
      },
      models: [
        {
          model: 'codex-repaired',
          supportedReasoningEfforts: ['high'],
          defaultReasoningEffort: 'high',
        },
      ],
      byModel: new Map(),
      warnings: [],
      fallbackUsed: false,
    }),
    getMcpStatus: async () => ({ available: true }),
    resolveCopilotReadiness: async () => ({
      available: true,
      toolsAvailable: true,
      blockingStage: 'ready',
      models: ['copilot-model'],
      modelsRaw: [
        {
          id: 'copilot-model',
          name: 'Copilot Model',
          capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 128000 },
          },
        },
      ],
      authSource: 'env-token',
    }),
  });

  let releaseRun!: () => void;
  const releasePromise = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });

  try {
    const started = await startAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Hello',
      conversationId: 'task5-persisted-identity',
      source: 'REST',
      chatFactory: () => new DeferredChat(releasePromise),
    });

    const persisted = memoryConversations.get(started.conversationId);
    assert.equal(started.providerId, 'codex');
    assert.equal(started.modelId, 'codex-repaired');
    assert.equal(persisted?.provider, 'codex');
    assert.equal(persisted?.model, 'codex-repaired');

    await fs.writeFile(
      path.join(agentHome, 'config.toml'),
      'codeinfo_provider = "copilot"\nmodel = "copilot-new-model"\n',
      'utf8',
    );

    releaseRun();
    await waitFor(
      () => (memoryTurns.get(started.conversationId) ?? []).length > 0,
      5000,
    );

    const resumed = await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Hello again',
      conversationId: started.conversationId,
      source: 'REST',
      chatFactory: () => new MinimalChat(),
    });

    assert.equal(resumed.providerId, 'codex');
    assert.equal(resumed.modelId, 'codex-repaired');
    const resumedConversation = memoryConversations.get(started.conversationId);
    assert.equal(resumedConversation?.provider, 'codex');
    assert.equal(resumedConversation?.model, 'codex-repaired');
  } finally {
    __resetAgentServiceDepsForTests();
    memoryConversations.clear();
    memoryTurns.clear();
    process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('direct agent start stops before completion when persisted metadata retries exhaust', async () => {
  const conversationId = 'task27-direct-retry-exhausted';
  const originalFindOneAndUpdate = ConversationModel.findOneAndUpdate;

  try {
    await withMockedMongoConversationPersistence({
      seedConversations: [
        {
          _id: conversationId,
          provider: 'codex',
          model: 'gpt-5.3-codex',
          title: 'Saved continuation',
          agentName: 'coding_agent',
          source: 'REST',
          flags: {},
          lastMessageAt: new Date(),
          archivedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Conversation,
      ],
      run: async ({ conversations }) => {
        let builtChat = false;
        ConversationModel.findOneAndUpdate = ((
          () => ({
            exec: async () => null,
          })
        ) as unknown) as typeof ConversationModel.findOneAndUpdate;

        await assert.rejects(
          runAgentInstruction({
            agentName: 'coding_agent',
            instruction: 'continue with saved requested provider',
            conversationId,
            source: 'REST',
            chatFactory: () => {
              builtChat = true;
              return new MinimalChat();
            },
          }),
          (error: unknown) =>
            error instanceof Error &&
            error.message === 'agent conversation metadata update exhausted',
        );

        assert.equal(builtChat, false);
        assert.equal(conversations.get(conversationId)?.provider, 'codex');
        assert.equal(conversations.get(conversationId)?.model, 'gpt-5.3-codex');
      },
    });
  } finally {
    ConversationModel.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test('direct agent start stops before completion when persisted metadata reports not_found after a concurrent delete', async () => {
  const conversationId = 'task29-direct-not-found';

  await withConversationMetaNotFoundFixture({
    seedConversation: {
      _id: conversationId,
      provider: 'codex',
      model: 'gpt-5.3-codex',
      title: 'Saved continuation',
      agentName: 'coding_agent',
      source: 'REST',
      flags: {},
      lastMessageAt: new Date(),
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    } as Conversation,
    run: async ({ conversations, capturedUpdates }) => {
      let builtChat = false;

        await assert.rejects(
          runAgentInstruction({
            agentName: 'coding_agent',
            instruction: 'continue with saved requested provider',
            conversationId,
            source: 'REST',
            chatFactory: () => {
              builtChat = true;
              return new MinimalChat();
            },
          }),
          (error: unknown) =>
            (error as { code?: string }).code === 'CONVERSATION_ARCHIVED',
        );

      assert.equal(builtChat, false);
      assert.equal(conversations.get(conversationId), undefined);
      assert.equal(capturedUpdates.length, 1);
    },
  });
});

test('runAgentCommand stops before the first synthetic turn persistence when persisted metadata retries exhaust', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const agentHome = path.join(tempAgentsHome, 'coding_agent');
  const commandsDir = path.join(agentHome, 'commands');
  const conversationId = 'task27-command-retry-exhausted';
  const originalFindOneAndUpdate = ConversationModel.findOneAndUpdate;

  await fs.mkdir(commandsDir, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['model = "gpt-5.3-codex"', 'approval_policy = "never"'].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(tempCodexHome, 'config.toml'), '', 'utf8');
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(tempCodexHome, 'chat', 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(commandsDir, 'retry-exhausted.json'),
    JSON.stringify(
      {
        Description: 'Retry exhausted command',
        items: [
          { type: 'message', role: 'user', content: ['step 1'] },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;

  try {
    await withMockedMongoConversationPersistence({
      seedConversations: [
        {
          _id: conversationId,
          provider: 'codex',
          model: 'gpt-5.3-codex',
          title: 'Saved command continuation',
          agentName: 'coding_agent',
          source: 'REST',
          flags: {},
          lastMessageAt: new Date(),
          archivedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Conversation,
      ],
      run: async ({ conversations }) => {
        ConversationModel.findOneAndUpdate = ((
          () => ({
            exec: async () => null,
          })
        ) as unknown) as typeof ConversationModel.findOneAndUpdate;

        await assert.rejects(
          runAgentCommand({
            agentName: 'coding_agent',
            commandName: 'retry-exhausted',
            conversationId,
            source: 'REST',
            chatFactory: () => new MinimalChat(),
          }),
          (error: unknown) =>
            error instanceof Error &&
            error.message === 'agent conversation metadata update exhausted',
        );

        assert.equal(conversations.get(conversationId)?.provider, 'codex');
        assert.equal(conversations.get(conversationId)?.model, 'gpt-5.3-codex');
      },
    });
  } finally {
    ConversationModel.findOneAndUpdate = originalFindOneAndUpdate;
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    if (previousAgentsHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    }
    if (previousCodexHome === undefined) {
      delete process.env.CODEINFO_CODEX_HOME;
    } else {
      process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    }
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
  }
});

test('startAgentCommand omission path defaults startStep to 1 and executes from step 1', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const agentHome = path.join(tempAgentsHome, 'coding_agent');
  const commandsDir = path.join(agentHome, 'commands');

  await fs.mkdir(commandsDir, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['model = "agent-model-1"', 'approval_policy = "never"'].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(tempCodexHome, 'config.toml'), '', 'utf8');
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    '',
    'utf8',
  );
  await fs.writeFile(
    path.join(commandsDir, 'start-default.json'),
    JSON.stringify(
      {
        Description: 'Start default',
        items: [
          { type: 'message', role: 'user', content: ['step 1'] },
          { type: 'message', role: 'user', content: ['step 2'] },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;

  const conversationId = 't03-start-command-omitted-start-step';
  const executeSignal = createExecuteSignal();
  try {
    await startAgentCommand({
      agentName: 'coding_agent',
      commandName: 'start-default',
      conversationId,
      source: 'REST',
      chatFactory: () =>
        new (class extends ChatInterface {
          async execute(
            _message: string,
            flags: Record<string, unknown>,
            childConversationId: string,
            _model: string,
          ) {
            void _message;
            void _model;
            executeSignal.onExecute(flags);
            this.emit('thread', {
              type: 'thread',
              threadId: childConversationId,
            });
            this.emit('final', { type: 'final', content: 'ok' });
            this.emit('complete', {
              type: 'complete',
              threadId: childConversationId,
            });
          }
        })(),
    });

    await waitFor(() => executeSignal.wasTriggered(), 5000, () =>
      JSON.stringify({
        conversation: summarizeConversation(memoryConversations.get(conversationId)),
        recentTurns: summarizeTurns(conversationId),
        recentLogs: summarizeConversationLogs(conversationId),
      }),
    );
    await waitFor(
      () =>
        (memoryTurns.get(conversationId) ?? []).some(
          (turn) =>
            turn.command?.stepIndex === 1 && turn.command.totalSteps === 2,
        ),
      5000,
      () =>
        JSON.stringify({
          executeTriggered: executeSignal.wasTriggered(),
          conversation: summarizeConversation(
            memoryConversations.get(conversationId),
          ),
          recentTurns: summarizeTurns(conversationId),
          recentLogs: summarizeConversationLogs(conversationId),
        }),
    );
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
  }
});

test('runAgentCommand omission path defaults startStep to 1 and executes from step 1', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const agentHome = path.join(tempAgentsHome, 'coding_agent');
  const commandsDir = path.join(agentHome, 'commands');

  await fs.mkdir(commandsDir, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['model = "agent-model-1"', 'approval_policy = "never"'].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(tempCodexHome, 'config.toml'), '', 'utf8');
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    '',
    'utf8',
  );
  await fs.writeFile(
    path.join(commandsDir, 'run-default.json'),
    JSON.stringify(
      {
        Description: 'Run default',
        items: [
          { type: 'message', role: 'user', content: ['step 1'] },
          { type: 'message', role: 'user', content: ['step 2'] },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;

  const conversationId = 't03-run-command-omitted-start-step';
  try {
    await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'run-default',
      conversationId,
      source: 'REST',
      chatFactory: () => new MinimalChat(),
    });

    const turns = memoryTurns.get(conversationId) ?? [];
    assert.equal(
      turns.some(
        (turn) =>
          turn.command?.stepIndex === 1 && turn.command.totalSteps === 2,
      ),
      true,
    );
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
  }
});

test('runtime step-count drift rejects stale startStep with deterministic INVALID_START_STEP', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const agentHome = path.join(tempAgentsHome, 'coding_agent');
  const commandsDir = path.join(agentHome, 'commands');

  await fs.mkdir(commandsDir, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['model = "agent-model-1"', 'approval_policy = "never"'].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(tempCodexHome, 'config.toml'), '', 'utf8');
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    '',
    'utf8',
  );

  const commandPath = path.join(commandsDir, 'drift.json');
  await fs.writeFile(
    commandPath,
    JSON.stringify(
      {
        Description: 'Drift test',
        items: [
          { type: 'message', role: 'user', content: ['step 1'] },
          { type: 'message', role: 'user', content: ['step 2'] },
          { type: 'message', role: 'user', content: ['step 3'] },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );
  // Simulate stale client metadata by shrinking command file before execution.
  await fs.writeFile(
    commandPath,
    JSON.stringify(
      {
        Description: 'Drift test',
        items: [
          { type: 'message', role: 'user', content: ['step 1'] },
          { type: 'message', role: 'user', content: ['step 2'] },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;

  try {
    await assert.rejects(
      async () =>
        runAgentCommand({
          agentName: 'coding_agent',
          commandName: 'drift',
          startStep: 3,
          source: 'REST',
          chatFactory: () => new MinimalChat(),
        }),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === 'object' &&
            (error as { code?: string }).code === 'INVALID_START_STEP' &&
            (error as { reason?: string }).reason ===
              'startStep must be between 1 and 2',
        ),
    );
  } finally {
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
  }
});

test('runAgentCommand rejects invalid startStep before provider preparation on zero-work paths', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const agentHome = path.join(tempAgentsHome, 'coding_agent');
  const commandsDir = path.join(agentHome, 'commands');

  await fs.mkdir(commandsDir, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['model = "agent-model-1"', 'approval_policy = "never"'].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(tempCodexHome, 'config.toml'), '', 'utf8');
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    '',
    'utf8',
  );
  await fs.writeFile(
    path.join(commandsDir, 'zero-work.json'),
    JSON.stringify(
      {
        Description: 'Zero work ordering guard',
        items: [{ type: 'message', role: 'user', content: ['step 1'] }],
      },
      null,
      2,
    ),
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;
  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: false,
      authPresent: false,
      configPresent: true,
      cliPath: undefined,
      reason: 'codex unavailable for ordering guard',
    }),
    resolveCodexCapabilities: async () => ({
      defaults: {
        sandboxMode: 'danger-full-access' as const,
        approvalPolicy: 'never' as const,
        modelReasoningEffort: 'high' as const,
        networkAccessEnabled: true,
        webSearchEnabled: false,
        webSearchMode: 'disabled' as const,
      },
      models: [],
      byModel: new Map(),
      warnings: [],
      fallbackUsed: false,
    }),
    resolveCopilotReadiness: async () => ({
      available: false,
      toolsAvailable: false,
      blockingStage: 'authentication' as const,
      models: [],
      modelsRaw: [],
      authSource: 'unauthenticated' as const,
    }),
    getMcpStatus: async () => ({ available: false }),
  });

  try {
    await assert.rejects(
      async () =>
        runAgentCommand({
          agentName: 'coding_agent',
          commandName: 'zero-work',
          startStep: 2,
          source: 'REST',
          chatFactory: () => new MinimalChat(),
        }),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === 'object' &&
            (error as { code?: string }).code === 'INVALID_START_STEP' &&
            (error as { reason?: string }).reason ===
              'startStep must be between 1 and 1',
        ),
    );
  } finally {
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
  }
});

test('startAgentCommand rejects invalid startStep before provider preparation on zero-work paths', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const agentHome = path.join(tempAgentsHome, 'coding_agent');
  const commandsDir = path.join(agentHome, 'commands');

  await fs.mkdir(commandsDir, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['model = "agent-model-1"', 'approval_policy = "never"'].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(tempCodexHome, 'config.toml'), '', 'utf8');
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    '',
    'utf8',
  );
  await fs.writeFile(
    path.join(commandsDir, 'zero-work.json'),
    JSON.stringify(
      {
        Description: 'Zero work ordering guard',
        items: [{ type: 'message', role: 'user', content: ['step 1'] }],
      },
      null,
      2,
    ),
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;
  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: false,
      authPresent: false,
      configPresent: true,
      cliPath: undefined,
      reason: 'codex unavailable for ordering guard',
    }),
    resolveCodexCapabilities: async () => ({
      defaults: {
        sandboxMode: 'danger-full-access' as const,
        approvalPolicy: 'never' as const,
        modelReasoningEffort: 'high' as const,
        networkAccessEnabled: true,
        webSearchEnabled: false,
        webSearchMode: 'disabled' as const,
      },
      models: [],
      byModel: new Map(),
      warnings: [],
      fallbackUsed: false,
    }),
    resolveCopilotReadiness: async () => ({
      available: false,
      toolsAvailable: false,
      blockingStage: 'authentication' as const,
      models: [],
      modelsRaw: [],
      authSource: 'unauthenticated' as const,
    }),
    getMcpStatus: async () => ({ available: false }),
  });

  try {
    await assert.rejects(
      async () =>
        startAgentCommand({
          agentName: 'coding_agent',
          commandName: 'zero-work',
          startStep: 2,
          source: 'REST',
          chatFactory: () => new MinimalChat(),
        }),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === 'object' &&
            (error as { code?: string }).code === 'INVALID_START_STEP' &&
            (error as { reason?: string }).reason ===
              'startStep must be between 1 and 1',
        ),
    );
  } finally {
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
  }
});

test('runAgentInstruction rejects invalid working_folder before provider preparation begins', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const agentHome = path.join(tempAgentsHome, 'coding_agent');
  const missingWorkingFolder = path.join(tempCodexHome, 'missing-working-copy');

  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['model = "agent-model-1"', 'approval_policy = "never"'].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(tempCodexHome, 'config.toml'), '', 'utf8');
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    '',
    'utf8',
  );

  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;
  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: false,
      authPresent: false,
      configPresent: true,
      cliPath: undefined,
      reason: 'codex unavailable for working-folder ordering guard',
    }),
    resolveCodexCapabilities: async () => ({
      defaults: {
        sandboxMode: 'danger-full-access' as const,
        approvalPolicy: 'never' as const,
        modelReasoningEffort: 'high' as const,
        networkAccessEnabled: true,
        webSearchEnabled: false,
        webSearchMode: 'disabled' as const,
      },
      models: [],
      byModel: new Map(),
      warnings: [],
      fallbackUsed: false,
    }),
    resolveCopilotReadiness: async () => ({
      available: false,
      toolsAvailable: false,
      blockingStage: 'authentication' as const,
      models: [],
      modelsRaw: [],
      authSource: 'unauthenticated' as const,
    }),
    getMcpStatus: async () => ({ available: false }),
  });

  try {
    await assert.rejects(
      async () =>
        runAgentInstruction({
          agentName: 'coding_agent',
          instruction: 'reject invalid folder before runtime prep',
          conversationId: 'task20-invalid-working-folder-ordering',
          working_folder: missingWorkingFolder,
          source: 'REST',
          chatFactory: () => new MinimalChat(),
        }),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === 'object' &&
            (error as { code?: string }).code === 'WORKING_FOLDER_NOT_FOUND',
        ),
    );

    assert.equal(
      memoryConversations.has('task20-invalid-working-folder-ordering'),
      false,
    );
  } finally {
    memoryConversations.delete('task20-invalid-working-folder-ordering');
    memoryTurns.delete('task20-invalid-working-folder-ordering');
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
  }
});

test('startAgentCommand rejects invalid working_folder before provider preparation begins', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const agentHome = path.join(tempAgentsHome, 'coding_agent');
  const commandsDir = path.join(agentHome, 'commands');
  const missingWorkingFolder = path.join(tempCodexHome, 'missing-working-copy');

  await fs.mkdir(commandsDir, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['model = "agent-model-1"', 'approval_policy = "never"'].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(tempCodexHome, 'config.toml'), '', 'utf8');
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    '',
    'utf8',
  );
  await fs.writeFile(
    path.join(commandsDir, 'zero-work.json'),
    JSON.stringify(
      {
        Description: 'Zero work ordering guard',
        items: [{ type: 'reingest', sourceId: '/repo/source-a' }],
      },
      null,
      2,
    ),
    'utf8',
  );

  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;
  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: false,
      authPresent: false,
      configPresent: true,
      cliPath: undefined,
      reason: 'codex unavailable for working-folder ordering guard',
    }),
    resolveCodexCapabilities: async () => ({
      defaults: {
        sandboxMode: 'danger-full-access' as const,
        approvalPolicy: 'never' as const,
        modelReasoningEffort: 'high' as const,
        networkAccessEnabled: true,
        webSearchEnabled: false,
        webSearchMode: 'disabled' as const,
      },
      models: [],
      byModel: new Map(),
      warnings: [],
      fallbackUsed: false,
    }),
    resolveCopilotReadiness: async () => ({
      available: false,
      toolsAvailable: false,
      blockingStage: 'authentication' as const,
      models: [],
      modelsRaw: [],
      authSource: 'unauthenticated' as const,
    }),
    getMcpStatus: async () => ({ available: false }),
  });

  try {
    await assert.rejects(
      async () =>
        startAgentCommand({
          agentName: 'coding_agent',
          commandName: 'zero-work',
          conversationId: 'task20-invalid-command-working-folder-ordering',
          working_folder: missingWorkingFolder,
          source: 'REST',
          chatFactory: () => new MinimalChat(),
        }),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === 'object' &&
            (error as { code?: string }).code === 'WORKING_FOLDER_NOT_FOUND',
        ),
    );

    assert.equal(
      memoryConversations.has('task20-invalid-command-working-folder-ordering'),
      false,
    );
  } finally {
    memoryConversations.delete(
      'task20-invalid-command-working-folder-ordering',
    );
    memoryTurns.delete('task20-invalid-command-working-folder-ordering');
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
  }
});

test('Agents runs fail when agent config contains invalid supported key types (resolver regression guard)', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const tmpAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const agentHome = path.join(tmpAgentsHome, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['model = "gpt-5.1-codex-max"', 'approval_policy = 42'].join('\n'),
    'utf8',
  );
  process.env.CODEINFO_AGENT_HOME = tmpAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tmpAgentsHome;

  try {
    await assert.rejects(
      async () =>
        runAgentInstruction({
          agentName: 'coding_agent',
          instruction: 'Hello',
          conversationId: 'agents-invalid-config-regression',
          source: 'REST',
          chatFactory: () => new MinimalChat(),
        }),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === 'object' &&
            'code' in (error as Record<string, unknown>) &&
            (error as { code?: string }).code ===
              'RUNTIME_CONFIG_VALIDATION_FAILED',
        ),
    );
  } finally {
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    await fs.rm(tmpAgentsHome, { recursive: true, force: true });
  }
});

test('Agents run uses shared-home Codex options and agent runtime config behavior source', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;

  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));

  const agentHome = path.join(tempAgentsHome, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    [
      'model = "agent-model-1"',
      'approval_policy = "never"',
      '[projects]',
      '[projects."/shared"]',
      'trust_level = "untrusted"',
      '[projects."/agent-only"]',
      'trust_level = "trusted"',
    ].join('\n'),
    'utf8',
  );

  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(tempCodexHome, 'config.toml'),
    [
      'model = "base-model-should-not-win"',
      '[projects]',
      '[projects."/base-only"]',
      'trust_level = "trusted"',
      '[projects."/shared"]',
      'trust_level = "trusted"',
    ].join('\n'),
    'utf8',
  );
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    '',
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;

  const capturedFlags: Array<Record<string, unknown>> = [];
  const originalInfo = console.info;
  const originalError = console.error;
  const infoLogs: string[] = [];
  const errorLogs: string[] = [];
  console.info = (...args: unknown[]) => infoLogs.push(String(args[0] ?? ''));
  console.error = (...args: unknown[]) => errorLogs.push(String(args[0] ?? ''));

  try {
    const result = await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Hello',
      conversationId: 'agents-runtime-config-shared-home',
      source: 'REST',
      chatFactory: () =>
        new CapturingChat((flags) => {
          capturedFlags.push(flags);
        }),
    });

    assert.equal(errorLogs.length, 0);
    assert.equal(
      infoLogs.some((line) =>
        line.includes(
          '[DEV-0000037][T06] event=runtime_overrides_applied_rest_paths result=success',
        ),
      ),
      true,
    );
    assert.equal(capturedFlags.length > 0, true);

    const flags = capturedFlags.at(-1) as Record<string, unknown>;
    const runtimeConfig = toRuntimeConfigSnapshot(flags);
    assert.equal(flags.useConfigDefaults, true);
    assert.equal(result.providerId, 'codex');
    assert.equal(result.modelId, 'gpt-5.3-codex');
    assert.deepEqual(runtimeConfig, {
      approval_policy: 'never',
      model: result.modelId,
      projects: {
        '/agent-only': { trust_level: 'trusted' },
        '/base-only': { trust_level: 'trusted' },
        '/shared': { trust_level: 'untrusted' },
      },
    });
  } finally {
    console.info = originalInfo;
    console.error = originalError;
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
  }
});

test('Agents command run uses same runtime config source and emits deterministic T06 errors on invalid config', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;

  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const agentHome = path.join(tempAgentsHome, 'coding_agent');
  const commandsDir = path.join(agentHome, 'commands');
  await fs.mkdir(commandsDir, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    [
      'model = "agent-command-model"',
      'approval_policy = "never"',
      '[projects]',
      '[projects."/shared"]',
      'trust_level = "untrusted"',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(commandsDir, 'hello.json'),
    JSON.stringify(
      {
        Description: 'Say hello',
        items: [{ type: 'message', role: 'user', content: ['Hello there'] }],
      },
      null,
      2,
    ),
    'utf8',
  );

  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(tempCodexHome, 'config.toml'),
    [
      'model = "base-model"',
      '[projects]',
      '[projects."/shared"]',
      'trust_level = "trusted"',
    ].join('\n'),
    'utf8',
  );
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    '',
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;

  const capturedFlags: Array<Record<string, unknown>> = [];
  const originalError = console.error;
  const errorLogs: string[] = [];
  console.error = (...args: unknown[]) => errorLogs.push(String(args[0] ?? ''));

  try {
    const result = await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'hello',
      conversationId: 'agents-command-runtime-config-shared-home',
      source: 'REST',
      chatFactory: () =>
        new CapturingChat((flags) => {
          capturedFlags.push(flags);
        }),
    });

    const flags = capturedFlags.at(-1) as Record<string, unknown>;
    const runtimeConfig = toRuntimeConfigSnapshot(flags);
    assert.equal(flags.useConfigDefaults, true);
    assert.equal(result.providerId, 'codex');
    assert.equal(result.modelId, 'gpt-5.3-codex');
    assert.deepEqual(runtimeConfig, {
      approval_policy: 'never',
      model: result.modelId,
      projects: {
        '/shared': { trust_level: 'untrusted' },
      },
    });
  } finally {
    console.error = originalError;
  }

  // now break config type to assert deterministic T06 error line
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['model = "agent-command-model"', 'approval_policy = 42'].join('\n'),
    'utf8',
  );
  const t06Errors: string[] = [];
  console.error = (...args: unknown[]) => t06Errors.push(String(args[0] ?? ''));
  try {
    await assert.rejects(
      async () =>
        runAgentCommand({
          agentName: 'coding_agent',
          commandName: 'hello',
          conversationId: 'agents-command-runtime-config-invalid',
          source: 'REST',
          chatFactory: () =>
            new CapturingChat(() => {
              // should never be reached on invalid config
            }),
        }),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === 'object' &&
            'code' in (error as Record<string, unknown>) &&
            (error as { code?: string }).code ===
              'RUNTIME_CONFIG_VALIDATION_FAILED',
        ),
    );
    assert.equal(
      t06Errors.some((line) =>
        line.includes(
          '[DEV-0000037][T06] event=runtime_overrides_applied_rest_paths result=error',
        ),
      ),
      true,
    );
  } finally {
    console.error = originalError;
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
  }
});

test('REST baseline runtime config matches command, flow, and MCP execution surfaces', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousFlowsDir = process.env.FLOWS_DIR;

  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const tempFlowsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flows-home-'));

  const agentHome = path.join(tempAgentsHome, 'coding_agent');
  const commandsDir = path.join(agentHome, 'commands');
  await fs.mkdir(commandsDir, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    [
      'model = "agent-parity-model"',
      'approval_policy = "never"',
      '[projects]',
      '[projects."/shared"]',
      'trust_level = "untrusted"',
      '[projects."/agent-only"]',
      'trust_level = "trusted"',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(commandsDir, 'hello.json'),
    JSON.stringify(
      {
        Description: 'Say hello',
        items: [{ type: 'message', role: 'user', content: ['Hello there'] }],
      },
      null,
      2,
    ),
    'utf8',
  );

  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(tempCodexHome, 'config.toml'),
    [
      'model = "base-model-should-not-win"',
      '[projects]',
      '[projects."/base-only"]',
      'trust_level = "trusted"',
      '[projects."/shared"]',
      'trust_level = "trusted"',
    ].join('\n'),
    'utf8',
  );
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    '',
    'utf8',
  );

  await fs.writeFile(
    path.join(tempFlowsDir, 'llm-basic.json'),
    JSON.stringify(
      {
        description: 'LLM-only flow',
        steps: [
          {
            type: 'llm',
            label: 'Greeting',
            agentType: 'coding_agent',
            identifier: 'basic',
            messages: [
              {
                role: 'user',
                content: ['Say hello from a flow step.'],
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;
  process.env.FLOWS_DIR = tempFlowsDir;

  const restFlags: Array<Record<string, unknown>> = [];
  const commandFlags: Array<Record<string, unknown>> = [];
  const flowFlags: Array<Record<string, unknown>> = [];
  const mcpFlags: Array<Record<string, unknown>> = [];

  const originalInfo = console.info;
  const originalError = console.error;
  const infoLogs: string[] = [];
  const errorLogs: string[] = [];
  console.info = (...args: unknown[]) => infoLogs.push(String(args[0] ?? ''));
  console.error = (...args: unknown[]) => errorLogs.push(String(args[0] ?? ''));

  try {
    const restResult = await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'REST baseline',
      conversationId: 't07-rest-baseline',
      source: 'REST',
      chatFactory: () =>
        new CapturingChat((flags) => {
          restFlags.push(flags);
        }),
    });

    await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'hello',
      conversationId: 't07-command-parity',
      source: 'REST',
      chatFactory: () =>
        new CapturingChat((flags) => {
          commandFlags.push(flags);
        }),
    });

    await startFlowRun({
      flowName: 'llm-basic',
      conversationId: 't07-flow-parity',
      source: 'REST',
      chatFactory: () =>
        new CapturingChat((flags) => {
          flowFlags.push(flags);
        }),
    });
    await waitFor(() => flowFlags.length > 0, 5000);

    await callTool(
      'run_agent_instruction',
      {
        agentName: 'coding_agent',
        instruction: 'MCP parity',
        conversationId: 't07-mcp-parity',
      },
      {
        runAgentInstruction: (params) =>
          runAgentInstruction({
            ...(params as Parameters<typeof runAgentInstruction>[0]),
            chatFactory: () =>
              new CapturingChat((flags) => {
                mcpFlags.push(flags);
              }),
          }),
      },
    );

    assert.equal(errorLogs.length, 0);
    assert.equal(restFlags.length > 0, true);
    assert.equal(commandFlags.length > 0, true);
    assert.equal(flowFlags.length > 0, true);
    assert.equal(mcpFlags.length > 0, true);

    const baselineFlags = restFlags.at(-1) as Record<string, unknown>;
    const baselineRuntimeConfig = toRuntimeConfigSnapshot(baselineFlags);
    assert.equal(baselineFlags.useConfigDefaults, true);
    assert.equal(restResult.providerId, 'codex');
    assert.equal(restResult.modelId, 'gpt-5.3-codex');
    assert.deepEqual(baselineRuntimeConfig, {
      approval_policy: 'never',
      model: restResult.modelId,
      projects: {
        '/agent-only': { trust_level: 'trusted' },
        '/base-only': { trust_level: 'trusted' },
        '/shared': { trust_level: 'untrusted' },
      },
    });
    const commandRuntimeConfig = toRuntimeConfigSnapshot(
      commandFlags.at(-1) as Record<string, unknown>,
    );
    const flowRuntimeConfig = toRuntimeConfigSnapshot(
      flowFlags.at(-1) as Record<string, unknown>,
    );
    const mcpRuntimeConfig = toRuntimeConfigSnapshot(
      mcpFlags.at(-1) as Record<string, unknown>,
    );

    assert.deepEqual(commandRuntimeConfig, baselineRuntimeConfig);
    assert.equal(
      typeof (flowRuntimeConfig as { model?: string }).model,
      'string',
    );
    assert.equal(
      typeof (mcpRuntimeConfig as { model?: string }).model,
      'string',
    );
    assert.equal(
      ((flowRuntimeConfig as { model?: string }).model ?? '').length > 0,
      true,
    );
    assert.equal(
      ((mcpRuntimeConfig as { model?: string }).model ?? '').length > 0,
      true,
    );
    assert.deepEqual(
      withoutModel(flowRuntimeConfig),
      withoutModel(mcpRuntimeConfig),
    );

    assert.equal(
      infoLogs.some((line) =>
        line.includes(
          '[DEV-0000037][T07] event=runtime_overrides_applied_flow_mcp result=success',
        ),
      ),
      true,
    );
  } finally {
    console.info = originalInfo;
    console.error = originalError;
    memoryConversations.delete('t07-rest-baseline');
    memoryTurns.delete('t07-rest-baseline');
    memoryConversations.delete('t07-command-parity');
    memoryTurns.delete('t07-command-parity');
    memoryConversations.delete('t07-flow-parity');
    memoryTurns.delete('t07-flow-parity');
    memoryConversations.delete('t07-mcp-parity');
    memoryTurns.delete('t07-mcp-parity');
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    if (previousFlowsDir === undefined) {
      delete process.env.FLOWS_DIR;
    } else {
      process.env.FLOWS_DIR = previousFlowsDir;
    }
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
    await fs.rm(tempFlowsDir, { recursive: true, force: true });
  }
});

test('one successful device-auth flow unlocks shared auth reuse for agent, flow, and MCP runs', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousFlowsDir = process.env.FLOWS_DIR;

  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const tempFlowsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flows-home-'));
  const agentHome = path.join(tempAgentsHome, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['model = "agent-shared-auth-model"', 'approval_policy = "never"'].join(
      '\n',
    ),
    'utf8',
  );
  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{"token":"ok"}');
  await fs.writeFile(path.join(tempCodexHome, 'config.toml'), '', 'utf8');
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    '',
    'utf8',
  );
  await fs.writeFile(
    path.join(tempFlowsDir, 'llm-basic.json'),
    JSON.stringify(
      {
        description: 'LLM-only flow',
        steps: [
          {
            type: 'llm',
            label: 'Greeting',
            agentType: 'coding_agent',
            identifier: 'basic',
            messages: [{ role: 'user', content: ['Say hello'] }],
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;
  process.env.FLOWS_DIR = tempFlowsDir;

  const app = express();
  app.use(
    '/codex',
    createCodexDeviceAuthRouter({
      discoverAgents: async () => [
        {
          name: 'coding_agent',
          home: agentHome,
          configPath: path.join(agentHome, 'config.toml'),
        },
      ],
      propagateAgentAuthFromPrimary: async () => ({ agentCount: 1 }),
      refreshCodexDetection: () => ({
        available: true,
        authPresent: true,
        configPresent: true,
      }),
      getCodexHome: () => tempCodexHome,
      ensureCodexAuthFileStore: async (configPath: string) => ({
        changed: false,
        configPath,
      }),
      getCodexConfigPathForHome: (home: string) => `${home}/config.toml`,
      runCodexDeviceAuth: async () => ({
        provider: 'codex',
        state: 'verification_ready',
        verificationUrl: 'https://device.test/verify',
        userCode: 'CODE-123',
        displayOutput:
          'Open https://device.test/verify and enter code CODE-123.',
        completion: Promise.resolve({
          exitCode: 0,
          result: {
            provider: 'codex',
            state: 'completed',
          },
        }),
      }),
      resolveCodexCli: () => ({ available: true }),
    }),
  );

  try {
    await supertest(app).post('/codex/device-auth').send({}).expect(200);
    await new Promise((resolve) => setImmediate(resolve));

    const agentResult = await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'After shared auth',
      conversationId: 't11-shared-auth-agent',
      source: 'REST',
      chatFactory: () => new MinimalChat(),
    });
    assert.equal(agentResult.agentName, 'coding_agent');

    const flowResult = await startFlowRun({
      flowName: 'llm-basic',
      conversationId: 't11-shared-auth-flow',
      source: 'REST',
      chatFactory: () => new MinimalChat(),
    });
    assert.equal(flowResult.flowName, 'llm-basic');

    const mcpResult = await callTool(
      'run_agent_instruction',
      {
        agentName: 'coding_agent',
        instruction: 'After shared auth via MCP',
        conversationId: 't11-shared-auth-mcp',
      },
      {
        runAgentInstruction: (params) =>
          runAgentInstruction({
            ...params,
            chatFactory: () => new MinimalChat(),
          }),
      },
    );
    const mcpContent = (
      mcpResult as unknown as { content: ReadonlyArray<{ text: string }> }
    ).content[0]?.text;
    const parsed = JSON.parse(mcpContent ?? '{}') as { agentName?: string };
    assert.equal(parsed.agentName, 'coding_agent');
  } finally {
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    if (previousFlowsDir === undefined) {
      delete process.env.FLOWS_DIR;
    } else {
      process.env.FLOWS_DIR = previousFlowsDir;
    }
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
    await fs.rm(tempFlowsDir, { recursive: true, force: true });
  }
});

test('Flow and MCP runtime resolver paths emit deterministic T07 error logs on invalid config', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousFlowsDir = process.env.FLOWS_DIR;

  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const tempFlowsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flows-home-'));

  const agentHome = path.join(tempAgentsHome, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['model = "agent-model"', 'approval_policy = 42'].join('\n'),
    'utf8',
  );

  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(tempCodexHome, 'config.toml'),
    ['model = "base-model"'].join('\n'),
    'utf8',
  );
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    '',
    'utf8',
  );

  await fs.writeFile(
    path.join(tempFlowsDir, 'llm-basic.json'),
    JSON.stringify(
      {
        description: 'LLM-only flow',
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            messages: [
              {
                role: 'user',
                content: ['Say hello from a flow step.'],
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;
  process.env.FLOWS_DIR = tempFlowsDir;

  const originalError = console.error;
  const errorLogs: string[] = [];
  console.error = (...args: unknown[]) => errorLogs.push(String(args[0] ?? ''));

  try {
    await assert.rejects(
      async () =>
        startFlowRun({
          flowName: 'llm-basic',
          conversationId: 't07-flow-invalid',
          source: 'REST',
          chatFactory: () => new MinimalChat(),
        }),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === 'object' &&
            'code' in (error as Record<string, unknown>) &&
            (error as { code?: string }).code ===
              'RUNTIME_CONFIG_VALIDATION_FAILED',
        ),
    );

    await assert.rejects(
      async () =>
        callTool(
          'run_agent_instruction',
          {
            agentName: 'coding_agent',
            instruction: 'MCP invalid',
            conversationId: 't07-mcp-invalid',
          },
          {
            runAgentInstruction: (params) =>
              runAgentInstruction({
                ...(params as Parameters<typeof runAgentInstruction>[0]),
                chatFactory: () => new MinimalChat(),
              }),
          },
        ),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === 'object' &&
            'code' in (error as Record<string, unknown>) &&
            (error as { code?: string }).code ===
              'RUNTIME_CONFIG_VALIDATION_FAILED',
        ),
    );

    assert.equal(
      errorLogs.some((line) =>
        line.includes(
          '[DEV-0000037][T07] event=runtime_overrides_applied_flow_mcp result=error',
        ),
      ),
      true,
    );
  } finally {
    console.error = originalError;
    memoryConversations.delete('t07-flow-invalid');
    memoryTurns.delete('t07-flow-invalid');
    memoryConversations.delete('t07-mcp-invalid');
    memoryTurns.delete('t07-mcp-invalid');
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    if (previousFlowsDir === undefined) {
      delete process.env.FLOWS_DIR;
    } else {
      process.env.FLOWS_DIR = previousFlowsDir;
    }
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
    await fs.rm(tempFlowsDir, { recursive: true, force: true });
  }
});

test('T18 cross-surface precedence parity preserves shared inheritance + agent overrides and emits success log', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousFlowsDir = process.env.FLOWS_DIR;

  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const tempFlowsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flows-home-'));

  const agentHome = path.join(tempAgentsHome, 'coding_agent');
  const commandsDir = path.join(agentHome, 'commands');
  await fs.mkdir(commandsDir, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    [
      'model = "agent-parity-model"',
      'approval_policy = "never"',
      '[projects]',
      '[projects."/shared"]',
      'trust_level = "untrusted"',
      '[projects."/agent-only"]',
      'trust_level = "trusted"',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(commandsDir, 'hello.json'),
    JSON.stringify(
      {
        Description: 'Say hello',
        items: [{ type: 'message', role: 'user', content: ['Hello there'] }],
      },
      null,
      2,
    ),
    'utf8',
  );

  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(tempCodexHome, 'config.toml'),
    [
      'model = "base-model-should-not-win"',
      '[projects]',
      '[projects."/base-only"]',
      'trust_level = "trusted"',
      '[projects."/shared"]',
      'trust_level = "trusted"',
    ].join('\n'),
    'utf8',
  );
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    '',
    'utf8',
  );

  await fs.writeFile(
    path.join(tempFlowsDir, 'llm-basic.json'),
    JSON.stringify(
      {
        description: 'LLM-only flow',
        steps: [
          {
            type: 'llm',
            label: 'Greeting',
            agentType: 'coding_agent',
            identifier: 'basic',
            messages: [{ role: 'user', content: ['Say hello from a flow.'] }],
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;
  process.env.FLOWS_DIR = tempFlowsDir;

  const restFlags: Array<Record<string, unknown>> = [];
  const commandFlags: Array<Record<string, unknown>> = [];
  const flowFlags: Array<Record<string, unknown>> = [];
  const mcpFlags: Array<Record<string, unknown>> = [];
  const infoLogs: string[] = [];
  const errorLogs: string[] = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (...args: unknown[]) => infoLogs.push(String(args[0] ?? ''));
  console.error = (...args: unknown[]) => errorLogs.push(String(args[0] ?? ''));

  try {
    const restResult = await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'REST baseline',
      conversationId: 't18-rest-precedence',
      source: 'REST',
      chatFactory: () =>
        new CapturingChat((flags) => {
          restFlags.push(flags);
        }),
    });
    await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'hello',
      conversationId: 't18-command-precedence',
      source: 'REST',
      chatFactory: () =>
        new CapturingChat((flags) => {
          commandFlags.push(flags);
        }),
    });
    await startFlowRun({
      flowName: 'llm-basic',
      conversationId: 't18-flow-precedence',
      source: 'REST',
      chatFactory: () =>
        new CapturingChat((flags) => {
          flowFlags.push(flags);
        }),
    });
    await waitFor(() => flowFlags.length > 0, 5000);
    await callTool(
      'run_agent_instruction',
      {
        agentName: 'coding_agent',
        instruction: 'MCP parity',
        conversationId: 't18-mcp-precedence',
      },
      {
        runAgentInstruction: (params) =>
          runAgentInstruction({
            ...(params as Parameters<typeof runAgentInstruction>[0]),
            chatFactory: () =>
              new CapturingChat((flags) => {
                mcpFlags.push(flags);
              }),
          }),
      },
    );

    assert.equal(errorLogs.length, 0);
    assert.equal(restFlags.length > 0, true);
    assert.equal(commandFlags.length > 0, true);
    assert.equal(flowFlags.length > 0, true);
    assert.equal(mcpFlags.length > 0, true);

    const restFlagsSnapshot = restFlags.at(-1) as Record<string, unknown>;
    const restRuntimeConfig = toRuntimeConfigSnapshot(restFlagsSnapshot);
    assert.equal(restResult.providerId, 'codex');
    assert.equal(restResult.modelId, 'gpt-5.3-codex');
    assert.equal(restFlagsSnapshot.useConfigDefaults, true);
    assert.equal(
      (restRuntimeConfig as { model?: string }).model,
      restResult.modelId,
    );

    const baselineRuntimeConfig = toRuntimeConfigSnapshot(
      commandFlags.at(-1) as Record<string, unknown>,
    );
    assert.equal(
      (baselineRuntimeConfig.projects as Record<string, unknown>)['/base-only']
        ? true
        : false,
      true,
    );
    assert.equal(
      (
        (
          baselineRuntimeConfig.projects as Record<
            string,
            { trust_level?: string }
          >
        )['/shared'] ?? {}
      ).trust_level,
      'untrusted',
    );
    assert.equal(
      (
        (
          baselineRuntimeConfig.projects as Record<
            string,
            { trust_level?: string }
          >
        )['/agent-only'] ?? {}
      ).trust_level,
      'trusted',
    );
    assert.deepEqual(
      withoutModel(restRuntimeConfig),
      withoutModel(baselineRuntimeConfig),
    );

    assert.deepEqual(
      withoutModel(
        toRuntimeConfigSnapshot(flowFlags.at(-1) as Record<string, unknown>),
      ),
      withoutModel(baselineRuntimeConfig),
    );
    assert.deepEqual(
      withoutModel(
        toRuntimeConfigSnapshot(mcpFlags.at(-1) as Record<string, unknown>),
      ),
      withoutModel(baselineRuntimeConfig),
    );

    console.info(T18_SUCCESS_LOG);
    assert.equal(
      infoLogs.some((line) => line.includes(T18_SUCCESS_LOG)),
      true,
    );
  } finally {
    console.info = originalInfo;
    console.error = originalError;
    memoryConversations.delete('t18-rest-precedence');
    memoryTurns.delete('t18-rest-precedence');
    memoryConversations.delete('t18-command-precedence');
    memoryTurns.delete('t18-command-precedence');
    memoryConversations.delete('t18-flow-precedence');
    memoryTurns.delete('t18-flow-precedence');
    memoryConversations.delete('t18-mcp-precedence');
    memoryTurns.delete('t18-mcp-precedence');
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    if (previousFlowsDir === undefined) {
      delete process.env.FLOWS_DIR;
    } else {
      process.env.FLOWS_DIR = previousFlowsDir;
    }
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
    await fs.rm(tempFlowsDir, { recursive: true, force: true });
  }
});

test('T18 unknown-key policy is warning+pass-through across REST, flow, and MCP surfaces', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousFlowsDir = process.env.FLOWS_DIR;
  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const tempFlowsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flows-home-'));

  const agentHome = path.join(tempAgentsHome, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    [
      'model = "agent-warning-model"',
      'approval_policy = "never"',
      'top_level_unknown = "ignored"',
      '[features]',
      'unknown_feature_flag = true',
      '[projects]',
      '[projects."/shared"]',
      'trust_level = "untrusted"',
      'project_unknown = "ignored"',
    ].join('\n'),
    'utf8',
  );

  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(tempCodexHome, 'config.toml'),
    ['[projects]', '[projects."/base-only"]', 'trust_level = "trusted"'].join(
      '\n',
    ),
    'utf8',
  );
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    '',
    'utf8',
  );
  await fs.writeFile(
    path.join(tempFlowsDir, 'llm-basic.json'),
    JSON.stringify(
      {
        description: 'LLM-only flow',
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            messages: [{ role: 'user', content: ['Say hello'] }],
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;
  process.env.FLOWS_DIR = tempFlowsDir;

  const restFlags: Array<Record<string, unknown>> = [];
  const flowFlags: Array<Record<string, unknown>> = [];
  const mcpFlags: Array<Record<string, unknown>> = [];
  const warningLogs: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) =>
    warningLogs.push(String(args[0] ?? ''));

  try {
    const restResult = await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'REST warning path',
      conversationId: 't18-unknown-rest',
      source: 'REST',
      chatFactory: () =>
        new CapturingChat((flags) => {
          restFlags.push(flags);
        }),
    });
    await startFlowRun({
      flowName: 'llm-basic',
      conversationId: 't18-unknown-flow',
      source: 'REST',
      chatFactory: () =>
        new CapturingChat((flags) => {
          flowFlags.push(flags);
        }),
    });
    await waitFor(() => flowFlags.length > 0, 5000);
    await callTool(
      'run_agent_instruction',
      {
        agentName: 'coding_agent',
        instruction: 'MCP warning path',
        conversationId: 't18-unknown-mcp',
      },
      {
        runAgentInstruction: (params) =>
          runAgentInstruction({
            ...(params as Parameters<typeof runAgentInstruction>[0]),
            chatFactory: () =>
              new CapturingChat((flags) => {
                mcpFlags.push(flags);
              }),
          }),
      },
    );

    assert.equal(restFlags.length > 0, true);
    assert.equal(flowFlags.length > 0, true);
    assert.equal(mcpFlags.length > 0, true);

    const restFlagsSnapshot = restFlags.at(-1) as Record<string, unknown>;
    const restRuntimeConfig = toRuntimeConfigSnapshot(restFlagsSnapshot);
    assert.equal(restResult.providerId, 'codex');
    assert.equal(restResult.modelId, 'gpt-5.3-codex');
    assert.equal(restFlagsSnapshot.useConfigDefaults, true);
    assert.equal(
      (restRuntimeConfig as { model?: string }).model,
      restResult.modelId,
    );

    const baselineRuntimeConfig = toRuntimeConfigSnapshot(
      flowFlags.at(-1) as Record<string, unknown>,
    );
    assert.equal(
      (baselineRuntimeConfig.top_level_unknown as string | undefined) ??
        undefined,
      'ignored',
    );
    assert.equal(
      ((baselineRuntimeConfig.features as Record<string, unknown> | undefined)
        ?.unknown_feature_flag as boolean | undefined) ?? undefined,
      true,
    );
    assert.equal(
      ((
        baselineRuntimeConfig.projects as
          | Record<string, Record<string, unknown>>
          | undefined
      )?.['/shared']?.project_unknown as string | undefined) ?? undefined,
      'ignored',
    );
    assert.deepEqual(
      withoutModel(
        toRuntimeConfigSnapshot(mcpFlags.at(-1) as Record<string, unknown>),
      ),
      withoutModel(baselineRuntimeConfig),
    );
    assert.deepEqual(
      withoutModel(restRuntimeConfig),
      withoutModel(baselineRuntimeConfig),
    );

    assert.equal(
      warningLogs.some((line) =>
        line.includes('[runtime-config] warning path=agent.top_level_unknown'),
      ),
      true,
    );
  } finally {
    console.warn = originalWarn;
    memoryConversations.delete('t18-unknown-rest');
    memoryTurns.delete('t18-unknown-rest');
    memoryConversations.delete('t18-unknown-flow');
    memoryTurns.delete('t18-unknown-flow');
    memoryConversations.delete('t18-unknown-mcp');
    memoryTurns.delete('t18-unknown-mcp');
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    if (previousFlowsDir === undefined) {
      delete process.env.FLOWS_DIR;
    } else {
      process.env.FLOWS_DIR = previousFlowsDir;
    }
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
    await fs.rm(tempFlowsDir, { recursive: true, force: true });
  }
});

test('Task 19 preserves fallback runtime warnings on successful direct agent runs', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousCopilotHome = process.env.CODEINFO_COPILOT_HOME;
  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const tempCopilotHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'copilot-home-'),
  );

  const agentHome = path.join(tempAgentsHome, 'coding_agent');
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.mkdir(path.join(tempCopilotHome, 'chat'), { recursive: true });
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    [
      'codeinfo_provider = "copilot"',
      'model = "copilot-model"',
      'top_level_unknown = "ignored"',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(tempCodexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    'model = "gpt-5.3-codex"\n',
    'utf8',
  );
  await fs.writeFile(path.join(tempCopilotHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(tempCopilotHome, 'chat', 'config.toml'),
    'model = "copilot-model"\n',
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;
  process.env.CODEINFO_COPILOT_HOME = tempCopilotHome;
  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: true,
      authPresent: true,
      configPresent: true,
    }),
    resolveCodexCapabilities: async () => ({
      defaults: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        modelReasoningEffort: 'high',
        networkAccessEnabled: true,
        webSearchEnabled: false,
        webSearchMode: 'disabled',
      },
      models: [
        {
          model: 'gpt-5.3-codex',
          supportedReasoningEfforts: ['high'],
          defaultReasoningEffort: 'high',
        },
      ],
      byModel: new Map(),
      warnings: [],
      fallbackUsed: false,
    }),
    getMcpStatus: async () => ({ available: true }),
    resolveCopilotReadiness: async () => ({
      available: false,
      toolsAvailable: false,
      blockingStage: 'authentication',
      reason: 'copilot unavailable',
      models: [],
      modelsRaw: [],
      authSource: 'unauthenticated',
    }),
  });

  try {
    const result = await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'fallback warning path',
      conversationId: 'task19-fallback-warning-rest',
      source: 'REST',
      chatFactory: () => new MinimalChat(),
    });

    assert.equal(result.providerId, 'codex');
    assert.equal(
      result.warnings?.some((warning) =>
        warning.includes('Unknown key agent.top_level_unknown'),
      ) ?? false,
      true,
    );
  } finally {
    __resetAgentServiceDepsForTests();
    memoryConversations.delete('task19-fallback-warning-rest');
    memoryTurns.delete('task19-fallback-warning-rest');
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    process.env.CODEINFO_COPILOT_HOME = previousCopilotHome;
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
    await fs.rm(tempCopilotHome, { recursive: true, force: true });
  }
});

test('Task 26 keeps availability warnings on the initial direct agent run-start response payload', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousCopilotHome = process.env.CODEINFO_COPILOT_HOME;
  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const tempCopilotHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'copilot-home-'),
  );

  const agentHome = path.join(tempAgentsHome, 'coding_agent');
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.mkdir(path.join(tempCopilotHome, 'chat'), { recursive: true });
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['codeinfo_provider = "bad-provider"', 'model = "copilot-model"', ''].join(
      '\n',
    ),
    'utf8',
  );
  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(tempCodexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    'model = "gpt-5.3-codex"\n',
    'utf8',
  );
  await fs.writeFile(path.join(tempCopilotHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(tempCopilotHome, 'chat', 'config.toml'),
    'model = "copilot-model"\n',
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;
  process.env.CODEINFO_COPILOT_HOME = tempCopilotHome;
  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: true,
      authPresent: true,
      configPresent: true,
    }),
    resolveCodexCapabilities: async () => ({
      defaults: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        modelReasoningEffort: 'high',
        networkAccessEnabled: true,
        webSearchEnabled: false,
        webSearchMode: 'disabled',
      },
      models: [
        {
          model: 'gpt-5.3-codex',
          supportedReasoningEfforts: ['high'],
          defaultReasoningEffort: 'high',
        },
      ],
      byModel: new Map(),
      warnings: [],
      fallbackUsed: false,
    }),
    getMcpStatus: async () => ({ available: true }),
    resolveCopilotReadiness: async () => ({
      available: false,
      toolsAvailable: false,
      blockingStage: 'authentication',
      reason: 'copilot unavailable',
      models: [],
      modelsRaw: [],
      authSource: 'unauthenticated',
    }),
  });

  const app = express();
  app.use(
    createAgentsRunRouter({
      startAgentInstruction: bindCurrentTestOverrides((params) =>
        startAgentInstruction({
          ...params,
          chatFactory: () => new MinimalChat(),
        })),
    }),
  );

  try {
    const response = await supertest(app)
      .post('/agents/coding_agent/run')
      .send({ instruction: 'warning-bearing start' })
      .expect(202);

    assert.equal(response.body.status, 'started');
    assert.equal(response.body.providerId, 'codex');
    assert.equal(
      response.body.warnings.some((warning: string) =>
        warning.includes('unsupported provider "bad-provider"'),
      ),
      true,
    );
    assert.equal(
      response.body.warnings.some((warning: string) =>
        warning.includes('fallback provider "codex"'),
      ),
      true,
    );
    assert.equal(
      response.body.warnings.some((warning: string) =>
        warning.includes('Endpoint "unknown"'),
      ),
      false,
    );
  } finally {
    __resetAgentServiceDepsForTests();
    memoryConversations.clear();
    memoryTurns.clear();
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    process.env.CODEINFO_COPILOT_HOME = previousCopilotHome;
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
    await fs.rm(tempCopilotHome, { recursive: true, force: true });
  }
});

test('direct agent run falls back before provider runtime load when the requested provider config cannot load', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousLegacyAgentHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousCopilotHome = process.env.CODEINFO_COPILOT_HOME;
  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const tempCopilotHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'copilot-home-'),
  );
  const agentHome = path.join(tempAgentsHome, 'coding_agent');

  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.mkdir(path.join(tempCopilotHome, 'chat'), { recursive: true });
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['codeinfo_provider = "copilot"', 'model = "copilot-gpt-5"', ''].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(tempCodexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    'model = "gpt-5.3-codex"\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(tempCopilotHome, 'config.toml'),
    'tool_access = [\n',
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;
  process.env.CODEINFO_COPILOT_HOME = tempCopilotHome;
  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: true,
      authPresent: true,
      configPresent: true,
    }),
    resolveCodexCapabilities: async () => ({
      defaults: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        modelReasoningEffort: 'high',
        networkAccessEnabled: true,
        webSearchEnabled: false,
        webSearchMode: 'disabled',
      },
      models: [
        {
          model: 'gpt-5.3-codex',
          supportedReasoningEfforts: ['high'],
          defaultReasoningEffort: 'high',
        },
      ],
      byModel: new Map(),
      warnings: [],
      fallbackUsed: false,
    }),
    getMcpStatus: async () => ({ available: true }),
    resolveCopilotReadiness: async () => ({
      available: true,
      toolsAvailable: true,
      blockingStage: 'ready',
      reason: undefined,
      models: ['copilot-gpt-5'],
      modelsRaw: [
        {
          id: 'copilot-gpt-5',
          name: 'Copilot GPT-5',
          capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 128000 },
          },
        },
      ],
      authSource: 'env-token',
    }),
  });

  const app = express();
  app.use(
    createAgentsRunRouter({
      startAgentInstruction: bindCurrentTestOverrides((params) =>
        startAgentInstruction({
          ...params,
          chatFactory: () => new MinimalChat(),
        })),
    }),
  );

  try {
    const response = await supertest(app)
      .post('/agents/coding_agent/run')
      .send({ instruction: 'runtime-config fallback please' })
      .expect(202);

    assert.equal(response.body.status, 'started');
    assert.equal(response.body.providerId, 'codex');
    assert.equal(
      response.body.warnings.some((warning: string) =>
        warning.includes(
          'requested provider "copilot" because its runtime config could not load',
        ),
      ),
      true,
    );
    assert.equal(
      response.body.warnings.some((warning: string) =>
        warning.includes('fallback provider "codex"'),
      ),
      true,
    );
  } finally {
    __resetAgentServiceDepsForTests();
    memoryConversations.clear();
    memoryTurns.clear();
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    if (previousLegacyAgentHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = previousLegacyAgentHome;
    }
    if (previousCodexHome === undefined) {
      delete process.env.CODEINFO_CODEX_HOME;
    } else {
      process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    }
    if (previousCopilotHome === undefined) {
      delete process.env.CODEINFO_COPILOT_HOME;
    } else {
      process.env.CODEINFO_COPILOT_HOME = previousCopilotHome;
    }
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
    await fs.rm(tempCopilotHome, { recursive: true, force: true });
  }
});

test('provider-independent agent config failures still fail clearly instead of silently falling back', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousLegacyAgentHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const agentHome = path.join(tempAgentsHome, 'coding_agent');

  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['codeinfo_provider = "copilot"', 'approval_policy = ['].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(tempCodexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    'model = "gpt-5.3-codex"\n',
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;

  const app = express();
  app.use(
    createAgentsRunRouter({
      startAgentInstruction: bindCurrentTestOverrides((params) =>
        startAgentInstruction({
          ...params,
          chatFactory: () => new MinimalChat(),
        })),
    }),
  );

  try {
    const response = await supertest(app)
      .post('/agents/coding_agent/run')
      .send({ instruction: 'do not hide invalid config' })
      .expect(500);

    assert.notEqual(response.body.code, 'PROVIDER_UNAVAILABLE');
  } finally {
    memoryConversations.clear();
    memoryTurns.clear();
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    if (previousLegacyAgentHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = previousLegacyAgentHome;
    }
    if (previousCodexHome === undefined) {
      delete process.env.CODEINFO_CODEX_HOME;
    } else {
      process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    }
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
  }
});

test('Task 28 direct continuation restores the saved requested-provider identity instead of reusing the execution provider field', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const agentHome = path.join(tempAgentsHome, 'coding_agent');

  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['codeinfo_provider = "copilot"', 'model = "copilot-model"', ''].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(tempCodexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    'model = "gpt-5.3-codex"\n',
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;
  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: true,
      authPresent: true,
      configPresent: true,
    }),
    resolveCodexCapabilities: async () => ({
      defaults: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        modelReasoningEffort: 'high',
        networkAccessEnabled: true,
        webSearchEnabled: false,
        webSearchMode: 'disabled',
      },
      models: [
        {
          model: 'gpt-5.3-codex',
          supportedReasoningEfforts: ['high'],
          defaultReasoningEffort: 'high',
        },
      ],
      byModel: new Map(),
      warnings: [],
      fallbackUsed: false,
    }),
    getMcpStatus: async () => ({ available: true }),
    resolveCopilotReadiness: async () => ({
      available: false,
      toolsAvailable: false,
      blockingStage: 'authentication',
      reason: 'copilot unavailable',
      models: [],
      modelsRaw: [],
      authSource: 'unauthenticated',
    }),
  });

  const conversationId = 'task28-direct-continuation-requested-provider';

  try {
    const seededConversation: Conversation = {
      _id: conversationId,
      provider: 'codex',
      model: 'gpt-5.3-codex',
      title: 'Saved continuation',
      agentName: 'coding_agent',
      source: 'REST',
      flags: {
        requestedProviderId: 'copilot',
      },
      lastMessageAt: new Date(),
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await withMockedMongoConversationPersistence({
      seedConversations: [seededConversation],
      run: async ({ conversations }) => {
        const result = await runAgentInstruction({
          agentName: 'coding_agent',
          instruction: 'continue with saved requested provider',
          conversationId,
          source: 'REST',
          chatFactory: () => new MinimalChat(),
        });

        assert.equal(result.providerId, 'codex');
        assert.equal(
          conversations.get(conversationId)?.flags?.requestedProviderId,
          'copilot',
        );
      },
    });
  } finally {
    __resetAgentServiceDepsForTests();
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
  }
});

test('Task 9 resumes a direct-agent conversation with the saved endpoint when the configured endpoint matches', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousRuntimeCodexHome = process.env.CODEX_HOME;
  const previousCopilotHome = process.env.CODEINFO_COPILOT_HOME;
  const previousCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const externalServer = await startExternalOpenAiCompatServer({
    models: ['gpt-5.2-codex'],
  });

  const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-home-'));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const copilotHome = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-home-'));
  const agentHome = path.join(agentsHome, 'coding_agent');
  const endpointId = `${externalServer.baseUrl}/v1`;
  const conversationId = 'task9-direct-endpoint-success';

  await fs.mkdir(agentHome, { recursive: true });
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    [
      'codeinfo_provider = "codex"',
      'model = "gpt-5.2-codex"',
      `codeinfo_openai_endpoint = "${endpointId}|responses"`,
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    'model = "gpt-5.2-codex"\n',
    'utf8',
  );
  await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(copilotHome, 'chat', 'config.toml'),
    'model = "copilot-gpt-5"\n',
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;
  process.env.CODEX_HOME = codexHome;
  process.env.CODEINFO_COPILOT_HOME = copilotHome;
  process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS = `${endpointId}|responses`;

  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: true,
      authPresent: true,
      configPresent: true,
    }),
    resolveCodexCapabilities: async () => ({
      defaults: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        modelReasoningEffort: 'high',
        networkAccessEnabled: true,
        webSearchEnabled: false,
        webSearchMode: 'disabled',
      },
      models: [
        {
          model: 'gpt-5.2-codex',
          supportedReasoningEfforts: ['high'],
          defaultReasoningEffort: 'high',
        },
      ],
      byModel: new Map(),
      warnings: [],
      fallbackUsed: false,
    }),
    getMcpStatus: async () => ({ available: true }),
    resolveCopilotReadiness: async () => ({
      available: true,
      toolsAvailable: true,
      blockingStage: 'ready',
      reason: undefined,
      models: ['copilot-gpt-5'],
      modelsRaw: [
        {
          id: 'copilot-gpt-5',
          name: 'Copilot GPT-5',
          capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 128000 },
          },
        },
      ],
      authSource: 'env-token',
    }),
  });

  try {
    memoryConversations.set(conversationId, {
      _id: conversationId,
      provider: 'codex',
      model: 'gpt-5.2-codex',
      title: 'Saved endpoint direct-agent conversation',
      agentName: 'coding_agent',
      source: 'REST',
      flags: { endpointId },
      lastMessageAt: new Date(),
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Continue with the saved endpoint',
      conversationId,
      source: 'REST',
      chatFactory: () => new MinimalChat(),
    });

    assert.equal(result.providerId, 'codex');
    assert.equal(result.modelId, 'gpt-5.2-codex');
    assert.equal(
      memoryConversations.get(conversationId)?.flags?.endpointId,
      endpointId,
    );
    assert.equal(memoryConversations.get(conversationId)?.provider, 'codex');
    assert.equal(
      memoryConversations.get(conversationId)?.model,
      'gpt-5.2-codex',
    );
  } finally {
    __resetAgentServiceDepsForTests();
    await externalServer.stop();
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.clear();
    memoryTurns.clear();
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    if (previousAgentsHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    }
    if (previousCodexHome === undefined) {
      delete process.env.CODEINFO_CODEX_HOME;
    } else {
      process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    }
    if (previousRuntimeCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousRuntimeCodexHome;
    }
    if (previousCopilotHome === undefined) {
      delete process.env.CODEINFO_COPILOT_HOME;
    } else {
      process.env.CODEINFO_COPILOT_HOME = previousCopilotHome;
    }
    if (previousCompatEndpoints === undefined) {
      delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    } else {
      process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS =
        previousCompatEndpoints;
    }
    await fs.rm(agentsHome, { recursive: true, force: true });
    await fs.rm(codexHome, { recursive: true, force: true });
    await fs.rm(copilotHome, { recursive: true, force: true });
  }
});

test('direct Copilot agent runs carry the configured external endpoint through to chat execution flags', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousRuntimeCodexHome = process.env.CODEX_HOME;
  const previousCopilotHome = process.env.CODEINFO_COPILOT_HOME;
  const previousCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const previousCompatEndpointKeys =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS;
  const externalServer = await startExternalOpenAiCompatServer({
    models: ['copilot-gpt-5'],
  });

  const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-home-'));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const copilotHome = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-home-'));
  const agentHome = path.join(agentsHome, 'coding_agent');
  const endpointId = `${externalServer.baseUrl}/v1`;
  const capturedFlags: Array<Record<string, unknown>> = [];

  await fs.mkdir(agentHome, { recursive: true });
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    [
      'codeinfo_provider = "copilot"',
      'model = "copilot-gpt-5"',
      `codeinfo_openai_endpoint = "${endpointId}|completions"`,
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    'model = "gpt-5.2-codex"\n',
    'utf8',
  );
  await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(copilotHome, 'chat', 'config.toml'),
    'model = "copilot-gpt-5"\n',
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;
  process.env.CODEX_HOME = codexHome;
  process.env.CODEINFO_COPILOT_HOME = copilotHome;
  process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS =
    `OpenRouter,${endpointId}|responses,completions`;
  process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS =
    'openrouter,sk-or-v1-test';

  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: true,
      authPresent: true,
      configPresent: true,
    }),
    resolveCodexCapabilities: async () => ({
      defaults: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        modelReasoningEffort: 'high',
        networkAccessEnabled: true,
        webSearchEnabled: false,
        webSearchMode: 'disabled',
      },
      models: [
        {
          model: 'gpt-5.2-codex',
          supportedReasoningEfforts: ['high'],
          defaultReasoningEffort: 'high',
        },
      ],
      byModel: new Map(),
      warnings: [],
      fallbackUsed: false,
    }),
    getMcpStatus: async () => ({ available: true }),
    resolveCopilotReadiness: async () => ({
      available: true,
      toolsAvailable: true,
      blockingStage: 'ready',
      reason: undefined,
      models: ['copilot-gpt-5'],
      modelsRaw: [
        {
          id: 'copilot-gpt-5',
          name: 'Copilot GPT-5',
          capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 128000 },
          },
        },
      ],
      authSource: 'env-token',
    }),
  });

  try {
    const result = await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Use the configured Copilot endpoint',
      conversationId: 'copilot-agent-endpoint-carry-through',
      source: 'REST',
      chatFactory: () =>
        new CapturingChat((flags) => {
          capturedFlags.push(flags);
        }),
    });

    assert.equal(result.providerId, 'copilot');
    assert.equal(capturedFlags.length, 1);
    assert.equal(capturedFlags[0]?.provider, 'copilot');
    assert.deepEqual(capturedFlags[0]?.codeinfoOpenAiEndpoint, {
      endpointId,
      baseUrl: endpointId,
      capabilities: ['responses', 'completions'],
      displayLabel: 'OpenRouter',
      authLookupKey: 'openrouter',
      supportsBuiltInWebSearch: false,
    });
  } finally {
    __resetAgentServiceDepsForTests();
    await externalServer.stop();
    memoryConversations.delete('copilot-agent-endpoint-carry-through');
    memoryTurns.delete('copilot-agent-endpoint-carry-through');
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    if (previousAgentsHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    }
    if (previousCodexHome === undefined) {
      delete process.env.CODEINFO_CODEX_HOME;
    } else {
      process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    }
    if (previousRuntimeCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousRuntimeCodexHome;
    }
    if (previousCopilotHome === undefined) {
      delete process.env.CODEINFO_COPILOT_HOME;
    } else {
      process.env.CODEINFO_COPILOT_HOME = previousCopilotHome;
    }
    if (previousCompatEndpoints === undefined) {
      delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    } else {
      process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS =
        previousCompatEndpoints;
    }
    if (previousCompatEndpointKeys === undefined) {
      delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS;
    } else {
      process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS =
        previousCompatEndpointKeys;
    }
    await fs.rm(agentsHome, { recursive: true, force: true });
    await fs.rm(codexHome, { recursive: true, force: true });
    await fs.rm(copilotHome, { recursive: true, force: true });
  }
});

test('direct Codex agent runs keep the endpoint-backed configured model instead of rewriting it through native Codex model selection', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousRuntimeCodexHome = process.env.CODEX_HOME;
  const previousCopilotHome = process.env.CODEINFO_COPILOT_HOME;
  const previousCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const previousCompatEndpointKeys =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS;
  const externalServer = await startExternalOpenAiCompatServer({
    models: ['google/gemini-3-pro-image', 'deepseek/deepseek-v4-flash'],
  });

  const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-home-'));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const copilotHome = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-home-'));
  const agentHome = path.join(agentsHome, 'coding_agent');
  const endpointId = `${externalServer.baseUrl}/v1`;
  const capturedRuns: Array<{
    flags: Record<string, unknown>;
    model: string;
  }> = [];

  await fs.mkdir(agentHome, { recursive: true });
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    [
      'codeinfo_provider = "codex"',
      'model = "deepseek/deepseek-v4-flash"',
      `codeinfo_openai_endpoint = "${endpointId}|responses,completions"`,
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    'model = "gpt-5.2-codex"\n',
    'utf8',
  );
  await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(copilotHome, 'chat', 'config.toml'),
    'model = "copilot-gpt-5"\n',
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;
  process.env.CODEX_HOME = codexHome;
  process.env.CODEINFO_COPILOT_HOME = copilotHome;
  process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS =
    `OpenRouter,${endpointId}|responses,completions`;
  process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS =
    'openrouter,sk-or-v1-test';

  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: true,
      authPresent: true,
      configPresent: true,
    }),
    resolveCodexCapabilities: async () => ({
      defaults: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        modelReasoningEffort: 'high',
        networkAccessEnabled: true,
        webSearchEnabled: false,
        webSearchMode: 'disabled',
      },
      models: [
        {
          model: 'gpt-5.2-codex',
          supportedReasoningEfforts: ['high'],
          defaultReasoningEffort: 'high',
        },
      ],
      byModel: new Map(),
      warnings: [],
      fallbackUsed: false,
    }),
    getMcpStatus: async () => ({ available: true }),
    resolveCopilotReadiness: async () => ({
      available: true,
      toolsAvailable: true,
      blockingStage: 'ready',
      reason: undefined,
      models: ['copilot-gpt-5'],
      modelsRaw: [
        {
          id: 'copilot-gpt-5',
          name: 'Copilot GPT-5',
          capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 128000 },
          },
        },
      ],
      authSource: 'env-token',
    }),
  });

  try {
    const conversationId = 'codex-agent-endpoint-model-preserved';
    const result = await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Use the configured Codex endpoint model',
      conversationId,
      source: 'REST',
      chatFactory: () =>
        new CapturingModelChat((payload) => {
          capturedRuns.push(payload);
        }),
    });

    assert.equal(result.providerId, 'codex');
    assert.equal(result.modelId, 'deepseek/deepseek-v4-flash');
    assert.equal(capturedRuns.length, 1);
    assert.equal(capturedRuns[0]?.model, 'deepseek/deepseek-v4-flash');
    assert.equal(
      memoryConversations.get(conversationId)?.model,
      'deepseek/deepseek-v4-flash',
    );
  } finally {
    __resetAgentServiceDepsForTests();
    await externalServer.stop();
    memoryConversations.delete('codex-agent-endpoint-model-preserved');
    memoryTurns.delete('codex-agent-endpoint-model-preserved');
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    if (previousAgentsHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    }
    if (previousCodexHome === undefined) {
      delete process.env.CODEINFO_CODEX_HOME;
    } else {
      process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    }
    if (previousRuntimeCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousRuntimeCodexHome;
    }
    if (previousCopilotHome === undefined) {
      delete process.env.CODEINFO_COPILOT_HOME;
    } else {
      process.env.CODEINFO_COPILOT_HOME = previousCopilotHome;
    }
    if (previousCompatEndpoints === undefined) {
      delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    } else {
      process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS =
        previousCompatEndpoints;
    }
    if (previousCompatEndpointKeys === undefined) {
      delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS;
    } else {
      process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS =
        previousCompatEndpointKeys;
    }
    await fs.rm(agentsHome, { recursive: true, force: true });
    await fs.rm(codexHome, { recursive: true, force: true });
    await fs.rm(copilotHome, { recursive: true, force: true });
  }
});

test('Task 15 blocks a direct-agent endpoint-backed run when codex bootstrap is degraded even if the endpoint is healthy', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousRuntimeCodexHome = process.env.CODEX_HOME;
  const previousCopilotHome = process.env.CODEINFO_COPILOT_HOME;
  const previousCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const externalServer = await startExternalOpenAiCompatServer({
    models: ['gpt-5.2-codex'],
  });

  const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-home-'));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const copilotHome = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-home-'));
  const agentHome = path.join(agentsHome, 'coding_agent');
  const endpointId = `${externalServer.baseUrl}/v1`;
  const conversationId = 'task15-direct-endpoint-bootstrap-degraded';

  await fs.mkdir(agentHome, { recursive: true });
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    [
      'codeinfo_provider = "codex"',
      'model = "gpt-5.2-codex"',
      `codeinfo_openai_endpoint = "${endpointId}|responses"`,
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    'model = "gpt-5.2-codex"\n',
    'utf8',
  );
  await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(copilotHome, 'chat', 'config.toml'),
    'model = "copilot-gpt-5"\n',
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;
  process.env.CODEX_HOME = codexHome;
  process.env.CODEINFO_COPILOT_HOME = copilotHome;
  process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS = `${endpointId}|responses`;

  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: true,
      authPresent: true,
      configPresent: true,
    }),
    resolveCodexCapabilities: async () => ({
      defaults: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        modelReasoningEffort: 'high',
        networkAccessEnabled: true,
        webSearchEnabled: false,
        webSearchMode: 'disabled',
      },
      models: [
        {
          model: 'gpt-5.2-codex',
          supportedReasoningEfforts: ['high'],
          defaultReasoningEffort: 'high',
        },
      ],
      byModel: new Map(),
      warnings: [],
      fallbackUsed: false,
    }),
    getMcpStatus: async () => ({ available: true }),
    resolveCopilotReadiness: async () => ({
      available: true,
      toolsAvailable: true,
      blockingStage: 'ready',
      reason: undefined,
      models: ['copilot-gpt-5'],
      modelsRaw: [
        {
          id: 'copilot-gpt-5',
          name: 'Copilot GPT-5',
          capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 128000 },
          },
        },
      ],
      authSource: 'env-token',
    }),
  });
  __setProviderBootstrapStatusForTests('codex', {
    healthy: false,
    reason: 'codex bootstrap degraded',
  });

  try {
    memoryConversations.set(conversationId, {
      _id: conversationId,
      provider: 'codex',
      model: 'gpt-5.2-codex',
      title: 'Saved endpoint direct-agent conversation',
      agentName: 'coding_agent',
      source: 'REST',
      flags: { endpointId },
      lastMessageAt: new Date(),
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await assert.rejects(
      () =>
        runAgentInstruction({
          agentName: 'coding_agent',
          instruction: 'Continue with the saved endpoint',
          conversationId,
          source: 'REST',
          chatFactory: () => new MinimalChat(),
        }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROVIDER_UNAVAILABLE');
        return true;
      },
    );

    assert.equal(
      memoryConversations.get(conversationId)?.flags?.endpointId,
      endpointId,
    );
    assert.equal(memoryConversations.get(conversationId)?.provider, 'codex');
    assert.equal(
      memoryConversations.get(conversationId)?.model,
      'gpt-5.2-codex',
    );
  } finally {
    __resetAgentServiceDepsForTests();
    __resetProviderBootstrapStatusForTests();
    await externalServer.stop();
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.clear();
    memoryTurns.clear();
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    if (previousAgentsHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    }
    if (previousCodexHome === undefined) {
      delete process.env.CODEINFO_CODEX_HOME;
    } else {
      process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    }
    if (previousRuntimeCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousRuntimeCodexHome;
    }
    if (previousCopilotHome === undefined) {
      delete process.env.CODEINFO_COPILOT_HOME;
    } else {
      process.env.CODEINFO_COPILOT_HOME = previousCopilotHome;
    }
    if (previousCompatEndpoints === undefined) {
      delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    } else {
      process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS =
        previousCompatEndpoints;
    }
    await fs.rm(agentsHome, { recursive: true, force: true });
    await fs.rm(codexHome, { recursive: true, force: true });
    await fs.rm(copilotHome, { recursive: true, force: true });
  }
});

test('direct codex agent runs preserve live web search for Unsloth endpoints', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousRuntimeCodexHome = process.env.CODEX_HOME;
  const previousCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const previousCompatEndpointKeys =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS;
  let externalServer:
    | Awaited<ReturnType<typeof startExternalOpenAiCompatServer>>
    | undefined;
  let agentsHome: string | undefined;
  let codexHome: string | undefined;

  const capturedFlags: Array<Record<string, unknown>> = [];

  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: true,
      authPresent: true,
      configPresent: true,
    }),
    resolveCodexCapabilities: async () => ({
      defaults: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        modelReasoningEffort: 'high',
        networkAccessEnabled: true,
        webSearchEnabled: true,
        webSearchMode: 'live',
      },
      models: [
        {
          model: 'google/gemma-4-27b-it',
          supportedReasoningEfforts: ['high'],
          defaultReasoningEffort: 'high',
        },
      ],
      byModel: new Map(),
      warnings: [],
      fallbackUsed: false,
    }),
    getMcpStatus: async () => ({ available: true }),
    resolveCopilotReadiness: async () => ({
      available: true,
      toolsAvailable: true,
      blockingStage: 'ready',
      reason: undefined,
      models: ['copilot-gpt-5'],
      modelsRaw: [
        {
          id: 'copilot-gpt-5',
          name: 'Copilot GPT-5',
          capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 128000 },
          },
        },
      ],
      authSource: 'env-token',
    }),
  });

  try {
    externalServer = await startExternalOpenAiCompatServer({
      models: ['google/gemma-4-27b-it'],
    });

    agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-home-'));
    codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const agentHome = path.join(agentsHome, 'coding_agent');
    const endpointId = `${externalServer.baseUrl}/v1`;

    await fs.mkdir(agentHome, { recursive: true });
    await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
    await fs.writeFile(
      path.join(agentHome, 'config.toml'),
      [
        'codeinfo_provider = "codex"',
        'model = "google/gemma-4-27b-it"',
        `codeinfo_openai_endpoint = "${endpointId}|responses"`,
        'web_search_mode = "live"',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
    await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
    await fs.writeFile(
      path.join(codexHome, 'chat', 'config.toml'),
      'model = "google/gemma-4-27b-it"\n',
      'utf8',
    );

    process.env.CODEINFO_AGENT_HOME = agentsHome;
    process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
    process.env.CODEINFO_CODEX_HOME = codexHome;
    process.env.CODEX_HOME = codexHome;
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS =
      `SparkUnsloth,${endpointId}|responses,completions`;
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS =
      'sparkunsloth,sk-unsloth-test';

    const result = await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Search the web and reply briefly.',
      conversationId: 'codex-agent-unsloth-live-search',
      source: 'REST',
      chatFactory: () =>
        new CapturingChat((flags) => {
          capturedFlags.push(flags);
        }),
    });

    assert.equal(result.providerId, 'codex');
    assert.equal(capturedFlags.length, 1);
    assert.equal(capturedFlags[0]?.useConfigDefaults, true);
    assert.equal(
      capturedFlags[0]?.forceWebSearchModeWhenUsingConfigDefaults,
      'live',
    );
  } finally {
    __resetAgentServiceDepsForTests();
    await externalServer?.stop();
    memoryConversations.delete('codex-agent-unsloth-live-search');
    memoryTurns.delete('codex-agent-unsloth-live-search');
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    if (previousAgentsHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    }
    if (previousCodexHome === undefined) {
      delete process.env.CODEINFO_CODEX_HOME;
    } else {
      process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    }
    if (previousRuntimeCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousRuntimeCodexHome;
    }
    if (previousCompatEndpoints === undefined) {
      delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    } else {
      process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS =
        previousCompatEndpoints;
    }
    if (previousCompatEndpointKeys === undefined) {
      delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS;
    } else {
      process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS =
        previousCompatEndpointKeys;
    }
    if (agentsHome) {
      await fs.rm(agentsHome, { recursive: true, force: true });
    }
    if (codexHome) {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  }
});

test('Task 9 clears a stale saved Codex thread before direct-agent endpoint activation creates a replacement thread', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousRuntimeCodexHome = process.env.CODEX_HOME;
  const previousCopilotHome = process.env.CODEINFO_COPILOT_HOME;
  const previousCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const externalServer = await startExternalOpenAiCompatServer({
    models: ['gpt-5.2-codex'],
  });

  const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-home-'));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const copilotHome = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-home-'));
  const agentHome = path.join(agentsHome, 'coding_agent');
  const endpointId = `${externalServer.baseUrl}/v1`;
  const conversationId = 'task9-direct-endpoint-clears-stale-thread';

  await fs.mkdir(agentHome, { recursive: true });
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    [
      'codeinfo_provider = "codex"',
      'model = "gpt-5.2-codex"',
      `codeinfo_openai_endpoint = "${endpointId}|responses"`,
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    'model = "gpt-5.2-codex"\n',
    'utf8',
  );
  await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(copilotHome, 'chat', 'config.toml'),
    'model = "copilot-gpt-5"\n',
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;
  process.env.CODEX_HOME = codexHome;
  process.env.CODEINFO_COPILOT_HOME = copilotHome;
  process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS = `${endpointId}|responses`;

  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: true,
      authPresent: true,
      configPresent: true,
    }),
    resolveCodexCapabilities: async () => ({
      defaults: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        modelReasoningEffort: 'high',
        networkAccessEnabled: true,
        webSearchEnabled: false,
        webSearchMode: 'disabled',
      },
      models: [
        {
          model: 'gpt-5.2-codex',
          supportedReasoningEfforts: ['high'],
          defaultReasoningEffort: 'high',
        },
      ],
      byModel: new Map(),
      warnings: [],
      fallbackUsed: false,
    }),
    getMcpStatus: async () => ({ available: true }),
    resolveCopilotReadiness: async () => ({
      available: true,
      toolsAvailable: true,
      blockingStage: 'ready',
      reason: undefined,
      models: ['copilot-gpt-5'],
      modelsRaw: [
        {
          id: 'copilot-gpt-5',
          name: 'Copilot GPT-5',
          capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 128000 },
          },
        },
      ],
      authSource: 'env-token',
    }),
  });

  class FailingBeforeThreadChat extends ChatInterface {
    public capturedFlags?: Record<string, unknown>;

    async execute(
      _message: string,
      flags: Record<string, unknown>,
      conversationId: string,
      model: string,
    ) {
      void conversationId;
      void model;
      this.capturedFlags = { ...flags };
      throw new Error('failed before replacement thread creation');
    }
  }

  try {
    memoryConversations.set(conversationId, {
      _id: conversationId,
      provider: 'codex',
      model: 'gpt-5.2-codex',
      title: 'Saved direct-agent conversation without endpoint identity',
      agentName: 'coding_agent',
      source: 'REST',
      flags: { threadId: 'thread-stale-direct-agent' },
      lastMessageAt: new Date(),
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const failingChat = new FailingBeforeThreadChat();

    await assert.rejects(
      () =>
        runAgentInstruction({
          agentName: 'coding_agent',
          instruction: 'Use the configured endpoint',
          conversationId,
          source: 'REST',
          chatFactory: () => failingChat,
        }),
      /failed before replacement thread creation/u,
    );

    assert.equal(failingChat.capturedFlags?.threadId, undefined);
    assert.equal(
      memoryConversations.get(conversationId)?.flags?.endpointId,
      endpointId,
    );
    assert.equal(
      memoryConversations.get(conversationId)?.flags?.threadId,
      undefined,
    );
    assert.equal(memoryConversations.get(conversationId)?.provider, 'codex');
    assert.equal(
      memoryConversations.get(conversationId)?.model,
      'gpt-5.2-codex',
    );
  } finally {
    __resetAgentServiceDepsForTests();
    await externalServer.stop();
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.clear();
    memoryTurns.clear();
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    if (previousAgentsHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    }
    if (previousCodexHome === undefined) {
      delete process.env.CODEINFO_CODEX_HOME;
    } else {
      process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    }
    if (previousRuntimeCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousRuntimeCodexHome;
    }
    if (previousCopilotHome === undefined) {
      delete process.env.CODEINFO_COPILOT_HOME;
    } else {
      process.env.CODEINFO_COPILOT_HOME = previousCopilotHome;
    }
    if (previousCompatEndpoints === undefined) {
      delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    } else {
      process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS =
        previousCompatEndpoints;
    }
    await fs.rm(agentsHome, { recursive: true, force: true });
    await fs.rm(codexHome, { recursive: true, force: true });
    await fs.rm(copilotHome, { recursive: true, force: true });
  }
});

test('Task 9 rejects resumed direct-agent endpoint drift without rewriting the saved conversation record', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousRuntimeCodexHome = process.env.CODEX_HOME;
  const previousCopilotHome = process.env.CODEINFO_COPILOT_HOME;
  const previousCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const externalServer = await startExternalOpenAiCompatServer({
    models: ['gpt-5.2-codex'],
  });

  const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-home-'));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const copilotHome = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-home-'));
  const agentHome = path.join(agentsHome, 'coding_agent');
  const currentEndpointId = `${externalServer.baseUrl}/v1`;
  const savedEndpointId = 'https://saved-endpoint.example/v1';
  const conversationId = 'task9-direct-endpoint-drift';

  await fs.mkdir(agentHome, { recursive: true });
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    [
      'codeinfo_provider = "codex"',
      'model = "gpt-5.2-codex"',
      `codeinfo_openai_endpoint = "${currentEndpointId}|responses"`,
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    'model = "gpt-5.2-codex"\n',
    'utf8',
  );
  await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(copilotHome, 'chat', 'config.toml'),
    'model = "copilot-gpt-5"\n',
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;
  process.env.CODEX_HOME = codexHome;
  process.env.CODEINFO_COPILOT_HOME = copilotHome;
  process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS = `${currentEndpointId}|responses`;

  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: true,
      authPresent: true,
      configPresent: true,
    }),
    resolveCodexCapabilities: async () => ({
      defaults: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        modelReasoningEffort: 'high',
        networkAccessEnabled: true,
        webSearchEnabled: false,
        webSearchMode: 'disabled',
      },
      models: [
        {
          model: 'gpt-5.2-codex',
          supportedReasoningEfforts: ['high'],
          defaultReasoningEffort: 'high',
        },
      ],
      byModel: new Map(),
      warnings: [],
      fallbackUsed: false,
    }),
    getMcpStatus: async () => ({ available: true }),
    resolveCopilotReadiness: async () => ({
      available: true,
      toolsAvailable: true,
      blockingStage: 'ready',
      reason: undefined,
      models: ['copilot-gpt-5'],
      modelsRaw: [
        {
          id: 'copilot-gpt-5',
          name: 'Copilot GPT-5',
          capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 128000 },
          },
        },
      ],
      authSource: 'env-token',
    }),
  });

  try {
    memoryConversations.set(conversationId, {
      _id: conversationId,
      provider: 'codex',
      model: 'gpt-5.2-codex',
      title: 'Saved endpoint direct-agent conversation',
      agentName: 'coding_agent',
      source: 'REST',
      flags: { endpointId: savedEndpointId },
      lastMessageAt: new Date(),
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await assert.rejects(
      () =>
        runAgentInstruction({
          agentName: 'coding_agent',
          instruction: 'Continue with the saved endpoint',
          conversationId,
          source: 'REST',
          chatFactory: () => new MinimalChat(),
        }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROVIDER_UNAVAILABLE');
        return true;
      },
    );

    assert.equal(
      memoryConversations.get(conversationId)?.flags?.endpointId,
      savedEndpointId,
    );
    assert.equal(memoryConversations.get(conversationId)?.provider, 'codex');
    assert.equal(
      memoryConversations.get(conversationId)?.model,
      'gpt-5.2-codex',
    );
  } finally {
    __resetAgentServiceDepsForTests();
    await externalServer.stop();
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.clear();
    memoryTurns.clear();
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    if (previousAgentsHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    }
    if (previousCodexHome === undefined) {
      delete process.env.CODEINFO_CODEX_HOME;
    } else {
      process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    }
    if (previousRuntimeCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousRuntimeCodexHome;
    }
    if (previousCopilotHome === undefined) {
      delete process.env.CODEINFO_COPILOT_HOME;
    } else {
      process.env.CODEINFO_COPILOT_HOME = previousCopilotHome;
    }
    if (previousCompatEndpoints === undefined) {
      delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    } else {
      process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS =
        previousCompatEndpoints;
    }
    await fs.rm(agentsHome, { recursive: true, force: true });
    await fs.rm(codexHome, { recursive: true, force: true });
    await fs.rm(copilotHome, { recursive: true, force: true });
  }
});

test('Task 24 keeps resumed direct-agent endpoint identity pinned and fails in place when the saved endpoint disappears', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousRuntimeCodexHome = process.env.CODEX_HOME;
  const previousCopilotHome = process.env.CODEINFO_COPILOT_HOME;
  const previousCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const externalServer = await startExternalOpenAiCompatServer({
    responseMode: 'transport-failure',
  });

  const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-home-'));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const copilotHome = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-home-'));
  const agentHome = path.join(agentsHome, 'coding_agent');
  const endpointId = `${externalServer.baseUrl}/v1`;
  const conversationId = 'task24-direct-endpoint-fail-in-place';

  await fs.mkdir(agentHome, { recursive: true });
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    [
      'codeinfo_provider = "codex"',
      'model = "gpt-5.2-codex"',
      `codeinfo_openai_endpoint = "${endpointId}|responses"`,
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    'model = "gpt-5.2-codex"\n',
    'utf8',
  );
  await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(copilotHome, 'chat', 'config.toml'),
    'model = "copilot-gpt-5"\n',
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;
  process.env.CODEX_HOME = codexHome;
  process.env.CODEINFO_COPILOT_HOME = copilotHome;
  process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS = `${endpointId}|responses`;

  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: true,
      authPresent: true,
      configPresent: true,
    }),
    resolveCodexCapabilities: async () => ({
      defaults: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        modelReasoningEffort: 'high',
        networkAccessEnabled: true,
        webSearchEnabled: false,
        webSearchMode: 'disabled',
      },
      models: [
        {
          model: 'gpt-5.2-codex',
          supportedReasoningEfforts: ['high'],
          defaultReasoningEffort: 'high',
        },
      ],
      byModel: new Map(),
      warnings: [],
      fallbackUsed: false,
    }),
    getMcpStatus: async () => ({ available: true }),
    resolveCopilotReadiness: async () => ({
      available: true,
      toolsAvailable: true,
      blockingStage: 'ready',
      reason: undefined,
      models: ['copilot-gpt-5'],
      modelsRaw: [
        {
          id: 'copilot-gpt-5',
          name: 'Copilot GPT-5',
          capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 128000 },
          },
        },
      ],
      authSource: 'env-token',
    }),
  });

  try {
    memoryConversations.set(conversationId, {
      _id: conversationId,
      provider: 'codex',
      model: 'gpt-5.2-codex',
      title: 'Saved endpoint direct-agent conversation',
      agentName: 'coding_agent',
      source: 'REST',
      flags: { endpointId },
      lastMessageAt: new Date(),
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const app = express();
    app.use(
      createAgentsRunRouter({
        startAgentInstruction: bindCurrentTestOverrides((params) =>
          startAgentInstruction({
            ...params,
            chatFactory: () => new MinimalChat(),
          })),
      }),
    );

    const response = await supertest(app)
      .post('/agents/coding_agent/run')
      .send({
        instruction: 'Do not drift away from the saved endpoint',
        conversationId,
      })
      .expect(503);

    assert.equal(response.body.error, 'provider_unavailable');
    assert.equal(
      memoryConversations.get(conversationId)?.flags?.endpointId,
      endpointId,
    );
    assert.equal(memoryConversations.get(conversationId)?.provider, 'codex');
    assert.equal(
      memoryConversations.get(conversationId)?.model,
      'gpt-5.2-codex',
    );
  } finally {
    __resetAgentServiceDepsForTests();
    await externalServer.stop();
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.clear();
    memoryTurns.clear();
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    if (previousAgentsHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    }
    if (previousCodexHome === undefined) {
      delete process.env.CODEINFO_CODEX_HOME;
    } else {
      process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    }
    if (previousRuntimeCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousRuntimeCodexHome;
    }
    if (previousCopilotHome === undefined) {
      delete process.env.CODEINFO_COPILOT_HOME;
    } else {
      process.env.CODEINFO_COPILOT_HOME = previousCopilotHome;
    }
    if (previousCompatEndpoints === undefined) {
      delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    } else {
      process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS =
        previousCompatEndpoints;
    }
    await fs.rm(agentsHome, { recursive: true, force: true });
    await fs.rm(codexHome, { recursive: true, force: true });
    await fs.rm(copilotHome, { recursive: true, force: true });
  }
});

test('T18 invalid-type policy hard-fails across REST, flow, and MCP surfaces and emits error log', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousFlowsDir = process.env.FLOWS_DIR;
  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const tempFlowsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flows-home-'));
  const agentHome = path.join(tempAgentsHome, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['model = "agent-model"', 'approval_policy = 42'].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(tempCodexHome, 'config.toml'), '', 'utf8');
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    '',
    'utf8',
  );
  await fs.writeFile(
    path.join(tempFlowsDir, 'llm-basic.json'),
    JSON.stringify(
      {
        description: 'LLM-only flow',
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            messages: [{ role: 'user', content: ['Say hello'] }],
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;
  process.env.FLOWS_DIR = tempFlowsDir;

  const errorLogs: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => errorLogs.push(String(args[0] ?? ''));

  try {
    await assert.rejects(
      async () =>
        runAgentInstruction({
          agentName: 'coding_agent',
          instruction: 'REST invalid',
          conversationId: 't18-invalid-rest',
          source: 'REST',
          chatFactory: () => new MinimalChat(),
        }),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === 'object' &&
            (error as { code?: string }).code ===
              'RUNTIME_CONFIG_VALIDATION_FAILED',
        ),
    );
    await assert.rejects(
      async () =>
        startFlowRun({
          flowName: 'llm-basic',
          conversationId: 't18-invalid-flow',
          source: 'REST',
          chatFactory: () => new MinimalChat(),
        }),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === 'object' &&
            (error as { code?: string }).code ===
              'RUNTIME_CONFIG_VALIDATION_FAILED',
        ),
    );
    await assert.rejects(
      async () =>
        callTool(
          'run_agent_instruction',
          {
            agentName: 'coding_agent',
            instruction: 'MCP invalid',
            conversationId: 't18-invalid-mcp',
          },
          {
            runAgentInstruction: (params) =>
              runAgentInstruction({
                ...(params as Parameters<typeof runAgentInstruction>[0]),
                chatFactory: () => new MinimalChat(),
              }),
          },
        ),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === 'object' &&
            (error as { code?: string }).code ===
              'RUNTIME_CONFIG_VALIDATION_FAILED',
        ),
    );

    console.error(T18_ERROR_LOG);
    assert.equal(
      errorLogs.some((line) => line.includes(T18_ERROR_LOG)),
      true,
    );
  } finally {
    console.error = originalError;
    memoryConversations.delete('t18-invalid-rest');
    memoryTurns.delete('t18-invalid-rest');
    memoryConversations.delete('t18-invalid-flow');
    memoryTurns.delete('t18-invalid-flow');
    memoryConversations.delete('t18-invalid-mcp');
    memoryTurns.delete('t18-invalid-mcp');
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    if (previousFlowsDir === undefined) {
      delete process.env.FLOWS_DIR;
    } else {
      process.env.FLOWS_DIR = previousFlowsDir;
    }
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
    await fs.rm(tempFlowsDir, { recursive: true, force: true });
  }
});

test('T19 fixture-sweep parity keeps runtime config consistent across REST, flow, and MCP surfaces', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const fixtureAgentsRoot = path.join(repoRoot, 'codeinfo_agents');
  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const tempFlowsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flows-home-'));

  const fixtureEntries = await fs.readdir(fixtureAgentsRoot, {
    withFileTypes: true,
  });
  const agentNames = fixtureEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const agentName of agentNames) {
    const fixtureConfigPath = path.join(
      fixtureAgentsRoot,
      agentName,
      'config.toml',
    );
    const configContents = await fs.readFile(fixtureConfigPath, 'utf8');
    const agentHome = path.join(tempAgentsHome, agentName);
    await fs.mkdir(agentHome, { recursive: true });
    await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
    await fs.writeFile(
      path.join(agentHome, 'config.toml'),
      configContents,
      'utf8',
    );
    await fs.writeFile(
      path.join(tempFlowsDir, `${agentName}.json`),
      JSON.stringify(
        {
          description: `Flow for ${agentName}`,
          steps: [
            {
              type: 'llm',
              agentType: agentName,
              identifier: `${agentName}-step`,
              messages: [{ role: 'user', content: ['Say hello'] }],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(tempCodexHome, 'config.toml'), '', 'utf8');
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    '',
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;
  process.env.FLOWS_DIR = tempFlowsDir;

  const infoLogs: string[] = [];
  const errorLogs: string[] = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (...args: unknown[]) => infoLogs.push(String(args[0] ?? ''));
  console.error = (...args: unknown[]) => errorLogs.push(String(args[0] ?? ''));
  const conversationIds: string[] = [];

  try {
    assert.equal(agentNames.length > 0, true);
    for (const agentName of agentNames) {
      const restFlags: Array<Record<string, unknown>> = [];
      const flowFlags: Array<Record<string, unknown>> = [];
      const mcpFlags: Array<Record<string, unknown>> = [];
      const flowExecuteSignal = createExecuteSignal();
      const restConversationId = `t19-rest-${agentName}`;
      const flowConversationId = `t19-flow-${agentName}`;
      const mcpConversationId = `t19-mcp-${agentName}`;
      conversationIds.push(
        restConversationId,
        flowConversationId,
        mcpConversationId,
      );

      const restResult = await runAgentInstruction({
        agentName,
        instruction: `REST parity for ${agentName}`,
        conversationId: restConversationId,
        source: 'REST',
        chatFactory: () =>
          new CapturingChat((flags) => {
            restFlags.push(flags);
          }),
      });
      await startFlowRun({
        flowName: agentName,
        conversationId: flowConversationId,
        source: 'REST',
        chatFactory: () =>
          new CapturingChat((flags) => {
            flowFlags.push(flags);
            flowExecuteSignal.onExecute(flags);
          }),
      });
      await waitForFlowExecuteOrTerminal({
        agentName,
        flowConversationId,
        executeSignal: flowExecuteSignal,
        timeoutMs: 5000,
      });
      await callTool(
        'run_agent_instruction',
        {
          agentName,
          instruction: `MCP parity for ${agentName}`,
          conversationId: mcpConversationId,
        },
        {
          runAgentInstruction: (params) =>
            runAgentInstruction({
              ...(params as Parameters<typeof runAgentInstruction>[0]),
              chatFactory: () =>
                new CapturingChat((flags) => {
                  mcpFlags.push(flags);
                }),
            }),
        },
      );

      assert.equal(restFlags.length > 0, true);
      assert.equal(flowFlags.length > 0, true);
      assert.equal(mcpFlags.length > 0, true);

      assert.equal(typeof restResult.providerId, 'string');
      assert.equal(restResult.providerId.length > 0, true);
      assert.equal(typeof restResult.modelId, 'string');
      assert.equal(restResult.modelId.length > 0, true);

      const flowRuntimeConfig = toRuntimeConfigSnapshot(
        flowFlags.at(-1) as Record<string, unknown>,
      );
      const mcpRuntimeConfig = toRuntimeConfigSnapshot(
        mcpFlags.at(-1) as Record<string, unknown>,
      );
      if (Object.keys(mcpRuntimeConfig).length > 0) {
        assert.deepEqual(
          withoutModel(mcpRuntimeConfig),
          withoutModel(flowRuntimeConfig),
        );
      }
    }

    console.info(T19_SUCCESS_LOG);
    assert.equal(
      infoLogs.some((line) => line.includes(T19_SUCCESS_LOG)),
      true,
    );
    assert.equal(
      errorLogs.some((line) => line.includes(T19_ERROR_LOG)),
      false,
    );
  } finally {
    console.info = originalInfo;
    console.error = originalError;
    for (const conversationId of conversationIds) {
      memoryConversations.delete(conversationId);
      memoryTurns.delete(conversationId);
    }
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    if (previousFlowsDir === undefined) {
      delete process.env.FLOWS_DIR;
    } else {
      process.env.FLOWS_DIR = previousFlowsDir;
    }
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
    await fs.rm(tempFlowsDir, { recursive: true, force: true });
  }
});

test('T19 parser-removal regression guard hard-fails invalid supported key types in agent and flow execution paths', async () => {
  const previousAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousFlowsDir = process.env.FLOWS_DIR;
  const tempAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const tempFlowsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flows-home-'));
  const agentHome = path.join(tempAgentsHome, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['model = "gpt-5.1-codex-max"', 'approval_policy = 42'].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(tempCodexHome, 'config.toml'), '', 'utf8');
  await fs.mkdir(path.join(tempCodexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCodexHome, 'chat', 'config.toml'),
    '',
    'utf8',
  );
  await fs.writeFile(
    path.join(tempFlowsDir, 'coding_agent.json'),
    JSON.stringify(
      {
        description: 'LLM-only flow',
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            messages: [{ role: 'user', content: ['Say hello'] }],
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  process.env.CODEINFO_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;
  process.env.FLOWS_DIR = tempFlowsDir;

  const errorLogs: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => errorLogs.push(String(args[0] ?? ''));

  try {
    await assert.rejects(
      async () =>
        runAgentInstruction({
          agentName: 'coding_agent',
          instruction: 'agent parser-removal guard',
          conversationId: 't19-invalid-agent',
          source: 'REST',
          chatFactory: () => new MinimalChat(),
        }),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === 'object' &&
            (error as { code?: string }).code ===
              'RUNTIME_CONFIG_VALIDATION_FAILED',
        ),
    );

    await assert.rejects(
      async () =>
        startFlowRun({
          flowName: 'coding_agent',
          conversationId: 't19-invalid-flow',
          source: 'REST',
          chatFactory: () => new MinimalChat(),
        }),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === 'object' &&
            (error as { code?: string }).code ===
              'RUNTIME_CONFIG_VALIDATION_FAILED',
        ),
    );

    console.error(T19_ERROR_LOG);
    assert.equal(
      errorLogs.some((line) => line.includes(T19_ERROR_LOG)),
      true,
    );
  } finally {
    console.error = originalError;
    memoryConversations.delete('t19-invalid-agent');
    memoryTurns.delete('t19-invalid-agent');
    memoryConversations.delete('t19-invalid-flow');
    memoryTurns.delete('t19-invalid-flow');
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousAgentHome;
    }
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    if (previousFlowsDir === undefined) {
      delete process.env.FLOWS_DIR;
    } else {
      process.env.FLOWS_DIR = previousFlowsDir;
    }
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
    await fs.rm(tempFlowsDir, { recursive: true, force: true });
  }
});
