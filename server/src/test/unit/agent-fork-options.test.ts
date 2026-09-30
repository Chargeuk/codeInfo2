import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  __resetAgentAvailabilityDepsForTests,
  __setAgentAvailabilityDepsForTests,
} from '../../agents/availability.js';
import {
  forkAgentConversation,
  getForkOptions,
  type ForkOptionsDeps,
} from '../../agents/forkService.js';
import {
  __resetAgentServiceDepsForTests,
  __setAgentServiceDepsForTests,
  createAgentForkOptionsPreparation,
  prepareAgentForkTarget,
} from '../../agents/service.js';
import { resolveCodexCapabilities } from '../../codex/capabilityResolver.js';
import type { AgentProviderFallbackOrderResolution } from '../../config/startupEnv.js';
import type { Conversation } from '../../mongo/conversation.js';
import { ForkOperationModel } from '../../mongo/forkOperation.js';
import type { TurnSummary } from '../../mongo/repo.js';
import { startExternalOpenAiCompatServer } from '../support/externalOpenAiCompatServer.js';
import {
  clearScopedTestEnvValue,
  setScopedTestEnvValue,
} from '../support/processEnvIsolation.js';
import { withIsolatedProviderHomeTestEnv } from '../support/providerHomeHarness.js';

async function withCatalog(
  run: (catalog: {
    agentsHome: string;
    workingFolder: string;
    addAgent: (name: string, provider: string, extra?: string) => Promise<void>;
    counts: {
      capabilities: number;
      mcp: number;
      copilot: number;
      lmstudio: number;
    };
    setCodexAvailable: (available: boolean) => void;
  }) => Promise<void>,
) {
  await withIsolatedProviderHomeTestEnv(
    { prefix: 'fork-options-' },
    async (homes) => {
      const agentsHome = path.join(homes.tempRoot, 'codeinfo_agents');
      const workingFolder = path.join(homes.tempRoot, 'source-working-folder');
      await fs.mkdir(workingFolder, { recursive: true });
      setScopedTestEnvValue('CODEINFO_AGENT_HOME', agentsHome);
      setScopedTestEnvValue('CODEINFO_CODEX_AGENT_HOME', agentsHome);
      setScopedTestEnvValue('CODEX_HOME', homes.codexHome);
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS');
      const counts = { capabilities: 0, mcp: 0, copilot: 0, lmstudio: 0 };
      let codexAvailable = true;
      const getCodexDetection = () => ({
        available: codexAvailable,
        authPresent: true,
        configPresent: true,
      });
      const getMcpStatus = async () => {
        counts.mcp++;
        return { available: true };
      };
      const resolveCopilotReadiness = async () => {
        counts.copilot++;
        return {
          available: true,
          toolsAvailable: true,
          blockingStage: 'ready' as const,
          models: ['copilot-gpt-5'],
          modelsRaw: [],
          authSource: 'sdk-status' as const,
        };
      };
      const lmstudioClientFactory = () =>
        ({
          system: {
            listDownloadedModels: async () => {
              counts.lmstudio++;
              return [{ modelKey: 'model-1', type: 'llm' }];
            },
          },
        }) as never;
      const resolveAgentProviderFallbackOrder =
        (): AgentProviderFallbackOrderResolution => ({
          normalizedProviders: ['codex', 'copilot', 'lmstudio'],
          warnings: [],
          usedDefault: false,
        });
      const common = {
        getCodexDetection,
        getMcpStatus,
        resolveCopilotReadiness,
        lmstudioClientFactory,
        getLmStudioBaseUrl: () => 'http://127.0.0.1:1234',
        resolveAgentProviderFallbackOrder,
      };
      __setAgentAvailabilityDepsForTests(common);
      __setAgentServiceDepsForTests({
        ...common,
        resolveCodexCapabilities: async (options) => {
          counts.capabilities++;
          return resolveCodexCapabilities({
            ...options,
            codexHome: homes.codexHome,
          });
        },
      });
      try {
        await run({
          agentsHome,
          workingFolder,
          counts,
          setCodexAvailable: (available) => {
            codexAvailable = available;
          },
          addAgent: async (name, provider, extra = '') => {
            const home = path.join(agentsHome, name);
            await fs.mkdir(home, { recursive: true });
            await fs.writeFile(
              path.join(home, 'config.toml'),
              [
                `codeinfo_provider = "${provider}"`,
                `model = "${provider === 'copilot' ? 'copilot-gpt-5' : 'gpt-5.6-luna'}"`,
                extra,
              ].join('\n'),
            );
            await fs.writeFile(
              path.join(home, 'system_prompt.txt'),
              `Prompt for ${name}`,
            );
          },
        });
      } finally {
        __resetAgentServiceDepsForTests();
        __resetAgentAvailabilityDepsForTests();
      }
    },
  );
}

