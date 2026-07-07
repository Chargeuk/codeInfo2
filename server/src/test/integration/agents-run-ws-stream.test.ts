import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import pkg from '../../../package.json' with { type: 'json' };

import {
  __resetAgentServiceDepsForTests,
  __setAgentServiceDepsForTests,
  runAgentCommand,
  runAgentInstructionUnlocked,
} from '../../agents/service.js';
import { getChatInterface } from '../../chat/factory.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { DEV_0000037_T01_REQUIRED_VERSION } from '../../config/codexSdkUpgrade.js';
import { resetStore } from '../../logStore.js';
import { attachWs } from '../../ws/server.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';
import {
  createMockCopilotSdkHarness,
  createSessionIdleEvent,
} from '../support/mockCopilotSdk.js';
import { runWithTestEnvOverrides } from '../support/testEnvOverrideScope.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);

const withScopedTestEnv = async <T>(
  overrides: Record<string, string | undefined>,
  run: () => Promise<T>,
) => await runWithTestEnvOverrides(overrides, run);

const getMcpServerKeys = (
  mcpServers: Record<string, unknown> | undefined,
): string[] => Object.keys(mcpServers ?? {}).sort();

const getMcpServerTools = (
  mcpServers: Record<string, { tools?: string[] }> | undefined,
): Record<string, string[] | undefined> =>
  Object.fromEntries(
    Object.entries(mcpServers ?? {}).map(([name, config]) => [
      name,
      config.tools,
    ]),
  );

beforeEach(() => {
  installDeterministicCodexAvailabilityBootstrap();
});

afterEach(() => {
  resetDeterministicCodexAvailabilityBootstrap();
});

