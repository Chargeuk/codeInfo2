import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import mongoose from 'mongoose';
import { normalizeCanonicalQueueTargetPath } from '../../ingest/requestContracts.js';
import {
  enqueueOrReuseIngestRequest,
  type EnqueueIngestRequestInput,
} from '../../ingest/requestQueue.js';
import {
  IngestQueueRequestModel,
  type IngestQueueRequest,
} from '../../mongo/ingestQueueRequest.js';

type QueueIndexFields = Record<string, 1 | -1>;

function setMongoReadyState(value: number) {
  (mongoose.connection as unknown as { readyState: number }).readyState = value;
}

function createQueueRequest(
  overrides: Partial<IngestQueueRequest> = {},
): IngestQueueRequest {
  const createdAt = overrides.createdAt ?? new Date('2026-01-01T00:00:00.000Z');
  const updatedAt = overrides.updatedAt ?? createdAt;
  return {
    _id: overrides._id ?? new mongoose.Types.ObjectId(),
    canonicalTargetPath: overrides.canonicalTargetPath ?? '/data/example',
    operation: overrides.operation ?? 'start',
    queueState: overrides.queueState ?? 'waiting',
    requestPayload:
      overrides.requestPayload ??
      ({
        model: 'nomic-embed',
        embeddingProvider: 'lmstudio',
        embeddingModel: 'nomic-embed',
      } satisfies Record<string, unknown>),
    sourceSurface: overrides.sourceSurface ?? 'rest/ingest/start',
    runId: overrides.runId ?? null,
    createdAt,
    updatedAt,
  };
}

function buildInput(
  overrides: Partial<EnqueueIngestRequestInput> = {},
): EnqueueIngestRequestInput {
  return {
    canonicalTargetPath: overrides.canonicalTargetPath ?? '/data/example',
    operation: overrides.operation ?? 'start',
    requestPayload: overrides.requestPayload ?? {
      model: 'nomic-embed',
      embeddingProvider: 'lmstudio',
      embeddingModel: 'nomic-embed',
    },
    sourceSurface: overrides.sourceSurface ?? 'rest/ingest/start',
  };
}

beforeEach(() => {
  mock.restoreAll();
  mock.reset();
  setMongoReadyState(1);
});

afterEach(() => {
  mock.restoreAll();
  mock.reset();
  setMongoReadyState(0);
});

test('ingest queue model uses timestamps and explicit target plus FIFO indexes', () => {
  assert.equal(
    IngestQueueRequestModel.collection.collectionName,
    'ingest_queue_requests',
  );
  assert.equal(IngestQueueRequestModel.schema.options.timestamps, true);

  const indexes = IngestQueueRequestModel.schema.indexes();
  assert.ok(
    indexes.some(
      ([fields]: [QueueIndexFields, Record<string, unknown>]) =>
        fields.canonicalTargetPath === 1 && fields.queueState === 1,
    ),
  );
  assert.ok(
    indexes.some(
      ([fields, options]: [QueueIndexFields, Record<string, unknown>]) =>
        fields.canonicalTargetPath === 1 &&
        options.unique === true &&
        options.name === 'ingest_queue_live_target_unique_idx' &&
        Array.isArray(
          (
            options.partialFilterExpression as
              | { queueState?: { $in?: unknown[] } }
              | undefined
          )?.queueState?.$in,
        ) &&
        (
          options.partialFilterExpression as {
            queueState?: { $in?: unknown[] };
          }
        ).queueState?.$in?.includes('cleanup-blocked'),
    ),
  );
  assert.ok(
    indexes.some(
      ([fields]: [QueueIndexFields, Record<string, unknown>]) =>
        fields.queueState === 1 && fields.createdAt === 1 && fields._id === 1,
    ),
  );
});

test('fresh insert creates a waiting queue record and surfaces the Mongo _id as requestId', async () => {
  const created = createQueueRequest();
  const createMock = mock.method(
    IngestQueueRequestModel,
    'create',
    async () => created,
  );
  const countMock = mock.method(
    IngestQueueRequestModel,
    'countDocuments',
    () => ({
      exec: async () => 0,
    }),
  );
  mock.method(IngestQueueRequestModel, 'findOneAndUpdate', () => ({
    exec: async () => null,
  }));
  mock.method(IngestQueueRequestModel, 'findOne', () => ({
    sort: () => ({
      exec: async () => null,
    }),
  }));

  const result = await enqueueOrReuseIngestRequest(buildInput());

  assert.equal(result.requestId, created._id.toString());
  assert.equal(result.queueState, 'waiting');
  assert.equal(result.queuePosition, 1);
  assert.equal(result.reusedExisting, false);
  assert.equal(result.updatedExisting, false);
  assert.equal(result.queueRequest.queueState, 'waiting');
  assert.deepEqual(createMock.mock.calls[0]?.arguments[0], {
    canonicalTargetPath: '/data/example',
    operation: 'start',
    queueState: 'waiting',
    requestPayload: {
      model: 'nomic-embed',
      embeddingProvider: 'lmstudio',
      embeddingModel: 'nomic-embed',
    },
    sourceSurface: 'rest/ingest/start',
    runId: null,
  });
  assert.equal(countMock.mock.calls.length, 1);
});

