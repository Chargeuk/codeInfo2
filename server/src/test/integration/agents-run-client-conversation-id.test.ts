import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runAgentCommand, runAgentInstruction } from '../../agents/service.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { startFlowRun } from '../../flows/service.js';
import { resetStore } from '../../logStore.js';
import { callTool } from '../../mcpAgents/tools.js';

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