function optionsFixture(
  workingFolder: string,
  endpointId?: string,
  provider: 'codex' | 'copilot' = 'codex',
) {
  const source: Conversation = {
    _id: crypto.randomUUID(),
    provider,
    agentName: 'agent-00',
    model: provider === 'copilot' ? 'copilot-gpt-5' : 'gpt-5.6-luna',
    title: 'Source title',
    flags: {
      workingFolder,
      threadId: 'source-native',
      ...(endpointId ? { endpointId } : {}),
    },
    source: 'REST',
    archivedAt: null,
    createdAt: new Date(1),
    updatedAt: new Date(2),
    lastMessageAt: new Date(2),
  };
  const rows: TurnSummary[] = [
    {
      turnId: 'prompt',
      conversationId: source._id,
      role: 'user',
      content: 'Question',
      status: 'ok',
      model: source.model,
      provider: source.provider,
      source: 'REST',
      toolCalls: null,
      createdAt: new Date(1),
    },
    {
      turnId: 'answer',
      conversationId: source._id,
      role: 'assistant',
      content: 'Answer',
      status: 'ok',
      model: source.model,
      provider: source.provider,
      source: 'REST',
      toolCalls: null,
      createdAt: new Date(2),
      native: { sessionId: 'source-native', turnId: 'native-turn' },
    },
  ];
  const prepared: Array<
    Awaited<
      ReturnType<
        Awaited<
          ReturnType<typeof createAgentForkOptionsPreparation>
        >['prepareTarget']
      >
    >
  > = [];
  let nativeForks = 0;
  const deps: ForkOptionsDeps = {
    loadSource: async () => source,
    listTurns: async () => ({ items: rows.slice().reverse() }),
    openNative: async () => ({
      turns: [
        {
          id: 'native-turn',
          completed: true,
          user: 'Question',
          assistant: 'Answer',
        },
      ],
      fork: async () => {
        nativeForks++;
        return 'child';
      },
      close: async () => {},
      inject: async () => {},
      remove: async () => {},
      hasInjected: async () => false,
    }),
    prepareOptions: async (folder) => {
      assert.equal(folder, workingFolder);
      const preparation = await createAgentForkOptionsPreparation(folder);
      return {
        ...preparation,
        prepareTarget: async (agentName: string, sourceProvider?: string) => {
          const target = await preparation.prepareTarget(
            agentName,
            sourceProvider,
          );
          prepared.push(target);
          return target;
        },
      };
    },
  };
  return { source, deps, prepared, nativeForks: () => nativeForks };
}

test('fork options share one readiness/model snapshot across a large same-provider catalog and preserve order/folder/config', async () => {
  await withCatalog(async ({ addAgent, workingFolder, counts }) => {
    const names = Array.from(
      { length: 40 },
      (_, index) => `agent-${String(index).padStart(2, '0')}`,
    );
    for (const name of names)
      await addAgent(
        name,
        'codex',
        '[mcp_servers.target_tool]\ncommand = "target-tool"',
      );
    await addAgent('other-provider', 'copilot');
    await addAgent('invalid-provider', 'invalid');
    const h = optionsFixture(workingFolder);
    const sourceBefore = structuredClone(h.source);
    const result = await getForkOptions(h.source._id, 'answer', h.deps);
    assert.deepEqual(
      result.agents,
      names.map((name) => ({ name, sameAgent: name === 'agent-00' })),
    );
    assert.deepEqual(counts, {
      capabilities: 1,
      mcp: 1,
      copilot: 1,
      lmstudio: 1,
    });
    assert.equal(h.prepared.length, names.length);
    for (const target of h.prepared) {
      assert.equal(target.workingDirectoryOverride, workingFolder);
      const config = target.runtimeConfig as {
        mcp_servers?: Record<string, { command?: string }>;
      };
      assert.equal(config.mcp_servers?.target_tool?.command, 'target-tool');
    }
    assert.equal(h.nativeForks(), 0);
    assert.deepEqual(h.source, sourceBefore);
  });
});