test('queue admission rejects when Mongo is unavailable before any write starts', async () => {
  setMongoReadyState(0);
  const createMock = mock.method(
    IngestQueueRequestModel,
    'create',
    async () => {
      throw new Error('should not create while Mongo is disconnected');
    },
  );

  await assert.rejects(
    enqueueOrReuseIngestRequest(buildInput()),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'QUEUE_UNAVAILABLE');
      assert.equal((error as { status?: number }).status, 503);
      assert.equal((error as { retryable?: boolean }).retryable, true);
      return true;
    },
  );
  assert.equal(createMock.mock.calls.length, 0);
});

test('canonical queue-target normalization collapses start-ingest and re-embed aliases onto one queue identity for an existing waiting start row without rewriting it', async () => {
  const canonicalStartTarget =
    normalizeCanonicalQueueTargetPath('/data/example/');
  const canonicalReembedTarget =
    normalizeCanonicalQueueTargetPath('/data//example');
  const existing = createQueueRequest({
    canonicalTargetPath: canonicalStartTarget,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:05:00.000Z'),
  });

  const waitingLookupMock = mock.method(
    IngestQueueRequestModel,
    'findOne',
    (filter: { canonicalTargetPath?: string; queueState?: string }) => {
      if (filter.queueState === 'waiting') {
        assert.equal(filter.canonicalTargetPath, canonicalStartTarget);
        return {
          sort: () => ({
            exec: async () => existing,
          }),
        };
      }

      return {
        sort: () => ({
          exec: async () => null,
        }),
      };
    },
  );
  const waitingUpdateMock = mock.method(
    IngestQueueRequestModel,
    'findOneAndUpdate',
    () => ({
      exec: async () => {
        throw new Error('waiting start row should not be rewritten to reembed');
      },
    }),
  );
  mock.method(IngestQueueRequestModel, 'countDocuments', () => ({
    exec: async () => 0,
  }));

  const result = await enqueueOrReuseIngestRequest(
    buildInput({
      canonicalTargetPath: canonicalReembedTarget,
      operation: 'reembed',
      sourceSurface: 'rest/ingest/reembed',
      requestPayload: {
        model: 'openai/text-embedding-3-small',
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
      },
    }),
  );

  assert.equal(canonicalStartTarget, canonicalReembedTarget);
  assert.equal(result.requestId, existing._id.toString());
  assert.equal(result.queuePosition, 1);
  assert.equal(result.updatedExisting, false);
  assert.equal(result.queueRequest.operation, 'start');
  assert.equal(waitingLookupMock.mock.calls.length, 1);
  assert.equal(waitingUpdateMock.mock.calls.length, 0);
});

test('ordinary matched-row update race keeps a raced-in waiting start row as start with updatedExisting false', async () => {
  const existing = createQueueRequest({
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:05:00.000Z'),
  });

  const waitingLookupMock = mock.method(
    IngestQueueRequestModel,
    'findOne',
    (filter: { queueState?: string | { $in?: string[] } }) => {
      if (filter.queueState === 'waiting') {
        return {
          sort: () => ({
            exec: async () => null,
          }),
        };
      }

      return {
        sort: () => ({
          exec: async () => existing,
        }),
      };
    },
  );
  const waitingUpdateMock = mock.method(
    IngestQueueRequestModel,
    'findOneAndUpdate',
    (
      filter: Record<string, unknown>,
      update: { $set: Record<string, unknown> },
    ) => {
      assert.deepEqual(filter, {
        canonicalTargetPath: '/data/example',
        queueState: 'waiting',
        operation: 'reembed',
      });
      assert.deepEqual(update, {
        $set: {
          operation: 'reembed',
          requestPayload: {
            model: 'embed-race',
            embeddingProvider: 'openai',
            embeddingModel: 'embed-race',
          },
        },
      });

      return {
        exec: async () => null,
      };
    },
  );
  mock.method(IngestQueueRequestModel, 'countDocuments', () => ({
    exec: async () => 0,
  }));

  const result = await enqueueOrReuseIngestRequest(
    buildInput({
      operation: 'reembed',
      sourceSurface: 'rest/ingest/reembed',
      requestPayload: {
        model: 'embed-race',
        embeddingProvider: 'openai',
        embeddingModel: 'embed-race',
      },
    }),
  );

  assert.equal(result.requestId, existing._id.toString());
  assert.equal(result.queueRequest.operation, 'start');
  assert.equal(result.updatedExisting, false);
  assert.equal(waitingLookupMock.mock.calls.length, 2);
  assert.equal(waitingUpdateMock.mock.calls.length, 1);
});

