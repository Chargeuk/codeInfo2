import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatInterfaceLMStudio } from '../../chat/interfaces/ChatInterfaceLMStudio.js';
import {
  createLmStudioEmbeddingProvider,
  LmStudioEmbeddingError,
  type LmClientResolver,
} from '../../ingest/providers/index.js';
import { query, resetStore } from '../../logStore.js';

test.beforeEach(() => {
  resetStore();
});

function createResolverDouble() {
  let modelProviderCalls = 0;
  let embedCalls = 0;

  const resolver: LmClientResolver = () => ({
    embedding: {
      model: async () => {
        modelProviderCalls += 1;
        return {
          embed: async () => {
            embedCalls += 1;
            return { embedding: [0.1, 0.2, 0.3] };
          },
          countTokens: async () => 10,
          getContextLength: async () => 4096,
        };
      },
    },
  });

  return {
    resolver,
    getModelProviderCalls: () => modelProviderCalls,
    getEmbedCalls: () => embedCalls,
  };
}

test('LM Studio ingest retries log warn on retry and error on terminal exhaustion', async () => {
  let calls = 0;
  const resolver: LmClientResolver = () => ({
    embedding: {
      model: async () => ({
        embed: async () => {
          calls += 1;
          throw new Error('connect ECONNREFUSED 127.0.0.1:1234');
        },
        countTokens: async () => 10,
        getContextLength: async () => 4096,
      }),
    },
  });

  const provider = createLmStudioEmbeddingProvider({
    lmClientResolver: resolver,
    baseUrl: 'ws://host.docker.internal:1234',
    ingestFailureContext: () => ({
      runId: 'run-lm-retry',
      path: '/tmp/repo',
      root: '/tmp/repo',
      currentFile: 'src/main.ts',
    }),
  });
  const model = await provider.getModel('text-embedding-nomic-embed-text-v1.5');
  const controller = new AbortController();

  await assert.rejects(() =>
    model.embedText('hello world', { signal: controller.signal }),
  );
  assert.equal(calls, 3);

  const entries = query(
    { text: 'DEV-0000036:T17:ingest_provider_failure' },
    30,
  );
  const retryWarns = entries.filter(
    (entry) =>
      entry.level === 'warn' &&
      entry.context?.provider === 'lmstudio' &&
      entry.context?.stage === 'retry',
  );
  const terminalErrors = entries.filter(
    (entry) =>
      entry.level === 'error' &&
      entry.context?.provider === 'lmstudio' &&
      entry.context?.stage === 'terminal',
  );

  assert.equal(retryWarns.length, 2);
  assert.equal(terminalErrors.length, 1);
  assert.equal(terminalErrors[0]?.context?.code, 'LMSTUDIO_UNAVAILABLE');
  assert.equal(terminalErrors[0]?.context?.retryable, true);
});

test('rejects empty LM Studio input before retry or model calls', async () => {
  const double = createResolverDouble();
  const provider = createLmStudioEmbeddingProvider({
    lmClientResolver: double.resolver,
    baseUrl: 'ws://host.docker.internal:1234',
  });
  const model = await provider.getModel('text-embedding-nomic-embed-text-v1.5');
  const modelProviderCallsBeforeEmbed = double.getModelProviderCalls();

  await assert.rejects(
    () => model.embedText(''),
    (error: unknown) => {
      assert.ok(error instanceof LmStudioEmbeddingError);
      assert.equal(error.code, 'LMSTUDIO_BAD_REQUEST');
      assert.match(error.message, /cannot be blank/i);
      assert.equal(error.retryable, false);
      return true;
    },
  );

  assert.equal(double.getModelProviderCalls(), modelProviderCallsBeforeEmbed);
  assert.equal(double.getEmbedCalls(), 0);
  const logs = query({
    source: ['server'],
    text: 'DEV-0000046:T4:lmstudio-blank-input-guard-hit',
  });
  assert.equal(logs.length, 1);
  const providerFailureLogs = query({
    source: ['server'],
    text: 'DEV-0000036:T17:ingest_provider_failure',
  });
  assert.equal(providerFailureLogs.length, 0);
  assert.equal(logs[0]?.context?.provider, 'lmstudio');
  assert.equal(logs[0]?.context?.model, 'text-embedding-nomic-embed-text-v1.5');
  assert.equal(logs[0]?.context?.rawInputClassification, 'empty');
  assert.equal(logs[0]?.context?.skippedRetryAndModelCall, true);
});

test('rejects whitespace-only LM Studio input with the same bad-request error', async () => {
  const double = createResolverDouble();
  const provider = createLmStudioEmbeddingProvider({
    lmClientResolver: double.resolver,
    baseUrl: 'ws://host.docker.internal:1234',
  });
  const model = await provider.getModel('text-embedding-nomic-embed-text-v1.5');
  const modelProviderCallsBeforeEmbed = double.getModelProviderCalls();

  await assert.rejects(
    () => model.embedText(' \n\t  '),
    (error: unknown) => {
      assert.ok(error instanceof LmStudioEmbeddingError);
      assert.equal(error.code, 'LMSTUDIO_BAD_REQUEST');
      assert.match(error.message, /cannot be blank/i);
      assert.equal(error.retryable, false);
      return true;
    },
  );

  assert.equal(double.getModelProviderCalls(), modelProviderCallsBeforeEmbed);
  assert.equal(double.getEmbedCalls(), 0);
  const logs = query({
    source: ['server'],
    text: 'DEV-0000046:T4:lmstudio-blank-input-guard-hit',
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.context?.rawInputClassification, 'whitespace_only');
});

test('LM Studio chat runtime rejects unlimited and out-of-range numeric agent flag values while leaving a diagnosable log entry', async () => {
  const runInvalidFlags = async (agentFlags: Record<string, unknown>) => {
    resetStore();
    const chat = new ChatInterfaceLMStudio(
      () => {
        throw new Error('client should not be created');
      },
      () => ({ tools: [] }),
    );
    const errors: string[] = [];
    chat.on('error', (event) => errors.push(event.message));

    await chat.execute(
      'hello',
      {
        requestId: 'lmstudio-runtime-invalid',
        baseUrl: 'http://127.0.0.1:1234',
        agentFlags,
      },
      'lmstudio-runtime-invalid-conversation',
      'lmstudio-model',
    );

    const logs = query({
      text: 'story.0000056.task04.lmstudio_runtime_flags_invalid',
    });

    return {
      error: errors.at(-1) ?? '',
      log: logs.at(-1),
    };
  };

  const unlimited = await runInvalidFlags({ maxTokens: false });
  assert.match(unlimited.error, /agentFlags\.maxTokens must be a number/u);
  assert.match(
    String(unlimited.log?.context?.error ?? ''),
    /agentFlags\.maxTokens must be a number/u,
  );

  const outOfRange = await runInvalidFlags({ temperature: 3 });
  assert.match(outOfRange.error, /agentFlags\.temperature must be at most 2/u);
  assert.match(
    String(outOfRange.log?.context?.error ?? ''),
    /agentFlags\.temperature must be at most 2/u,
  );
});
