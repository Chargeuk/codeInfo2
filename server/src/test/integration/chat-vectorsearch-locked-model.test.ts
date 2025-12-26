import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { type LMStudioClient } from '@lmstudio/sdk';
import { ChromaClient } from 'chromadb';
import express from 'express';
import request from 'supertest';
import {
  resetCollectionsForTests,
  resetLmClientResolver,
  setLmClientResolver,
} from '../../ingest/chromaClient.js';
import { createChatRouter } from '../../routes/chat.js';

const ORIGINAL_BASE_URL = process.env.LMSTUDIO_BASE_URL;

type EmbedCall = { model: string; text?: string };
type VectorTool = {
  name?: string;
  implementation?: (
    params: { query?: unknown; repository?: unknown; limit?: unknown },
    ctx: ReturnType<typeof toolContext>,
  ) => Promise<unknown>;
};

function setupLmStudioEmbedMock({ failModel }: { failModel?: boolean } = {}) {
  const calls: EmbedCall[] = [];
  setLmClientResolver(() => {
    return {
      embedding: {
        model: async (key: string) => {
          calls.push({ model: key });
          if (failModel) {
            throw new Error('model missing');
          }
          return {
            embed: async (text: string) => {
              calls.push({ model: key, text });
              return { embedding: [1, 2, 3] } as const;
            },
          };
        },
      },
    } as never;
  });
  return calls;
}

function setupChromaMock(lockedModelId: string | null) {
  let capturedEmbedding:
    | { generate?: (texts: string[]) => Promise<number[][]> }
    | undefined;
  const vectors = {
    metadata: { lockedModelId },
    count: async () => 0,
    query: async (opts: { queryTexts?: string[] }) => {
      if (capturedEmbedding?.generate && Array.isArray(opts.queryTexts)) {
        await capturedEmbedding.generate(opts.queryTexts);
      }
      return {
        ids: [['chunk-1']],
        documents: [['vector chunk']],
        metadatas: [
          [
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: lockedModelId ?? '',
              chunkHash: 'chunk-1',
            },
          ],
        ],
        distances: [[0.12]],
      } as const;
    },
  } as const;

  const roots = {
    get: async () => ({
      ids: ['repo-one'],
      metadatas: [
        {
          root: '/data/repo-one',
          name: 'repo-one',
          description: 'sample repo',
          model: lockedModelId ?? '',
          lastIngestAt: '2025-01-01T00:00:00.000Z',
          files: 1,
          chunks: 1,
          embedded: 1,
        },
      ],
    }),
  } as const;

  const getOrCreate = mock.method(
    ChromaClient.prototype,
    'getOrCreateCollection',
    async (opts: { name?: string; embeddingFunction?: unknown }) => {
      if (opts.name === 'ingest_roots') return roots as never;
      capturedEmbedding = opts.embeddingFunction as typeof capturedEmbedding;
      return vectors as never;
    },
  );

  const deleteCollection = mock.method(
    ChromaClient.prototype,
    'deleteCollection',
    async () => {},
  );

  return { getOrCreate, deleteCollection, capturedEmbedding };
}

function buildChatApp(clientFactory: () => LMStudioClient) {
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory,
    }),
  );
  return app;
}

function toolContext() {
  return {
    status: () => undefined,
    warn: () => undefined,
    signal: new AbortController().signal,
    callId: 1,
  } as const;
}

beforeEach(() => {
  resetCollectionsForTests();
  process.env.HOST_INGEST_DIR = '/host/base';
  process.env.LMSTUDIO_BASE_URL =
    ORIGINAL_BASE_URL ?? 'http://host.docker.internal:1234';
});

afterEach(() => {
  mock.restoreAll();
  resetCollectionsForTests();
  resetLmClientResolver();
  if (ORIGINAL_BASE_URL === undefined) {
    delete process.env.LMSTUDIO_BASE_URL;
  } else {
    process.env.LMSTUDIO_BASE_URL = ORIGINAL_BASE_URL;
  }
});