test('ordinary matched-row update race preserves queue identity metadata on the original waiting start row', async () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const existing = createQueueRequest({
    createdAt,
    updatedAt: new Date('2026-01-01T00:05:00.000Z'),
    sourceSurface: 'rest/ingest/start',
  });

  mock.method(
    IngestQueueRequestModel,
    'findOne',
    (filter: { queueState?: string | { $in?: string[] } }) => {
      if (filter.queueState === 'waiting') {
        return {
          sort: () => ({
            exec: async () => null,
          }),
        };
      }

      return {
        sort: () => ({
          exec: async () => existing,
        }),
      };
    },
  );
  mock.method(IngestQueueRequestModel, 'findOneAndUpdate', () => ({
    exec: async () => null,
  }));
  mock.method(IngestQueueRequestModel, 'countDocuments', () => ({
    exec: async () => 2,
  }));

  const result = await enqueueOrReuseIngestRequest(
    buildInput({
      operation: 'reembed',
      sourceSurface: 'rest/ingest/reembed',
      requestPayload: {
        model: 'embed-race',
        embeddingProvider: 'openai',
        embeddingModel: 'embed-race',
      },
    }),
  );

  assert.equal(result.requestId, existing._id.toString());
  assert.equal(result.queuePosition, 3);
  assert.equal(result.updatedExisting, false);
  assert.equal(
    result.queueRequest.createdAt.toISOString(),
    createdAt.toISOString(),
  );
  assert.equal(result.queueRequest.sourceSurface, 'rest/ingest/start');
  assert.deepEqual(result.queueRequest.requestPayload, existing.requestPayload);
});

test('allowed waiting-row rewrite preserves queue identity metadata and reports updatedExisting true', async () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const updatedAt = new Date('2026-01-01T00:10:00.000Z');
  const existing = createQueueRequest({
    createdAt,
    updatedAt,
    operation: 'reembed',
    requestPayload: {
      model: 'openai/text-embedding-3-small',
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
    },
    sourceSurface: 'rest/ingest/start',
  });

  const waitingUpdateMock = mock.method(
    IngestQueueRequestModel,
    'findOneAndUpdate',
    (
      _filter: Record<string, unknown>,
      update: { $set: Record<string, unknown> },
    ) => {
      assert.deepEqual(update, {
        $set: {
          operation: 'reembed',
          requestPayload: {
            model: 'nomic-embed',
            embeddingProvider: 'lmstudio',
            embeddingModel: 'nomic-embed',
          },
        },
      });

      return {
        exec: async () =>
          createQueueRequest({
            ...existing,
            operation: 'reembed',
            requestPayload: {
              model: 'nomic-embed',
              embeddingProvider: 'lmstudio',
              embeddingModel: 'nomic-embed',
            },
            updatedAt,
          }),
      };
    },
  );
  mock.method(
    IngestQueueRequestModel,
    'findOne',
    (filter: { canonicalTargetPath?: string; queueState?: string }) => {
      if (filter.queueState === 'waiting') {
        return {
          sort: () => ({
            exec: async () => existing,
          }),
        };
      }

      return {
        sort: () => ({
          exec: async () => null,
        }),
      };
    },
  );
  mock.method(IngestQueueRequestModel, 'countDocuments', () => ({
    exec: async () => 2,
  }));

  const result = await enqueueOrReuseIngestRequest(
    buildInput({
      operation: 'reembed',
      sourceSurface: 'rest/ingest/reembed',
    }),
  );

  assert.equal(result.requestId, existing._id.toString());
  assert.equal(result.queuePosition, 3);
  assert.equal(result.reusedExisting, true);
  assert.equal(result.updatedExisting, true);
  assert.equal(
    result.queueRequest.createdAt.toISOString(),
    createdAt.toISOString(),
  );
  assert.equal(result.queueRequest.sourceSurface, 'rest/ingest/start');
  assert.deepEqual(result.queueRequest.requestPayload, {
    model: 'nomic-embed',
    embeddingProvider: 'lmstudio',
    embeddingModel: 'nomic-embed',
  });
  assert.equal(waitingUpdateMock.mock.calls.length, 1);
});

