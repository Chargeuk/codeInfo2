import assert from 'node:assert/strict';
import test from 'node:test';
import { INGEST_ROOTS_SCHEMA_VERSION } from '@codeinfo2/common';
import express from 'express';
import request from 'supertest';
import { createMcpRouter } from '../../mcp/server.js';

function createMcpApp(
  roots: { ids: string[]; metadatas: Record<string, unknown>[] },
  lockedModelId: string | null,
) {
  const app = express();
  app.use(express.json());
  app.use(
    createMcpRouter({
      getRootsCollection: async () =>
        ({
          get: async () => roots,
        }) as never,
      getLockedModel: async () => lockedModelId,
    }),
  );
  return app;
}

test('ListIngestedRepositories default MCP path returns documented id, name, and compatibility lock fields', async () => {
  const app = createMcpApp(
    {
      ids: ['run-1'],
      metadatas: [
        {
          name: 'repo',
          root: '/data/repo',
          model: 'embed-model',
          files: 3,
          chunks: 12,
          embedded: 12,
          lastIngestAt: '2026-01-01T00:00:00.000Z',
          state: 'completed',
          description: 'sample',
          lastError: null,
        },
      ],
    },
    'text-embedding-openai',
  );
  const response = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 'contract-parity',
      method: 'tools/call',
      params: {
        name: 'ListIngestedRepositories',
        arguments: {},
      },
    });

  assert.equal(response.status, 200);
  const parsed = JSON.parse(
    response.body?.result?.content?.[0]?.text ?? '{}',
  ) as {
    lock: {
      embeddingProvider: string;
      embeddingModel: string;
      embeddingDimensions: number;
      lockedModelId: string;
      modelId: string;
    } | null;
    lockedModelId: string | null;
    schemaVersion: string;
    repos: Array<{
      id: string;
      name: string;
      status: string;
      embeddingProvider: string;
      embeddingModel: string;
      embeddingDimensions: number;
      model: string;
      modelId: string;
      lock: { embeddingModel: string; modelId: string; lockedModelId: string };
    }>;
  };
  assert.equal(parsed.lockedModelId, 'text-embedding-openai');
  assert.equal(parsed.lock?.embeddingModel, 'text-embedding-openai');
  assert.equal(parsed.lock?.modelId, 'text-embedding-openai');
  assert.equal(parsed.schemaVersion, INGEST_ROOTS_SCHEMA_VERSION);
  assert.equal(parsed.repos.length, 1);
  assert.equal(parsed.repos[0]?.id, '/data/repo');
  assert.equal(parsed.repos[0]?.name, 'repo');
  assert.equal(parsed.repos[0].embeddingProvider, 'lmstudio');
  assert.equal(parsed.repos[0].embeddingModel, 'embed-model');
  assert.equal(parsed.repos[0].model, 'embed-model');
  assert.equal(parsed.repos[0].modelId, 'embed-model');
  assert.equal(parsed.repos[0].lock.embeddingModel, 'embed-model');
  assert.equal(parsed.repos[0].lock.modelId, 'embed-model');
  assert.equal(parsed.repos[0].lock.lockedModelId, 'embed-model');
  assert.equal(parsed.repos[0].status, 'completed');
});

test('ListIngestedRepositories default MCP path preserves documented structured error fields', async () => {
  const app = createMcpApp(
    {
      ids: ['run-ingest-error'],
      metadatas: [
        {
          name: 'repo-error',
          root: '/data/repo-error',
          model: 'text-embedding-3-small',
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          files: 3,
          chunks: 12,
          embedded: 12,
          lastIngestAt: '2026-01-01T00:00:00.000Z',
          state: 'error',
          lastError: 'queue replay validation failed',
          error: {
            error: 'INVALID_REEMBED_STATE',
            message: 'queue replay validation failed',
            retryable: false,
            provider: 'ingest',
          },
        },
      ],
    },
    'text-embedding-3-small',
  );
  const response = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 'structured-ingest-error',
      method: 'tools/call',
      params: {
        name: 'ListIngestedRepositories',
        arguments: {},
      },
    });

  assert.equal(response.status, 200);
  const parsed = JSON.parse(
    response.body?.result?.content?.[0]?.text ?? '{}',
  ) as {
    repos: Array<{
      id: string;
      name: string;
      lastError?: string | null;
      error?: {
        error?: string;
        message?: string;
        retryable?: boolean;
        provider?: string;
      } | null;
    }>;
  };
  assert.equal(parsed.repos[0]?.id, '/data/repo-error');
  assert.equal(parsed.repos[0]?.name, 'repo-error');
  assert.equal(parsed.repos[0]?.lastError, 'queue replay validation failed');
  assert.equal(parsed.repos[0]?.error?.error, 'INVALID_REEMBED_STATE');
  assert.equal(
    parsed.repos[0]?.error?.message,
    'queue replay validation failed',
  );
  assert.equal(parsed.repos[0]?.error?.retryable, false);
  assert.equal(parsed.repos[0]?.error?.provider, 'ingest');
});