test('explicit incompatible providers are filtered before readiness work', async () => {
  await withCatalog(async ({ addAgent, workingFolder, counts }) => {
    for (let index = 0; index < 15; index++)
      await addAgent(`copilot-${index}`, 'copilot');
    const h = optionsFixture(workingFolder);
    assert.deepEqual(
      (await getForkOptions(h.source._id, 'answer', h.deps)).agents,
      [],
    );
    assert.deepEqual(counts, {
      capabilities: 0,
      mcp: 0,
      copilot: 0,
      lmstudio: 0,
    });
  });
});

test('legacy source provider resolution shares the options snapshot without backfilling source history', async () => {
  await withCatalog(async ({ addAgent, workingFolder, counts }) => {
    await addAgent('agent-00', 'codex');
    await addAgent('agent-01', 'codex');
    const h = optionsFixture(workingFolder);
    delete (h.source as Partial<Conversation>).provider;
    const sourceBefore = structuredClone(h.source);
    assert.equal(
      (await getForkOptions(h.source._id, 'answer', h.deps)).agents.length,
      2,
    );
    assert.deepEqual(counts, {
      capabilities: 1,
      mcp: 1,
      copilot: 1,
      lmstudio: 1,
    });
    assert.deepEqual(h.source, sourceBefore);
  });
});

test('Copilot options retain compatible and unspecified-provider agents but never a Codex fallback', async () => {
  await withCatalog(
    async ({
      addAgent,
      agentsHome,
      workingFolder,
      setCodexAvailable,
      counts,
    }) => {
      setCodexAvailable(false);
      await addAgent('agent-00', 'copilot');
      await addAgent('agent-01', 'copilot');
      await fs.writeFile(
        path.join(agentsHome, 'agent-01', 'config.toml'),
        'model = "copilot-gpt-5"\n',
      );
      await addAgent('agent-02', 'codex');
      const h = optionsFixture(workingFolder, undefined, 'copilot');
      assert.deepEqual(
        (await getForkOptions(h.source._id, 'answer', h.deps)).agents.map(
          (agent) => agent.name,
        ),
        ['agent-00', 'agent-01'],
      );
      assert.deepEqual(counts, {
        capabilities: 1,
        mcp: 1,
        copilot: 1,
        lmstudio: 1,
      });
    },
  );
});

test('unavailable native providers are excluded even when a fallback provider is available', async () => {
  await withCatalog(
    async ({ addAgent, workingFolder, setCodexAvailable, counts }) => {
      await addAgent('agent-00', 'codex');
      setCodexAvailable(false);
      const h = optionsFixture(workingFolder);
      assert.deepEqual(
        (await getForkOptions(h.source._id, 'answer', h.deps)).agents,
        [],
      );
      assert.equal(counts.copilot, 1);
    },
  );
});

async function assertCreationRevalidates(
  t: TestContext,
  h: ReturnType<typeof optionsFixture>,
  targetAgentName: string,
  code: string,
) {
  t.mock.method(ForkOperationModel, 'findById', () => ({
    lean: () => ({ exec: async () => null }),
  }));
  await assert.rejects(
    forkAgentConversation(
      {
        sourceConversationId: h.source._id,
        sourceTurnId: 'answer',
        targetAgentName,
        requestId: crypto.randomUUID(),
      },
      {
        loadSource: h.deps.loadSource,
        listTurns: h.deps.listTurns,
        openNative: h.deps.openNative,
        prepareTarget: prepareAgentForkTarget,
      },
    ),
    (error: unknown) => (error as { code?: string }).code === code,
  );
  assert.equal(h.nativeForks(), 0);
}