test('duplicate-key retry interleaving preserves a waiting start row and returns updatedExisting false for a later reembed submit', async () => {
  const created = createQueueRequest();
  let waitingRequest: IngestQueueRequest | null = null;
  let waitingLookupCount = 0;
  let createCallCount = 0;
  let guardedRetryUpdateCount = 0;
  let releaseFirstCreate: (() => void) | null = null;
  const firstCreateGate = new Promise<void>((resolve) => {
    releaseFirstCreate = resolve;
  });

  mock.method(
    IngestQueueRequestModel,
    'findOneAndUpdate',
    (
      filter: Record<string, unknown>,
      update: { $set: Record<string, unknown> },
    ) => {
      if (filter.queueState !== 'waiting') {
        return { exec: async () => null };
      }

      waitingLookupCount += 1;
      if (!waitingRequest) {
        return { exec: async () => null };
      }

      if (filter.operation === 'reembed' && waitingRequest.operation === 'start') {
        guardedRetryUpdateCount += 1;
        return { exec: async () => null };
      }

      waitingRequest = createQueueRequest({
        ...waitingRequest,
        operation: update.$set.operation as IngestQueueRequest['operation'],
        requestPayload: update.$set.requestPayload as Record<string, unknown>,
        updatedAt: new Date('2026-01-01T00:15:00.000Z'),
      });
      return { exec: async () => waitingRequest };
    },
  );
  mock.method(
    IngestQueueRequestModel,
    'findOne',
    (filter: {
      canonicalTargetPath?: string;
      queueState?: string | { $in?: string[] };
    }) => {
      if (filter.queueState === 'waiting') {
        return {
          sort: () => ({
            exec: async () => waitingRequest,
          }),
        };
      }
      return {
        sort: () => ({
          exec: async () => null,
        }),
      };
    },
  );
  mock.method(
    IngestQueueRequestModel,
    'create',
    async (doc: Record<string, unknown>) => {
      createCallCount += 1;
      if (createCallCount === 1) {
        await firstCreateGate;
        waitingRequest = createQueueRequest({
          ...created,
          canonicalTargetPath: doc.canonicalTargetPath as string,
          operation: doc.operation as IngestQueueRequest['operation'],
          requestPayload: doc.requestPayload as Record<string, unknown>,
          sourceSurface: doc.sourceSurface as string,
          runId: null,
        });
        return waitingRequest;
      }

      releaseFirstCreate?.();
      const error = new Error('duplicate waiting queue row');
      (error as Error & { code?: number }).code = 11000;
      throw error;
    },
  );
  mock.method(IngestQueueRequestModel, 'countDocuments', () => ({
    exec: async () => 0,
  }));

  const firstInput = buildInput({
    requestPayload: {
      model: 'embed-first',
      embeddingProvider: 'lmstudio',
      embeddingModel: 'embed-first',
    },
    sourceSurface: 'rest/ingest/start',
  });
  const secondInput = buildInput({
    operation: 'reembed',
    requestPayload: {
      model: 'embed-second',
      embeddingProvider: 'openai',
      embeddingModel: 'embed-second',
    },
    sourceSurface: 'rest/ingest/reembed',
  });

  const [firstResult, secondResult] = await Promise.all([
    enqueueOrReuseIngestRequest(firstInput),
    enqueueOrReuseIngestRequest(secondInput),
  ]);

  assert.equal(waitingLookupCount, 2);
  assert.equal(firstResult.requestId, created._id.toString());
  assert.equal(secondResult.requestId, created._id.toString());
  assert.equal(firstResult.updatedExisting, false);
  assert.equal(secondResult.updatedExisting, false);
  assert.equal(secondResult.queuePosition, 1);
  assert.equal(guardedRetryUpdateCount, 1);
  assert.equal(secondResult.queueRequest.operation, 'start');
  assert.equal(secondResult.queueRequest.sourceSurface, 'rest/ingest/start');
  assert.deepEqual(secondResult.queueRequest.requestPayload, {
    model: 'embed-first',
    embeddingProvider: 'lmstudio',
    embeddingModel: 'embed-first',
  });
});

