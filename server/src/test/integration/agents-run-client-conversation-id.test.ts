import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import supertest from 'supertest';

import { runAgentCommand, runAgentInstruction } from '../../agents/service.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { startFlowRun } from '../../flows/service.js';
import { resetStore } from '../../logStore.js';
import { callTool } from '../../mcpAgents/tools.js';
import { createCodexDeviceAuthRouter } from '../../routes/codexDeviceAuth.js';

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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (predicate: () => boolean, timeoutMs = 2000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await delay(25);
  }
  throw new Error('Timed out waiting for condition');
};

const toRuntimeConfigSnapshot = (flags: Record<string, unknown>) =>
  structuredClone(
    (flags.runtimeConfig as Record<string, unknown> | undefined) ?? {},
  );

const T18_SUCCESS_LOG =
  '[DEV-0000037][T18] event=precedence_normalization_regressions_executed result=success';
const T18_ERROR_LOG =
  '[DEV-0000037][T18] event=precedence_normalization_regressions_executed result=error';

test('Agents runs accept a client-supplied conversationId even when it does not exist yet', async () => {
  resetStore();

  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
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
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
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
    await runAgentInstruction({
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
    assert.equal(flags.useConfigDefaults, true);
    assert.equal('codexHome' in flags, false);
    assert.equal(typeof flags.runtimeConfig, 'object');

    const runtimeConfig = flags.runtimeConfig as {
      model?: string;
      projects?: Record<string, { trust_level?: string }>;
    };
    assert.equal(runtimeConfig.model, 'agent-model-1');
    assert.equal(
      runtimeConfig.projects?.['/base-only']?.trust_level,
      'trusted',
    );
    assert.equal(runtimeConfig.projects?.['/shared']?.trust_level, 'untrusted');
    assert.equal(
      runtimeConfig.projects?.['/agent-only']?.trust_level,
      'trusted',
    );
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

  process.env.CODEINFO_CODEX_AGENT_HOME = tempAgentsHome;
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;

  const capturedFlags: Array<Record<string, unknown>> = [];
  const originalError = console.error;
  const errorLogs: string[] = [];
  console.error = (...args: unknown[]) => errorLogs.push(String(args[0] ?? ''));

  try {
    await runAgentCommand({
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
    assert.equal(flags.useConfigDefaults, true);
    assert.equal('codexHome' in flags, false);
    assert.equal(
      (flags.runtimeConfig as { model?: string }).model,
      'agent-command-model',
    );
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
    await runAgentInstruction({
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
    assert.equal('codexHome' in baselineFlags, false);

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
    assert.deepEqual(flowRuntimeConfig, baselineRuntimeConfig);
    assert.deepEqual(mcpRuntimeConfig, baselineRuntimeConfig);

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
        ok: true,
        rawOutput: 'Open https://device.test/verify and enter code CODE-123.',
        completion: Promise.resolve({
          exitCode: 0,
          result: {
            ok: true,
            rawOutput:
              'Open https://device.test/verify and enter code CODE-123.',
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
    await runAgentInstruction({
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

    const baselineRuntimeConfig = toRuntimeConfigSnapshot(
      restFlags.at(-1) as Record<string, unknown>,
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
      toRuntimeConfigSnapshot(commandFlags.at(-1) as Record<string, unknown>),
      baselineRuntimeConfig,
    );
    assert.deepEqual(
      toRuntimeConfigSnapshot(flowFlags.at(-1) as Record<string, unknown>),
      baselineRuntimeConfig,
    );
    assert.deepEqual(
      toRuntimeConfigSnapshot(mcpFlags.at(-1) as Record<string, unknown>),
      baselineRuntimeConfig,
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

test('T18 unknown-key policy is warning+ignore across REST, flow, and MCP surfaces', async () => {
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
    await runAgentInstruction({
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

    const baselineRuntimeConfig = toRuntimeConfigSnapshot(
      restFlags.at(-1) as Record<string, unknown>,
    );
    assert.equal('top_level_unknown' in baselineRuntimeConfig, false);
    assert.equal(
      'unknown_feature_flag' in
        ((baselineRuntimeConfig.features as Record<string, unknown>) ?? {}),
      false,
    );
    assert.equal(
      'project_unknown' in
        (((
          baselineRuntimeConfig.projects as Record<
            string,
            Record<string, unknown>
          >
        )?.['/shared'] as Record<string, unknown>) ?? {}),
      false,
    );
    assert.deepEqual(
      toRuntimeConfigSnapshot(flowFlags.at(-1) as Record<string, unknown>),
      baselineRuntimeConfig,
    );
    assert.deepEqual(
      toRuntimeConfigSnapshot(mcpFlags.at(-1) as Record<string, unknown>),
      baselineRuntimeConfig,
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

test('T18 invalid-type policy hard-fails across REST, flow, and MCP surfaces and emits error log', async () => {
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