class StreamingChat extends ChatInterface {
  async execute(
    _message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _model;
    const signal = (flags as { signal?: AbortSignal }).signal;
    const abortIfNeeded = () => {
      if (!signal?.aborted) return false;
      this.emit('error', { type: 'error', message: 'aborted' });
      return true;
    };

    if (abortIfNeeded()) return;
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('analysis', { type: 'analysis', content: 'thinking...' });
    await delay(50);
    if (abortIfNeeded()) return;
    this.emit('token', { type: 'token', content: 'Hel' });
    await delay(50);
    if (abortIfNeeded()) return;
    this.emit('token', { type: 'token', content: 'lo' });
    await delay(50);
    if (abortIfNeeded()) return;
    this.emit('final', { type: 'final', content: 'Hello world' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

class ImmediateChat extends ChatInterface {
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

test('StreamingChat rejects already-aborted state before transcript events', async () => {
  const chat = new StreamingChat();
  const controller = new AbortController();
  const events: string[] = [];
  controller.abort();

  chat.on('error', () => events.push('error'));
  chat.on('thread', () => events.push('thread'));
  chat.on('analysis', () => events.push('analysis'));
  chat.on('token', () => events.push('token'));
  chat.on('final', () => events.push('final'));

  await chat.execute(
    'Hello',
    { signal: controller.signal },
    'agents-preaborted-conv',
    'model',
  );

  assert.deepEqual(events, ['error']);
});

test('Agents runs publish WS transcript events while the run is in progress', async () => {
  assert.equal(
    pkg.dependencies?.['@openai/codex-sdk'],
    DEV_0000037_T01_REQUIRED_VERSION,
  );
  resetStore();

  const app = express();
  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const conversationId = 'agents-ws-conv-1';
  const inflightId = 'agents-ws-inflight-1';
  const ws = await connectWs({ baseUrl });

  try {
    await withScopedTestEnv(
      {
        CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
      },
      async () => {
        sendJson(ws, { type: 'subscribe_conversation', conversationId });

        // Start WS waits before triggering the HTTP request to avoid missing early frames.
        const userTurnPromise = waitForEvent({
          ws,
          predicate: (
            event: unknown,
          ): event is {
            type: 'user_turn';
            conversationId: string;
            inflightId: string;
            content: string;
            createdAt: string;
            seq: number;
          } => {
            const e = event as {
              type?: string;
              conversationId?: string;
              inflightId?: string;
            };
            return (
              e.type === 'user_turn' &&
              e.conversationId === conversationId &&
              e.inflightId === inflightId
            );
          },
          timeoutMs: 15000,
        });

        const snapshotPromise = waitForEvent({
          ws,
          predicate: (
            event: unknown,
          ): event is {
            type: 'inflight_snapshot';
            conversationId: string;
            inflight: { command?: { name: string; stepIndex: number } };
          } => {
            const e = event as {
              type?: string;
              conversationId?: string;
              inflight?: { command?: { name?: string } };
            };
            return (
              e.type === 'inflight_snapshot' &&
              e.conversationId === conversationId
            );
          },
          timeoutMs: 8000,
        });

        const deltaPromise = waitForEvent({
          ws,
          predicate: (
            event: unknown,
          ): event is {
            type: 'assistant_delta';
            conversationId: string;
            inflightId: string;
            seq: number;
            delta: string;
          } => {
            const e = event as {
              type?: string;
              conversationId?: string;
              inflightId?: string;
            };
            return (
              e.type === 'assistant_delta' &&
              e.conversationId === conversationId &&
              e.inflightId === inflightId
            );
          },
          timeoutMs: 8000,
        });

        const finalPromise = waitForEvent({
          ws,
          predicate: (
            event: unknown,
          ): event is { type: string; status: string } => {
            const e = event as {
              type?: string;
              conversationId?: string;
              status?: string;
            };
            return (
              e.type === 'turn_final' && e.conversationId === conversationId
            );
          },
          timeoutMs: 8000,
        });

        const runPromise = runAgentInstructionUnlocked({
          agentName: 'coding_agent',
          instruction: 'Hello',
          conversationId,
          mustExist: false,
          command: { name: 'improve_plan', stepIndex: 1, totalSteps: 3 },
          source: 'REST',
          inflightId,
          chatFactory: () => new StreamingChat(),
        });

        const userTurn = await userTurnPromise;
        assert.equal(userTurn.content, 'Hello');
        assert.equal(typeof userTurn.createdAt, 'string');
        assert.ok(userTurn.createdAt.length > 0);

        const snapshot = await snapshotPromise;
        assert.deepEqual(snapshot.inflight.command, {
          name: 'improve_plan',
          stepIndex: 1,
          totalSteps: 3,
        });
        const delta = await deltaPromise;
        assert(
          userTurn.seq < delta.seq,
          'user_turn should be observed before assistant_delta for the same inflightId',
        );
        const final = await finalPromise;
        assert.equal(final.status, 'ok');

        const result = await runPromise;
        assert.equal(result.conversationId, conversationId);
        assert.equal(result.agentName, 'coding_agent');
      },
    );
  } finally {
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});

test('Agents run passes inflightId into chat.run(...) flags', async () => {
  resetStore();

  let capturedFlags: Record<string, unknown> | null = null;

  class CapturingChat extends ChatInterface {
    async execute(
      _message: string,
      flags: Record<string, unknown>,
      conversationId: string,
      _model: string,
    ) {
      void _message;
      void _model;
      capturedFlags = { ...flags };
      this.emit('thread', { type: 'thread', threadId: conversationId });
      this.emit('final', { type: 'final', content: 'ok' });
      this.emit('complete', { type: 'complete', threadId: conversationId });
    }
  }

  await withScopedTestEnv(
    {
      CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
    },
    async () => {
      const conversationId = 'agents-flags-conv-1';
      const inflightId = 'agents-flags-inflight-1';

      await runAgentInstructionUnlocked({
        agentName: 'coding_agent',
        instruction: 'Hello',
        conversationId,
        mustExist: false,
        source: 'REST',
        inflightId,
        chatFactory: () => new CapturingChat(),
      });

      if (!capturedFlags) throw new Error('expected chat.execute to be called');
      assert.equal(capturedFlags['inflightId'], inflightId);
      assert.equal(capturedFlags['source'], 'REST');
    },
  );
});

test('direct Copilot agent runs forward envOverrides into the Copilot runtime environment', async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-copilot-env-'),
  );
  const agentsHome = path.join(tempRoot, 'agents');
  const agentHome = path.join(agentsHome, 'coding_agent');
  const codexHome = path.join(tempRoot, 'codex-home');
  const copilotHome = path.join(tempRoot, 'copilot-home');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    [
      'codeinfo_provider = "copilot"',
      'model = "copilot-model"',
      '',
      '[mcp_servers.code_info]',
      'command = "npx"',
      'args = ["-y", "mcp-remote", "http://localhost:${CODEINFO_AGENTS_MCP_PORT}/mcp"]',
      'tool_timeout_sec = 1800',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    'model = "codex-model"\n',
    'utf8',
  );
  await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(copilotHome, 'chat', 'config.toml'),
    [
      'model = "copilot-model"',
      'tool_access = "off"',
      '',
      '[mcp_servers.context7]',
      'command = "npx"',
      'args = ["-y", "@upstash/context7-mcp"]',
      '',
    ].join('\n'),
    'utf8',
  );

  const capturedOptions: { env?: NodeJS.ProcessEnv }[] = [];
  const harness = createMockCopilotSdkHarness({
    name: 'direct-agent-copilot-env-forwarding',
    createSessionEvents: [createSessionIdleEvent()],
  });

  __setAgentServiceDepsForTests({
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

  try {
    await withScopedTestEnv(
      {
        CODEINFO_AGENT_HOME: agentsHome,
        CODEINFO_CODEX_HOME: codexHome,
        CODEINFO_COPILOT_HOME: copilotHome,
        CODEINFO_AGENTS_MCP_PORT: '5020',
      },
      async () => {
        const result = await runAgentInstructionUnlocked({
          agentName: 'coding_agent',
          instruction: 'Hello from Copilot',
          conversationId: 'copilot-direct-env-forwarding',
          source: 'REST',
          envOverrides: { CODEINFO_ROOT: '/tmp/codeinfo-root' },
          chatFactory: (provider, deps) =>
            getChatInterface(provider, {
              ...deps,
              copilotClientFactory: (options) => {
                capturedOptions.push(options);
                return harness.createClientFactory()(options);
              },
            }),
        });

        assert.equal(result.providerId, 'copilot');
        assert.equal(capturedOptions.length, 1);
        assert.equal(
          capturedOptions[0]?.env?.CODEINFO_ROOT,
          '/tmp/codeinfo-root',
        );
        assert.equal(capturedOptions[0]?.env?.COPILOT_HOME, copilotHome);
        assert.deepEqual(
          getMcpServerKeys(harness.getState().lastCreateSessionConfig?.mcpServers),
          ['code_info'],
        );
        assert.deepEqual(
          harness.getState().lastCreateSessionConfig?.mcpServers?.code_info,
          {
            type: 'stdio',
            command: 'npx',
            args: ['-y', 'mcp-remote', 'http://localhost:5020/mcp'],
            tools: [],
            timeout: 1_800_000,
          },
        );
        assert.deepEqual(
          getMcpServerTools(
            harness.getState().lastCreateSessionConfig?.mcpServers,
          ),
          {
            code_info: [],
          },
        );
      },
    );
  } finally {
    __resetAgentServiceDepsForTests();
    memoryConversations.clear();
    memoryTurns.clear();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('direct agent runs can fall back to a different provider when the requested provider is invalid', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-ws-'));
  const agentsHome = path.join(tempRoot, 'agents');
  const agentHome = path.join(agentsHome, 'coding_agent');
  const codexHome = path.join(tempRoot, 'codex-home');
  const copilotHome = path.join(tempRoot, 'copilot-home');
  await fs.mkdir(path.join(agentHome), { recursive: true });
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    'codeinfo_provider = "bad-provider"\nmodel = "missing-model"\n',
    'utf8',
  );
  await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    'model = "codex-model"\n',
    'utf8',
  );
  await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(copilotHome, 'chat', 'config.toml'),
    'model = "copilot-model"\n',
    'utf8',
  );

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
          model: 'codex-model',
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

  try {
    await withScopedTestEnv(
      {
        CODEINFO_AGENT_HOME: agentsHome,
        CODEINFO_CODEX_HOME: codexHome,
        CODEINFO_COPILOT_HOME: copilotHome,
        CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER: 'copilot,codex',
      },
      async () => {
        const result = await runAgentInstructionUnlocked({
          agentName: 'coding_agent',
          instruction: 'Hello',
          conversationId: 'task5-provider-fallback',
          source: 'REST',
          chatFactory: () => new ImmediateChat(),
        });

        assert.equal(result.providerId, 'copilot');
        assert.equal(result.modelId, 'copilot-model');
        const conversation = memoryConversations.get(result.conversationId);
        assert.equal(conversation?.provider, 'copilot');
        assert.equal(conversation?.model, 'copilot-model');
      },
    );
  } finally {
    __resetAgentServiceDepsForTests();
    memoryConversations.clear();
    memoryTurns.clear();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('saved execution identity fails in place when the pinned provider later becomes unavailable', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-ws-'));
  const agentsHome = path.join(tempRoot, 'agents');
  const agentHome = path.join(agentsHome, 'coding_agent');
  const codexHome = path.join(tempRoot, 'codex-home');
  await fs.mkdir(path.join(agentHome), { recursive: true });
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    'codeinfo_provider = "codex"\nmodel = "codex-model"\n',
    'utf8',
  );
  await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    'model = "codex-model"\n',
    'utf8',
  );

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
          model: 'codex-model',
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
      blockingStage: 'connectivity',
      models: [],
      modelsRaw: [],
      authSource: 'unauthenticated',
      reason: 'copilot connectivity unavailable',
    }),
  });

  try {
    await withScopedTestEnv(
      {
        CODEINFO_AGENT_HOME: agentsHome,
        CODEINFO_CODEX_HOME: codexHome,
      },
      async () => {
        const first = await runAgentInstructionUnlocked({
          agentName: 'coding_agent',
          instruction: 'Hello',
          conversationId: 'task5-fail-in-place',
          source: 'REST',
          chatFactory: () => new ImmediateChat(),
        });
        assert.equal(first.providerId, 'codex');

        __setAgentServiceDepsForTests({
          getCodexDetection: () => ({
            available: false,
            authPresent: false,
            configPresent: true,
            reason: 'codex unavailable',
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
                model: 'codex-model',
                supportedReasoningEfforts: ['high'],
                defaultReasoningEffort: 'high',
              },
            ],
            byModel: new Map(),
            warnings: [],
            fallbackUsed: false,
          }),
        });

        await assert.rejects(
          () =>
            runAgentInstructionUnlocked({
              agentName: 'coding_agent',
              instruction: 'Hello again',
              conversationId: first.conversationId,
              source: 'REST',
              chatFactory: () => new ImmediateChat(),
            }),
          (error: unknown) =>
            (error as { code?: string }).code === 'PROVIDER_UNAVAILABLE',
        );
        const conversation = memoryConversations.get(first.conversationId);
        assert.equal(conversation?.provider, 'codex');
        assert.equal(conversation?.model, 'codex-model');
      },
    );
  } finally {
    __resetAgentServiceDepsForTests();
    memoryConversations.clear();
    memoryTurns.clear();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('startStep > 1 keeps absolute command metadata in websocket events', async () => {
  resetStore();
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
      'codeinfo_provider = "codex"',
      'model = "gpt-5.3-codex"',
      'approval_policy = "never"',
    ].join('\n'),
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
    path.join(commandsDir, 'offset.json'),
    JSON.stringify(
      {
        Description: 'Offset command',
        items: [
          { type: 'message', role: 'user', content: ['s1'] },
          { type: 'message', role: 'user', content: ['s2'] },
          { type: 'message', role: 'user', content: ['s3'] },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );
  const app = express();
  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const conversationId = 'agents-ws-start-step-offset';
  const ws = await connectWs({ baseUrl });

  try {
    await withScopedTestEnv(
      {
        CODEINFO_AGENT_HOME: tempAgentsHome,
        CODEINFO_CODEX_AGENT_HOME: tempAgentsHome,
        CODEINFO_CODEX_HOME: tempCodexHome,
      },
      async () => {
        sendJson(ws, { type: 'subscribe_conversation', conversationId });
        const snapshotPromise = waitForEvent({
          ws,
          predicate: (
            event: unknown,
          ): event is {
            type: 'inflight_snapshot';
            conversationId: string;
            inflight: {
              command?: { name: string; stepIndex: number; totalSteps: number };
            };
          } => {
            const e = event as {
              type?: string;
              conversationId?: string;
              inflight?: { command?: { name?: string; stepIndex?: number } };
            };
            return (
              e.type === 'inflight_snapshot' &&
              e.conversationId === conversationId &&
              e.inflight?.command?.name === 'offset' &&
              e.inflight.command.stepIndex === 3
            );
          },
          timeoutMs: 15000,
        });

        await runAgentCommand({
          agentName: 'coding_agent',
          commandName: 'offset',
          startStep: 3,
          conversationId,
          source: 'REST',
          chatFactory: () => new StreamingChat(),
        });

        const snapshot = await snapshotPromise;
        assert.deepEqual(snapshot.inflight.command, {
          name: 'offset',
          stepIndex: 3,
          totalSteps: 3,
        });
      },
    );
  } finally {
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await fs.rm(tempAgentsHome, { recursive: true, force: true });
    await fs.rm(tempCodexHome, { recursive: true, force: true });
  }
});
