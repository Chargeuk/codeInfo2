import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { ThreadOptions as CodexThreadOptions } from '@openai/codex-sdk';

import {
  readAgentRequestedProviderMetadata,
  resolveAgentRuntimeExecutionConfig,
} from '../../agents/config.js';
import { getActiveRunOwnership } from '../../agents/runLock.js';
import {
  startAgentInstruction,
} from '../../agents/service.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import { ChatInterfaceCodex } from '../../chat/interfaces/ChatInterfaceCodex.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { normalizeRuntimeConfig } from '../../config/runtimeConfig.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { runWithTestEnvOverrides } from '../support/testEnvOverrideScope.js';
import { runWithTestOverrides } from '../support/testOverrideScope.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';

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

class CapturingImmediateChat extends ChatInterface {
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
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  const started = Date.now();
  while (Date.now() - started < resolvedTimeoutMs) {
    if (predicate()) return;
    await delay(25);
  }
  throw new Error(`Timed out waiting for condition after ${resolvedTimeoutMs}ms`);
};

describe('Agent config defaults', () => {
  it('normalizes features.view_image_tool alias to canonical output only', () => {
    const normalized = normalizeRuntimeConfig({
      features: { view_image_tool: true, keep_this: true },
    });

    assert.deepEqual(normalized.tools, { view_image: true });
    assert.deepEqual(normalized.features, { keep_this: true });
    assert.equal(
      (normalized.features as Record<string, unknown>).view_image_tool,
      undefined,
    );
  });

  it('normalizes features.web_search_request alias to canonical web_search output', () => {
    const normalized = normalizeRuntimeConfig({
      features: { web_search_request: false, keep_this: true },
    });

    assert.equal(normalized.web_search, 'disabled');
    assert.deepEqual(normalized.features, { keep_this: true });
    assert.equal(
      (normalized.features as Record<string, unknown>).web_search_request,
      undefined,
    );
  });

  it('keeps canonical keys when canonical and alias keys conflict', () => {
    const normalized = normalizeRuntimeConfig({
      web_search: 'cached',
      tools: { view_image: true },
      features: { web_search_request: false, view_image_tool: false },
    });

    assert.equal(normalized.web_search, 'cached');
    assert.deepEqual(normalized.tools, { view_image: true });
    assert.equal(
      (normalized.features as Record<string, unknown>)?.web_search_request,
      undefined,
    );
    assert.equal(
      (normalized.features as Record<string, unknown>)?.view_image_tool,
      undefined,
    );
  });

  it('resolves model from shared runtime config resolver', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
    const configPath = path.join(tmp, 'config.toml');

    await fs.writeFile(
      configPath,
      'model = "gpt-5.2"\nmodel_reasoning_effort = "high"\n',
      'utf8',
    );

    const resolved = await resolveAgentRuntimeExecutionConfig({
      configPath,
      entrypoint: 'agents.service',
    });

    assert.equal(resolved.modelId, 'gpt-5.2');
    assert.equal(resolved.providerId, 'codex');
  });

  it('defaults a missing codeinfo_provider to codex', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
    const configPath = path.join(tmp, 'config.toml');

    await fs.writeFile(configPath, 'model = "gpt-5.2"\n', 'utf8');

    const resolved = await resolveAgentRuntimeExecutionConfig({
      configPath,
      entrypoint: 'agents.service',
    });

    assert.equal(resolved.providerId, 'codex');
    assert.equal(resolved.requestedProviderId, undefined);
  });

  it('defaults a blank codeinfo_provider to codex', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
    const configPath = path.join(tmp, 'config.toml');

    await fs.writeFile(
      configPath,
      'model = "gpt-5.2"\ncodeinfo_provider = ""\n',
      'utf8',
    );

    const resolved = await resolveAgentRuntimeExecutionConfig({
      configPath,
      entrypoint: 'agents.service',
    });

    assert.equal(resolved.providerId, 'codex');
    assert.equal(resolved.requestedProviderId, undefined);
  });

  it('defaults a whitespace-only codeinfo_provider to codex', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
    const configPath = path.join(tmp, 'config.toml');

    await fs.writeFile(
      configPath,
      'model = "gpt-5.2"\ncodeinfo_provider = "   "\n',
      'utf8',
    );

    const resolved = await resolveAgentRuntimeExecutionConfig({
      configPath,
      entrypoint: 'agents.service',
    });

    assert.equal(resolved.providerId, 'codex');
    assert.equal(resolved.requestedProviderId, undefined);
  });

  it('preserves an invalid non-blank codeinfo_provider for later warning evaluation', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
    const configPath = path.join(tmp, 'config.toml');

    await fs.writeFile(
      configPath,
      'model = "gpt-5.2"\ncodeinfo_provider = "not-a-provider"\n',
      'utf8',
    );

    const resolved = await resolveAgentRuntimeExecutionConfig({
      configPath,
      entrypoint: 'agents.service',
    });

    assert.equal(resolved.providerId, 'codex');
    assert.equal(resolved.requestedProviderId, 'not-a-provider');
  });

  it('extracts unsupported codeinfo_provider metadata without resolving provider runtime config', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
    const configPath = path.join(tmp, 'config.toml');

    await fs.writeFile(
      configPath,
      'model = "gpt-5.2"\ncodeinfo_provider = "not-a-provider"\n',
      'utf8',
    );

    const metadata = await readAgentRequestedProviderMetadata({ configPath });

    assert.equal(metadata.providerId, 'codex');
    assert.equal(metadata.requestedProviderId, 'not-a-provider');
    assert.deepEqual(metadata.warnings, []);
  });

  it('fails immediately when agent config metadata cannot be parsed as TOML', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
    const configPath = path.join(tmp, 'config.toml');

    await fs.writeFile(configPath, 'approval_policy = [\n', 'utf8');

    await assert.rejects(() =>
      readAgentRequestedProviderMetadata({
        configPath,
      }),
    );
  });

  it('reads valid requested-provider metadata without requiring provider config homes to exist', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
    const configPath = path.join(tmp, 'config.toml');

    await fs.writeFile(
      configPath,
      'codeinfo_provider = "copilot"\nmodel = "copilot-gpt-5"\n',
      'utf8',
    );

    await runWithTestEnvOverrides(
      {
        CODEINFO_CODEX_HOME: undefined,
        CODEINFO_COPILOT_HOME: undefined,
        CODEINFO_LMSTUDIO_HOME: undefined,
      },
      async () => {
      const metadata = await readAgentRequestedProviderMetadata({ configPath });
      assert.equal(metadata.providerId, 'copilot');
      assert.equal(metadata.requestedProviderId, 'copilot');
      },
    );
  });

  it('normalizes and preserves codeinfo_openai_endpoint on the accepted agent config path', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-endpoint-'));
    const agentsHome = path.join(tmp, 'agents');
    const agentHome = path.join(agentsHome, 'coding_agent');
    const copilotHome = path.join(tmp, 'copilot-home');
    const configPath = path.join(agentHome, 'config.toml');

    await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
    await fs.writeFile(
      path.join(copilotHome, 'chat', 'config.toml'),
      'model = "copilot-model"\n',
      'utf8',
    );
    await fs.writeFile(
      configPath,
      [
        'codeinfo_provider = "copilot"',
        'codeinfo_openai_endpoint = " https://LOCALHOST:1234/v1/ | RESPONSES, completions, responses "',
        'model = "copilot-model"',
        '',
      ].join('\n'),
      'utf8',
    );

    try {
      const resolved = await runWithTestEnvOverrides(
        { CODEINFO_COPILOT_HOME: copilotHome },
        async () =>
          await resolveAgentRuntimeExecutionConfig({
            configPath,
            entrypoint: 'agents.service',
          }),
      );

      assert.equal(resolved.providerId, 'copilot');
      assert.equal(resolved.requestedProviderId, 'copilot');
      assert.equal(
        resolved.appMetadata?.codeinfoOpenAiEndpoint?.endpointId,
        'https://localhost:1234/v1',
      );
      assert.deepEqual(
        resolved.appMetadata?.codeinfoOpenAiEndpoint?.capabilities,
        ['responses', 'completions'],
      );
      assert.equal('codeinfo_openai_endpoint' in resolved.runtimeConfig, false);
      assert.equal(resolved.modelId, 'copilot-model');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('rejects blank codeinfo_openai_endpoint values in agent configs', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-endpoint-blank-'));
    const agentHome = path.join(tmp, 'agents', 'coding_agent');
    const configPath = path.join(agentHome, 'config.toml');
    const codexHome = path.join(tmp, 'codex-home');

    await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
    await fs.writeFile(path.join(codexHome, 'chat', 'config.toml'), '', 'utf8');
    await fs.writeFile(
      configPath,
      ['codeinfo_provider = "codex"', 'codeinfo_openai_endpoint = ""', ''].join(
        '\n',
      ),
      'utf8',
    );

    try {
      await assert.rejects(
        async () =>
          resolveAgentRuntimeExecutionConfig({
            configPath,
            entrypoint: 'agents.service',
            codexHome,
          }),
        (error) => {
          const typed = error as Error & { code?: string; surface?: string };
          return (
            typed.code === 'RUNTIME_CONFIG_INVALID' &&
            typed.surface === 'agent' &&
            typed.message.includes('codeinfo_openai_endpoint') &&
            typed.message.includes(
              'expected an explicit http or https /v1 base URL',
            )
          );
        },
      );
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('rejects whitespace-only codeinfo_openai_endpoint values in agent configs', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-endpoint-space-'));
    const agentHome = path.join(tmp, 'agents', 'coding_agent');
    const configPath = path.join(agentHome, 'config.toml');
    const codexHome = path.join(tmp, 'codex-home');

    await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
    await fs.writeFile(path.join(codexHome, 'chat', 'config.toml'), '', 'utf8');
    await fs.writeFile(
      configPath,
      [
        'codeinfo_provider = "codex"',
        'codeinfo_openai_endpoint = "   "',
        '',
      ].join('\n'),
      'utf8',
    );

    try {
      await assert.rejects(
        async () =>
          resolveAgentRuntimeExecutionConfig({
            configPath,
            entrypoint: 'agents.service',
            codexHome,
          }),
        (error) => {
          const typed = error as Error & { code?: string; surface?: string };
          return (
            typed.code === 'RUNTIME_CONFIG_INVALID' &&
            typed.surface === 'agent' &&
            typed.message.includes('codeinfo_openai_endpoint') &&
            typed.message.includes(
              'expected an explicit http or https /v1 base URL',
            )
          );
        },
      );
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('preserves the Codex responses requirement when agent configs target incompatible endpoints', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-endpoint-codex-compat-'));
    const agentHome = path.join(tmp, 'agents', 'coding_agent');
    const configPath = path.join(agentHome, 'config.toml');
    const codexHome = path.join(tmp, 'codex-home');

    await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
    await fs.writeFile(path.join(codexHome, 'chat', 'config.toml'), '', 'utf8');
    await fs.writeFile(
      configPath,
      [
        'codeinfo_provider = "codex"',
        'codeinfo_openai_endpoint = "https://example.com/v1|completions"',
        'model = "codex-model"',
        '',
      ].join('\n'),
      'utf8',
    );

    try {
      await assert.rejects(
        async () =>
          resolveAgentRuntimeExecutionConfig({
            configPath,
            entrypoint: 'agents.service',
            codexHome,
          }),
        (error) => {
          const typed = error as Error & { code?: string; surface?: string };
          return (
            typed.code === 'RUNTIME_CONFIG_VALIDATION_FAILED' &&
            typed.surface === 'agent' &&
            typed.message.includes(
              'Codex requires responses support on codeinfo_openai_endpoint',
            )
          );
        },
      );
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('preserves the Copilot completions requirement when agent configs target incompatible endpoints', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-endpoint-copilot-compat-'));
    const agentHome = path.join(tmp, 'agents', 'coding_agent');
    const configPath = path.join(agentHome, 'config.toml');
    const copilotHome = path.join(tmp, 'copilot-home');

    await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
    await fs.writeFile(path.join(copilotHome, 'chat', 'config.toml'), '', 'utf8');
    await fs.writeFile(
      configPath,
      [
        'codeinfo_provider = "copilot"',
        'codeinfo_openai_endpoint = "https://example.com/v1|responses"',
        'model = "copilot-model"',
        '',
      ].join('\n'),
      'utf8',
    );
    try {
      await runWithTestEnvOverrides(
        { CODEINFO_COPILOT_HOME: copilotHome },
        async () =>
          await assert.rejects(
            async () =>
              resolveAgentRuntimeExecutionConfig({
                configPath,
                entrypoint: 'agents.service',
              }),
        (error) => {
          const typed = error as Error & { code?: string; surface?: string };
          return (
            typed.code === 'RUNTIME_CONFIG_VALIDATION_FAILED' &&
            typed.surface === 'agent' &&
            typed.message.includes(
              'Copilot requires completions support on codeinfo_openai_endpoint',
            )
          );
          },
        ),
      );
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('emits deterministic T05 success log when runtime execution config resolves', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
    const configPath = path.join(tmp, 'config.toml');

    await fs.writeFile(configPath, 'model = "gpt-5.2"\n', 'utf8');

    const originalInfo = console.info;
    const logs: string[] = [];
    console.info = (...args: unknown[]) => {
      logs.push(String(args[0] ?? ''));
    };

    try {
      await resolveAgentRuntimeExecutionConfig({
        configPath,
        entrypoint: 'agents.service',
      });
    } finally {
      console.info = originalInfo;
    }

    assert.equal(
      logs.some((line) =>
        line.includes(
          '[DEV-0000037][T05] event=shared_runtime_resolver_used_by_entrypoints result=success',
        ),
      ),
      true,
    );
  });

  it('emits deterministic T05 error log when runtime execution config resolution fails', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
    const configPath = path.join(tmp, 'config.toml');

    await fs.writeFile(configPath, 'approval_policy = 1\n', 'utf8');

    const originalError = console.error;
    const logs: string[] = [];
    console.error = (...args: unknown[]) => {
      logs.push(String(args[0] ?? ''));
    };

    try {
      await assert.rejects(async () => {
        await resolveAgentRuntimeExecutionConfig({
          configPath,
          entrypoint: 'flows.service',
        });
      });
    } finally {
      console.error = originalError;
    }

    assert.equal(
      logs.some((line) =>
        line.includes(
          '[DEV-0000037][T05] event=shared_runtime_resolver_used_by_entrypoints result=error',
        ),
      ),
      true,
    );
  });

  it('validates every checked-in codeinfo_agents/*/config.toml fixture through deterministic normalization pipeline', async () => {
    const repoRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../../',
    );
    const agentsRoot = path.join(repoRoot, 'codeinfo_agents');
    const entries = await fs.readdir(agentsRoot, { withFileTypes: true });
    const configPaths = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(agentsRoot, entry.name, 'config.toml'))
      .sort();

    assert.equal(configPaths.length > 0, true);

    for (const configPath of configPaths) {
      const first = await resolveAgentRuntimeExecutionConfig({
        configPath,
        entrypoint: 'agents.service',
      });
      const second = await resolveAgentRuntimeExecutionConfig({
        configPath,
        entrypoint: 'agents.service',
      });

      assert.equal(typeof first.modelId, 'string');
      assert.equal((first.modelId ?? '').length > 0, true);
      assert.deepEqual(first.runtimeConfig, second.runtimeConfig);
      assert.equal(first.modelId, second.modelId);
    }
  });

  it('omits config-owned ThreadOptions when useConfigDefaults is enabled', async () => {
    setCodexDetection({
      available: true,
      authPresent: true,
      configPresent: true,
    });

    const captured: {
      start?: CodexThreadOptions;
      resume?: CodexThreadOptions;
    } = {};

    const events = async function* () {
      yield { type: 'thread.started', thread_id: 'tid-1' };
      yield {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'ok' },
      };
      yield { type: 'turn.completed' };
    };

    const thread = {
      id: 'tid-1',
      runStreamed: async () => ({ events: events() }),
    };

    const chat = new ChatInterfaceCodex(() => ({
      startThread: (opts?: CodexThreadOptions) => {
        captured.start = opts;
        return thread;
      },
      resumeThread: (id: string, opts?: CodexThreadOptions) => {
        void id;
        captured.resume = opts;
        return thread;
      },
    }));

    await runWithTestEnvOverrides(
      { CODEX_WORKDIR: '/tmp/codex-workdir' },
      async () => {
        await chat.run(
          'Hello',
          {
            threadId: null,
            useConfigDefaults: true,
            codexFlags: {
              sandboxMode: 'danger-full-access',
              approvalPolicy: 'never',
              modelReasoningEffort: 'high',
              networkAccessEnabled: false,
              webSearchEnabled: false,
            },
          },
          'conv-1',
          'gpt-5.1-codex-max',
        );
      },
    );

    assert(captured.start);
    assert.equal(captured.start.workingDirectory, '/tmp/codex-workdir');
    assert.equal(captured.start.skipGitRepoCheck, true);

    assert.equal('model' in captured.start, false);
    assert.equal('sandboxMode' in captured.start, false);
    assert.equal('approvalPolicy' in captured.start, false);
    assert.equal('modelReasoningEffort' in captured.start, false);
    assert.equal('networkAccessEnabled' in captured.start, false);
    assert.equal('webSearchEnabled' in captured.start, false);
  });

  it('repairs an unavailable codex model before considering cross-provider fallback', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
    const agentsHome = path.join(tempRoot, 'agents');
    const agentHome = path.join(agentsHome, 'coding_agent');
    const codexHome = path.join(tempRoot, 'codex-home');
    await fs.mkdir(path.join(agentHome), { recursive: true });
    await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
    await fs.writeFile(
      path.join(agentHome, 'config.toml'),
      'codeinfo_provider = "codex"\nmodel = "missing-codex-model"\napproval_policy = "never"\n',
      'utf8',
    );
    await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
    await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
    await fs.writeFile(
      path.join(codexHome, 'chat', 'config.toml'),
      'model = "codex-repaired"\n',
      'utf8',
    );

    try {
      const started = await runWithTestOverrides(
        {
          codexDetection: {
            available: true,
            authPresent: true,
            configPresent: true,
          },
          envOverrides: {
            CODEINFO_AGENT_HOME: agentsHome,
            CODEINFO_CODEX_HOME: codexHome,
            CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER: 'copilot,codex',
          },
          agentServiceDeps: {
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
          },
        },
        async () =>
          await startAgentInstruction({
            agentName: 'coding_agent',
            instruction: 'Hello',
            source: 'REST',
            chatFactory: () => new ImmediateChat(),
          }),
      );

      assert.equal(started.providerId, 'codex');
      assert.equal(started.modelId, 'codex-repaired');
      const conversation = memoryConversations.get(started.conversationId);
      assert.equal(conversation?.provider, 'codex');
      assert.equal(conversation?.model, 'codex-repaired');
    } finally {
      memoryConversations.clear();
      memoryTurns.clear();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('closes temporary LM Studio discovery clients after collecting direct-agent provider states', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
    const agentsHome = path.join(tempRoot, 'agents');
    const agentHome = path.join(agentsHome, 'coding_agent');
    const codexHome = path.join(tempRoot, 'codex-home');
    await fs.mkdir(path.join(agentHome), { recursive: true });
    await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
    await fs.writeFile(
      path.join(agentHome, 'config.toml'),
      'codeinfo_provider = "codex"\nmodel = "codex-model"\napproval_policy = "never"\n',
      'utf8',
    );
    await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
    await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
    await fs.writeFile(
      path.join(codexHome, 'chat', 'config.toml'),
      'model = "codex-model"\n',
      'utf8',
    );

    let closeCalls = 0;

    try {
      const started = await runWithTestOverrides(
        {
          envOverrides: {
            CODEINFO_AGENT_HOME: agentsHome,
            CODEINFO_CODEX_HOME: codexHome,
          },
          agentServiceDeps: {
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
              modelsRaw: [],
              authSource: 'env-token',
            }),
            getLmStudioBaseUrl: () => 'http://127.0.0.1:1234',
            lmstudioClientFactory: () =>
              ({
                system: {
                  listDownloadedModels: async () => [
                    { modelKey: 'lmstudio-test' },
                  ],
                },
                close: async () => {
                  closeCalls += 1;
                },
              }) as never,
          },
        },
        async () =>
          await startAgentInstruction({
            agentName: 'coding_agent',
            instruction: 'Hello',
            source: 'REST',
            chatFactory: () => new ImmediateChat(),
          }),
      );

      assert.equal(started.providerId, 'codex');
      assert.equal(closeCalls, 1);
    } finally {
      memoryConversations.clear();
      memoryTurns.clear();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('honors CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER when invalid-provider fallback chooses an execution provider', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
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

    try {
      const started = await runWithTestOverrides(
        {
          codexDetection: {
            available: true,
            authPresent: true,
            configPresent: true,
          },
          envOverrides: {
            CODEINFO_AGENT_HOME: agentsHome,
            CODEINFO_CODEX_HOME: codexHome,
            CODEINFO_COPILOT_HOME: copilotHome,
            CODEINFO_AGENT_PROVIDER_FALLBACK_ORDER: 'copilot,codex',
          },
          agentServiceDeps: {
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
          },
        },
        async () =>
          await startAgentInstruction({
            agentName: 'coding_agent',
            instruction: 'Hello',
            source: 'REST',
            chatFactory: () => new ImmediateChat(),
          }),
      );

      assert.equal(started.providerId, 'copilot');
      assert.equal(started.modelId, 'copilot-model');
      const conversation = memoryConversations.get(started.conversationId);
      assert.equal(conversation?.provider, 'copilot');
      assert.equal(conversation?.model, 'copilot-model');
    } finally {
      memoryConversations.clear();
      memoryTurns.clear();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('creates the first direct Copilot agent run before resuming later turns on the same conversation', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
    const agentsHome = path.join(tempRoot, 'agents');
    const agentHome = path.join(agentsHome, 'coding_agent');
    const codexHome = path.join(tempRoot, 'codex-home');
    const copilotHome = path.join(tempRoot, 'copilot-home');
    const capturedFlags: Array<Record<string, unknown>> = [];

    await fs.mkdir(agentHome, { recursive: true });
    await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
    await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
    await fs.writeFile(
      path.join(agentHome, 'config.toml'),
      'codeinfo_provider = "copilot"\nmodel = "copilot-model"\n',
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

    try {
      const conversationId = 'copilot-first-run-create-then-resume';

      await runWithTestOverrides(
        {
          envOverrides: {
            CODEINFO_AGENT_HOME: agentsHome,
            CODEINFO_CODEX_HOME: codexHome,
            CODEINFO_COPILOT_HOME: copilotHome,
          },
          agentServiceDeps: {
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
          },
        },
        async () => {
          await startAgentInstruction({
            agentName: 'coding_agent',
            instruction: 'Hello once',
            conversationId,
            source: 'REST',
            chatFactory: () =>
              new CapturingImmediateChat((flags) => {
                capturedFlags.push(flags);
              }),
          });
      await waitFor(
        () =>
          capturedFlags.length === 1 &&
          getActiveRunOwnership(conversationId) === null,
        5000,
      );

          await startAgentInstruction({
            agentName: 'coding_agent',
            instruction: 'Hello twice',
            conversationId,
            source: 'REST',
            chatFactory: () =>
              new CapturingImmediateChat((flags) => {
                capturedFlags.push(flags);
              }),
          });

          await waitFor(() => capturedFlags.length === 2, 5000);
        },
      );
      assert.equal(capturedFlags.length, 2);
      assert.equal(capturedFlags[0]?.resumeConversation, false);
      assert.equal(capturedFlags[1]?.resumeConversation, true);
    } finally {
      memoryConversations.clear();
      memoryTurns.clear();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