test('running duplicate reuse returns the existing running queue item without mutating active settings', async () => {
  const running = createQueueRequest({
    queueState: 'running',
    operation: 'start',
    runId: '00000000-0000-0000-0000-000000000321',
    requestPayload: {
      model: 'openai/text-embedding-3-small',
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
    },
  });

  mock.method(IngestQueueRequestModel, 'findOneAndUpdate', () => ({
    exec: async () => null,
  }));
  const runningLookupMock = mock.method(
    IngestQueueRequestModel,
    'findOne',
    (filter: { queueState?: string | { $in?: string[] } }) => {
      if (filter.queueState === 'waiting') {
        return {
          sort: () => ({
            exec: async () => null,
          }),
        };
      }

      return {
        sort: () => ({
          exec: async () => running,
        }),
      };
    },
  );

  const result = await enqueueOrReuseIngestRequest(
    buildInput({
      operation: 'reembed',
      requestPayload: {
        model: 'nomic-embed',
        embeddingProvider: 'lmstudio',
        embeddingModel: 'nomic-embed',
      },
    }),
  );

  assert.equal(result.requestId, running._id.toString());
  assert.equal(result.queueState, 'running');
  assert.equal(result.queuePosition, null);
  assert.equal(result.runId, '00000000-0000-0000-0000-000000000321');
  assert.equal(result.updatedExisting, false);
  assert.deepEqual(result.queueRequest.requestPayload, {
    model: 'openai/text-embedding-3-small',
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
  });
  assert.equal(runningLookupMock.mock.calls.length, 2);
});

test('cleanup-blocked duplicate reuse returns the blocked queue item instead of creating a later waiting owner', async () => {
  const blocked = createQueueRequest({
    queueState: 'cleanup-blocked',
    operation: 'start',
    runId: '00000000-0000-0000-0000-000000000654',
    requestPayload: {
      model: 'openai/text-embedding-3-small',
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
    },
  });

  mock.method(IngestQueueRequestModel, 'findOneAndUpdate', () => ({
    exec: async () => null,
  }));
  const liveLookupMock = mock.method(
    IngestQueueRequestModel,
    'findOne',
    (filter: { queueState?: string | { $in?: string[] } }) => {
      if (filter.queueState === 'waiting') {
        return {
          sort: () => ({
            exec: async () => null,
          }),
        };
      }

      return {
        sort: () => ({
          exec: async () => blocked,
        }),
      };
    },
  );
  const createMock = mock.method(
    IngestQueueRequestModel,
    'create',
    async () => {
      throw new Error('cleanup-blocked duplicate should not create a new row');
    },
  );

  const result = await enqueueOrReuseIngestRequest(
    buildInput({
      operation: 'reembed',
      requestPayload: {
        model: 'nomic-embed',
        embeddingProvider: 'lmstudio',
        embeddingModel: 'nomic-embed',
      },
    }),
  );

  assert.equal(result.requestId, blocked._id.toString());
  assert.equal(result.queueState, 'cleanup-blocked');
  assert.equal(result.queuePosition, null);
  assert.equal(result.runId, '00000000-0000-0000-0000-000000000654');
  assert.equal(result.updatedExisting, false);
  assert.deepEqual(result.queueRequest.requestPayload, {
    model: 'openai/text-embedding-3-small',
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
  });
  assert.equal(liveLookupMock.mock.calls.length, 2);
  assert.equal(createMock.mock.calls.length, 0);
});

test('waiting queue position counts only older waiting items and uses countDocuments instead of loading the full queue', async () => {
  const waiting = createQueueRequest({
    createdAt: new Date('2026-01-01T00:00:05.000Z'),
  });
  mock.method(IngestQueueRequestModel, 'findOneAndUpdate', () => ({
    exec: async () => waiting,
  }));
  const findOneMock = mock.method(IngestQueueRequestModel, 'findOne', () => ({
    sort: () => ({
      exec: async () => null,
    }),
  }));
  const countMock = mock.method(
    IngestQueueRequestModel,
    'countDocuments',
    (filter: { queueState: string; $or: Array<Record<string, unknown>> }) => {
      assert.equal(filter.queueState, 'waiting');
      assert.deepEqual(filter.$or, [
        { createdAt: { $lt: waiting.createdAt } },
        {
          createdAt: waiting.createdAt,
          _id: { $lt: waiting._id },
        },
      ]);

      return {
        exec: async () => 4,
      };
    },
  );
  const findMock = mock.method(IngestQueueRequestModel, 'find', () => {
    throw new Error('queue position should not load the full queue');
  });

  const result = await enqueueOrReuseIngestRequest(buildInput());

  assert.equal(result.queuePosition, 5);
  assert.equal(findOneMock.mock.calls.length, 1);
  assert.equal(countMock.mock.calls.length, 1);
  assert.equal(findMock.mock.calls.length, 0);
});
