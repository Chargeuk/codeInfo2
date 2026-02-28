import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runAgentCommand, runAgentInstruction } from '../../agents/service.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import { resetStore } from '../../logStore.js';

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
