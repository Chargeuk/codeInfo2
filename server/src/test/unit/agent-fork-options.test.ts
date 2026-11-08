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
                `model = "${provider === 'copilot' ? 'copilot-gpt-5' : 'gpt-6-luna'}"`,
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
    model: provider === 'copilot' ? 'copilot-gpt-5' : 'gpt-6-luna',
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
  const deps: ForkOptionsDeps = {
    loadSource: async () => source,
    listTurns: async () => ({ items: rows.slice().reverse() }),
    prepareOptions: async () => {
      const preparation = await createAgentForkOptionsPreparation();
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
  return { source, rows, deps, prepared };
}

test('Codex options list a large compatible catalog using config only, without provider/model readiness work', async () => {
  await withCatalog(async ({ addAgent, workingFolder, counts }) => {
    const names = Array.from(
      { length: 40 },
      (_, index) => `agent-${String(index).padStart(2, '0')}`,
    );
    for (const name of names) await addAgent(name, 'codex');
    await addAgent('other-provider', 'copilot');
    await addAgent('invalid-provider', 'invalid');
    const h = optionsFixture(workingFolder);
    const sourceBefore = structuredClone(h.source);
    h.deps.listTurns = async (id, selected, metadataOnly) => {
      assert.equal(id, h.source._id);
      assert.equal(selected, 'answer');
      assert.equal(metadataOnly, true);
      return { items: [h.rows[1]] };
    };
    const result = await getForkOptions(h.source._id, 'answer', h.deps);
    assert.deepEqual(
      result.agents,
      names.map((name) => ({ name, sameAgent: name === 'agent-00' })),
    );
    assert.deepEqual(counts, {
      capabilities: 0,
      mcp: 0,
      copilot: 0,
      lmstudio: 0,
    });
    assert.equal(result.sourceTurnId, 'answer');
    assert.equal(result.estimated, false);
    assert.equal(h.prepared.length, names.length);
    assert.deepEqual(h.source, sourceBefore);
  });
});

test('explicit incompatible providers are filtered without live readiness', async () => {
  await withCatalog(async ({ addAgent, workingFolder, counts }) => {
    await addAgent('other-provider', 'copilot');
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

test('legacy options retain missing IDs as estimated and use stored execution provider without backfilling or native access', async () => {
  await withCatalog(async ({ addAgent, workingFolder, counts }) => {
    await addAgent('agent-00', 'codex');
    const h = optionsFixture(workingFolder);
    delete (h.source as Partial<Conversation>).provider;
    delete h.rows[1].native;
    const before = structuredClone(h.rows);
    const result = await getForkOptions(h.source._id, undefined, h.deps);
    assert.equal(result.estimated, true);
    assert.equal(result.sourceTurnId, 'answer');
    assert.equal(result.agents.length, 1);
    assert.deepEqual(h.rows, before);
    assert.deepEqual(counts, {
      capabilities: 0,
      mcp: 0,
      copilot: 0,
      lmstudio: 0,
    });
  });
});

test('Copilot options retain compatible and unspecified-provider configs without falling back from explicit Codex', async () => {
  await withCatalog(async ({ addAgent, agentsHome, workingFolder, counts }) => {
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
      capabilities: 0,
      mcp: 0,
      copilot: 0,
      lmstudio: 0,
    });
  });
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
        openNative: async () => {
          throw new Error('Native fork must not be opened');
        },
        prepareTarget: prepareAgentForkTarget,
      },
    ),
    (error: unknown) => (error as { code?: string }).code === code,
  );
}

test('POST checks the selected target once and rejects unready Codex without probing a fallback', async (t) => {
  await withCatalog(
    async ({ addAgent, workingFolder, setCodexAvailable, counts }) => {
      await addAgent('agent-00', 'codex');
      const h = optionsFixture(workingFolder);
      setCodexAvailable(false);
      assert.equal(
        (await getForkOptions(h.source._id, 'answer', h.deps)).agents.length,
        1,
      );
      await assertCreationRevalidates(t, h, 'agent-00', 'PROVIDER_UNAVAILABLE');
      assert.deepEqual(counts, {
        capabilities: 1,
        mcp: 0,
        copilot: 0,
        lmstudio: 0,
      });
    },
  );
});

test('POST rereads selected target provider after options and refuses cross-provider execution', async (t) => {
  await withCatalog(async ({ addAgent, workingFolder, counts }) => {
    await addAgent('agent-00', 'codex');
    const h = optionsFixture(workingFolder);
    assert.equal(
      (await getForkOptions(h.source._id, 'answer', h.deps)).agents.length,
      1,
    );
    await addAgent('agent-00', 'copilot');
    await assertCreationRevalidates(t, h, 'agent-00', 'FORK_UNSUPPORTED');
    assert.deepEqual(counts, {
      capabilities: 0,
      mcp: 1,
      copilot: 1,
      lmstudio: 0,
    });
  });
});

test('options compare configured endpoint identity without discovery; POST revalidates and refuses native fallback', async (t) => {
  const first = await startExternalOpenAiCompatServer({ models: [] });
  const other = await startExternalOpenAiCompatServer({
    models: ['gpt-6-luna'],
  });
  try {
    await withCatalog(async ({ addAgent, workingFolder, counts }) => {
      const endpoint = `${first.baseUrl}/v1`;
      for (const name of ['agent-00', 'agent-01'])
        await addAgent(
          name,
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
      assert.equal(first.requestCount(), 0);
      assert.equal(other.requestCount(), 0);
      assert.deepEqual(counts, {
        capabilities: 0,
        mcp: 0,
        copilot: 0,
        lmstudio: 0,
      });
      await assertCreationRevalidates(t, h, 'agent-00', 'PROVIDER_UNAVAILABLE');
      assert.equal(first.requestCount(), 1);
      assert.equal(other.requestCount(), 0);
    });
  } finally {
    await first.stop();
    await other.stop();
  }
});

test('a target changed to an unavailable endpoint cannot silently execute against the native source endpoint', async (t) => {
  const endpoint = await startExternalOpenAiCompatServer({ models: [] });
  try {
    await withCatalog(async ({ addAgent, workingFolder }) => {
      await addAgent('agent-00', 'codex');
      const h = optionsFixture(workingFolder);
      assert.equal(
        (await getForkOptions(h.source._id, 'answer', h.deps)).agents.length,
        1,
      );
      await addAgent(
        'agent-00',
        'codex',
        `codeinfo_openai_endpoint = "${endpoint.baseUrl}/v1|responses"`,
      );
      await assertCreationRevalidates(t, h, 'agent-00', 'PROVIDER_UNAVAILABLE');
      assert.equal(endpoint.requestCount(), 1);
    });
  } finally {
    await endpoint.stop();
  }
});
