import assert from 'node:assert/strict';
import http from 'node:http';
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
import { attachWs } from '../../ws/server.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

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

async function startChatServer(clientFactory: () => LMStudioClient) {
  const app = buildChatApp(clientFactory);
  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  return {
    httpServer,
    wsHandle,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
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

test('chat surfaces INGEST_REQUIRED over WS when no locked model exists', async () => {
  setupChromaMock(null);
  const embedCalls = setupLmStudioEmbedMock();

  const server = await startChatServer(
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

  const ws = await connectWs({ baseUrl: server.baseUrl });
  try {
    sendJson(ws, {
      type: 'subscribe_conversation',
      conversationId: 'conv-vectorsearch-locked',
    });

    const res = await request(server.httpServer)
      .post('/chat')
      .send({
        model: 'm',
        conversationId: 'conv-vectorsearch-locked',
        message: 'hello',
      })
      .expect(202);

    const inflightId = res.body.inflightId as string;
    assert.equal(res.body.status, 'started');
    assert.equal(res.body.conversationId, 'conv-vectorsearch-locked');
    assert.equal(typeof inflightId, 'string');

    const final = await waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: string;
        conversationId: string;
        inflightId: string;
        status: string;
        error?: { message?: string };
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          inflightId?: string;
          status?: string;
          error?: { message?: string };
        };
        return (
          e.type === 'turn_final' &&
          e.conversationId === 'conv-vectorsearch-locked' &&
          e.inflightId === inflightId
        );
      },
      timeoutMs: 4000,
    });

    assert.equal(final.status, 'failed');
    assert.match(String(final.error?.message ?? ''), /INGEST_REQUIRED/i);
    assert.equal(embedCalls.length, 0);
  } finally {
    await closeWs(ws);
    await server.wsHandle.close();
    await new Promise<void>((resolve) =>
      server.httpServer.close(() => resolve()),
    );
  }
});

test('chat VectorSearch uses locked embedding model and streams tool-result', async () => {
  const embedCalls = setupLmStudioEmbedMock();
  setupChromaMock('embed-model');

  const server = await startChatServer(
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

  const ws = await connectWs({ baseUrl: server.baseUrl });
  try {
    sendJson(ws, {
      type: 'subscribe_conversation',
      conversationId: 'conv-vectorsearch-locked-2',
    });

    const res = await request(server.httpServer)
      .post('/chat')
      .send({
        model: 'm',
        conversationId: 'conv-vectorsearch-locked-2',
        message: 'hello',
      })
      .expect(202);

    const inflightId = res.body.inflightId as string;
    assert.equal(res.body.status, 'started');

    const toolResult = await waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: string;
        conversationId: string;
        inflightId: string;
        event: { type: string; result?: unknown };
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          inflightId?: string;
          event?: { type?: string };
        };
        return (
          e.type === 'tool_event' &&
          e.conversationId === 'conv-vectorsearch-locked-2' &&
          e.inflightId === inflightId &&
          e.event?.type === 'tool-result'
        );
      },
      timeoutMs: 4000,
    });

    const payload = toolResult.event.result as {
      modelId?: string;
      results?: Array<{ hostPath?: string }>;
    };

    assert.equal(payload.modelId, 'embed-model');
    assert.equal(
      payload.results?.[0]?.hostPath,
      '/host/base/repo-one/docs/readme.md',
    );

    const modelCalls = embedCalls.filter((c) => c.text === undefined);
    assert.ok(modelCalls.some((c) => c.model === 'embed-model'));

    await waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: string;
        conversationId: string;
        inflightId: string;
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          inflightId?: string;
        };
        return (
          e.type === 'turn_final' &&
          e.conversationId === 'conv-vectorsearch-locked-2' &&
          e.inflightId === inflightId
        );
      },
      timeoutMs: 4000,
    });
  } finally {
    await closeWs(ws);
    await server.wsHandle.close();
    await new Promise<void>((resolve) =>
      server.httpServer.close(() => resolve()),
    );
  }
});