test('chat SSE surfaces INGEST_REQUIRED when no locked model exists', async () => {
  setupChromaMock(null);
  const embedCalls = setupLmStudioEmbedMock();

  const app = buildChatApp(
    () =>
      ({
        llm: {
          model: async () => ({
            act: async (
              _chat: unknown,
              tools: VectorTool[],
              opts: {
                onToolCallRequestStart?: (
                  roundIndex: number,
                  callId: number,
                ) => void;
                onToolCallRequestFailure?: (
                  roundIndex: number,
                  callId: number,
                  error: Error,
                ) => void;
              },
            ) => {
              const vectorTool = tools.find((t) => t.name === 'VectorSearch');
              if (!vectorTool) throw new Error('VectorSearch tool missing');
              opts.onToolCallRequestStart?.(0, 1);
              const impl =
                vectorTool.implementation as VectorTool['implementation'];
              try {
                if (!impl) throw new Error('VectorSearch tool missing');
                await impl({ query: 'hi' }, toolContext());
              } catch (err) {
                opts.onToolCallRequestFailure?.(0, 1, err as Error);
                throw err;
              }
            },
          }),
        },
      }) as unknown as LMStudioClient,
  );

  const res = await request(app).post('/chat').send({
    model: 'm',
    conversationId: 'conv-vectorsearch-locked',
    message: 'hello',
  });

  const errorEvents = res.text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.replace('data: ', '')))
    .filter((evt) => evt.type === 'error');

  assert.ok(errorEvents.length >= 1, 'expected at least one error event');
  assert.match(errorEvents[0].message, /INGEST_REQUIRED/i);
  assert.equal(embedCalls.length, 0);
});

test('chat VectorSearch uses locked embedding model and streams tool-result', async () => {
  const embedCalls = setupLmStudioEmbedMock();
  setupChromaMock('embed-model');

  const app = buildChatApp(
    () =>
      ({
        llm: {
          model: async () => ({
            act: async (
              _chat: unknown,
              tools: VectorTool[],
              opts: {
                onRoundStart?: (roundIndex: number) => void;
                onToolCallRequestStart?: (
                  roundIndex: number,
                  callId: number,
                ) => void;
                onToolCallRequestEnd?: (
                  roundIndex: number,
                  callId: number,
                ) => void;
                onToolCallResult?: (
                  roundIndex: number,
                  callId: number,
                  info: unknown,
                ) => void;
                onPredictionFragment?: (fragment: {
                  content?: string;
                  roundIndex?: number;
                }) => void;
                onMessage?: (message: {
                  role: string;
                  content: string;
                }) => void;
              },
            ) => {
              opts.onRoundStart?.(0);
              const vectorTool = tools.find((t) => t.name === 'VectorSearch');
              if (!vectorTool) throw new Error('VectorSearch tool missing');
              opts.onToolCallRequestStart?.(0, 1);
              const impl =
                vectorTool.implementation as VectorTool['implementation'];
              if (!impl) throw new Error('VectorSearch tool missing');
              const result = await impl({ query: 'hi' }, toolContext());
              opts.onToolCallRequestEnd?.(0, 1);
              opts.onToolCallResult?.(0, 1, result);
              opts.onPredictionFragment?.({
                content: 'partial',
                roundIndex: 0,
              });
              opts.onMessage?.({ role: 'assistant', content: 'done' });
            },
          }),
        },
      }) as unknown as LMStudioClient,
  );

  const res = await request(app)
    .post('/chat')
    .send({
      model: 'm',
      conversationId: 'conv-vectorsearch-locked-2',
      message: 'hello',
    })
    .expect(200);

  const events = res.text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.replace('data: ', '')));

  const toolResult = events.find((evt) => evt.type === 'tool-result');
  assert.ok(toolResult, 'expected tool-result event');
  assert.equal(toolResult.result.modelId, 'embed-model');
  assert.equal(
    toolResult.result.results[0].hostPath,
    '/host/base/repo-one/docs/readme.md',
  );

  const modelCalls = embedCalls.filter((c) => c.text === undefined);
  assert.ok(modelCalls.some((c) => c.model === 'embed-model'));
});