test('creation revalidates selected target readiness instead of retaining the options snapshot', async (t) => {
  await withCatalog(
    async ({ addAgent, workingFolder, setCodexAvailable, counts }) => {
      await addAgent('agent-00', 'codex');
      const h = optionsFixture(workingFolder);
      assert.equal(
        (await getForkOptions(h.source._id, 'answer', h.deps)).agents.length,
        1,
      );
      setCodexAvailable(false);
      await assertCreationRevalidates(t, h, 'agent-00', 'PROVIDER_UNAVAILABLE');
      assert.equal(counts.capabilities, 2);
    },
  );
});

test('creation rereads the selected target provider after the options request', async (t) => {
  await withCatalog(async ({ addAgent, workingFolder, counts }) => {
    await addAgent('agent-00', 'codex');
    const h = optionsFixture(workingFolder);
    assert.equal(
      (await getForkOptions(h.source._id, 'answer', h.deps)).agents.length,
      1,
    );
    await addAgent('agent-00', 'copilot');
    await assertCreationRevalidates(t, h, 'agent-00', 'FORK_UNSUPPORTED');
    assert.equal(counts.capabilities, 2);
  });
});

test('options share endpoint discovery by definition, filter native/different endpoints, and creation probes afresh', async (t) => {
  const first = await startExternalOpenAiCompatServer({
    models: ['gpt-5.6-luna'],
    modelResponses: [{}, { body: { object: 'list', data: [] } }],
  });
  let second:
    | Awaited<ReturnType<typeof startExternalOpenAiCompatServer>>
    | undefined;
  try {
    const other = await startExternalOpenAiCompatServer({
      models: ['gpt-5.6-luna'],
    });
    second = other;
    await withCatalog(async ({ addAgent, workingFolder, counts }) => {
      const endpoint = `${first.baseUrl}/v1`;
      await addAgent(
        'agent-00',
        'codex',
        `codeinfo_openai_endpoint = "${endpoint}|responses"`,
      );
      await addAgent(
        'agent-01',
        'codex',
        `codeinfo_openai_endpoint = "${endpoint}|responses"`,
      );
      await addAgent(
        'agent-02',
        'codex',
        `codeinfo_openai_endpoint = "${other.baseUrl}/v1|responses"`,
      );
      await addAgent('agent-03', 'codex');
      const h = optionsFixture(workingFolder, endpoint);
      assert.deepEqual(
        (await getForkOptions(h.source._id, 'answer', h.deps)).agents.map(
          (agent) => agent.name,
        ),
        ['agent-00', 'agent-01'],
      );
      assert.equal(first.requestCount(), 1);
      assert.equal(other.requestCount(), 1);
      assert.equal(counts.copilot, 1);
      await assertCreationRevalidates(t, h, 'agent-00', 'FORK_UNSUPPORTED');
      assert.equal(first.requestCount(), 2);
      assert.equal(h.source.flags.endpointId, endpoint);
    });
  } finally {
    await first.stop();
    await second?.stop();
  }
});

test('the same endpoint ID with different capabilities gets separate discovery snapshots', async () => {
  const endpoint = await startExternalOpenAiCompatServer({
    models: ['gpt-5.6-luna'],
  });
  try {
    await withCatalog(async ({ addAgent, workingFolder, counts }) => {
      for (const name of ['agent-00', 'agent-01'])
        await addAgent(
          name,
          'codex',
          `codeinfo_openai_endpoint = "${endpoint.baseUrl}/v1|responses"`,
        );
      await addAgent(
        'agent-02',
        'codex',
        `codeinfo_openai_endpoint = "${endpoint.baseUrl}/v1|responses,completions"`,
      );
      const h = optionsFixture(workingFolder, `${endpoint.baseUrl}/v1`);
      assert.equal(
        (await getForkOptions(h.source._id, 'answer', h.deps)).agents.length,
        3,
      );
      assert.equal(endpoint.requestCount(), 2);
      assert.equal(counts.copilot, 1);
    });
  } finally {
    await endpoint.stop();
  }
});