test('ListIngestedRepositories emits canonical repository identity even when display names differ', async () => {
  const app = createMcpApp(
    {
      ids: ['older-row', 'newer-row'],
      metadatas: [
        {
          name: 'display-name-old',
          root: '/data/stable-repo',
          model: 'shared-id',
          files: 1,
          chunks: 1,
          embedded: 1,
        },
        {
          name: 'display-name-new',
          root: '/data/stable-repo',
          model: 'shared-id',
          embeddingProvider: 'lmstudio',
          embeddingModel: 'shared-id',
          embeddingDimensions: 768,
          files: 1,
          chunks: 1,
          embedded: 1,
        },
      ],
    },
    'shared-id',
  );
  const response = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 'provider-collision',
      method: 'tools/call',
      params: {
        name: 'ListIngestedRepositories',
        arguments: {},
      },
    });

  assert.equal(response.status, 200);
  const parsed = JSON.parse(
    response.body?.result?.content?.[0]?.text ?? '{}',
  ) as {
    repos: Array<{
      id: string;
      name: string;
      containerPath: string;
    }>;
  };
  assert.equal(parsed.repos.length, 1);
  assert.equal(parsed.repos[0]?.id, '/data/stable-repo');
  assert.equal(parsed.repos[0]?.name, 'display-name-new');
  assert.equal(parsed.repos[0]?.containerPath, '/data/stable-repo');
});

test('reingest_repository canonicalizes selectors to canonical repository identity ahead of stale display-facing repo.id', async () => {
  let capturedSourceId: string | null = null;
  const app = express();
  app.use(express.json());
  app.use(
    createMcpRouter({
      listIngestedRepositories: async () => ({
        repos: [
          {
            id: 'display-facing-stale-id',
            name: 'stable-repo',
            description: null,
            containerPath: '/data/stable-repo',
            hostPath: '/host/stable-repo',
            lastIngestAt: '2026-04-13T00:00:00.000Z',
            embeddingProvider: 'lmstudio',
            embeddingModel: 'embed-model',
            embeddingDimensions: 0,
            modelId: 'embed-model',
            counts: { files: 1, chunks: 1, embedded: 1 },
            lastError: null,
            status: 'completed',
          },
        ],
        lock: null,
        lockedModelId: null,
        schemaVersion: INGEST_ROOTS_SCHEMA_VERSION,
      }),
      runReingestRepository: async (args) => {
        const { sourceId } = args as { sourceId: string };
        capturedSourceId = sourceId;
        return {
          ok: true,
          value: {
            status: 'completed',
            operation: 'reembed',
            runId: 'run-1',
            sourceId,
            resolvedRepositoryId: sourceId,
            completionMode: 'reingested',
            durationMs: 1,
            files: 1,
            chunks: 1,
            embedded: 1,
            errorCode: null,
          },
        };
      },
    }),
  );

  const response = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 'selector-canonical',
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: { sourceId: '/host/stable-repo' },
      },
    });

  assert.equal(response.status, 200);
  assert.equal(capturedSourceId, '/data/stable-repo');
});

test('reingest_repository still prefers canonical repository identity when stale display-facing repo.id and fresh canonical path coexist on the same row', async () => {
  let capturedSourceId: string | null = null;
  const app = express();
  app.use(express.json());
  app.use(
    createMcpRouter({
      listIngestedRepositories: async () => ({
        repos: [
          {
            id: 'stable-repo',
            name: 'stable-repo',
            description: null,
            containerPath: '/data/stable-repo',
            hostPath: '/host/stable-repo',
            lastIngestAt: '2026-04-13T00:00:00.000Z',
            embeddingProvider: 'lmstudio',
            embeddingModel: 'embed-model',
            embeddingDimensions: 0,
            modelId: 'embed-model',
            counts: { files: 1, chunks: 1, embedded: 1 },
            lastError: null,
            status: 'completed',
          },
        ],
        lock: null,
        lockedModelId: null,
        schemaVersion: INGEST_ROOTS_SCHEMA_VERSION,
      }),
      runReingestRepository: async (args) => {
        const { sourceId } = args as { sourceId: string };
        capturedSourceId = sourceId;
        return {
          ok: true,
          value: {
            status: 'completed',
            operation: 'reembed',
            runId: 'run-2',
            sourceId,
            resolvedRepositoryId: sourceId,
            completionMode: 'reingested',
            durationMs: 1,
            files: 1,
            chunks: 1,
            embedded: 1,
            errorCode: null,
          },
        };
      },
    }),
  );

  const response = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 'selector-stale-vs-fresh',
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: { sourceId: '/host/stable-repo' },
      },
    });

  assert.equal(response.status, 200);
  assert.equal(capturedSourceId, '/data/stable-repo');
});
