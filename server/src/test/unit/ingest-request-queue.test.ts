import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import mongoose from 'mongoose';
import { normalizeCanonicalQueueTargetPath } from '../../ingest/requestContracts.js';
import {
  enqueueOrReuseIngestRequest,
  type EnqueueIngestRequestInput,
} from '../../ingest/requestQueue.js';
import {
  ingestLiveQueueTargetStates,
  IngestQueueRequestModel,
  type IngestQueueRequest,
} from '../../mongo/ingestQueueRequest.js';

type QueueIndexFields = Record<string, 1 | -1>;
type QueueStateFilter = string | { $in?: readonly string[] };

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
    nonReplayableAt: overrides.nonReplayableAt ?? null,
    terminalPublishedAt: overrides.terminalPublishedAt ?? null,
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

function assertLiveTargetQueueStateFilter(filter: {
  queueState?: QueueStateFilter;
}) {
  assert.deepEqual(filter.queueState, {
    $in: [...ingestLiveQueueTargetStates],
  });
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

test('ingest queue model registers live-target partial unique index and FIFO indexes', () => {
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
  const liveTargetIndex = indexes.find(
    ([fields, options]: [QueueIndexFields, Record<string, unknown>]) =>
      fields.canonicalTargetPath === 1 &&
      options.unique === true &&
      options.name === 'ingest_queue_live_target_unique_idx',
  );
  assert.ok(liveTargetIndex, 'expected live-target unique index');
  const [, liveTargetOptions] = liveTargetIndex as [
    QueueIndexFields,
    Record<string, unknown>,
  ];
  const partialFilter = liveTargetOptions.partialFilterExpression as
    | { queueState?: { $in?: readonly string[] } }
    | undefined;
  assert.deepEqual(partialFilter?.queueState?.$in, [
    ...ingestLiveQueueTargetStates,
  ]);
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

test('canonical queue-target normalization still rewrites a waiting start row in place after the helper-arity fix', async () => {
  const canonicalStartTarget =
    normalizeCanonicalQueueTargetPath('/data/example/');
  const canonicalReembedTarget =
    normalizeCanonicalQueueTargetPath('/data//example');
  const refreshedUpdatedAt = new Date('2026-01-01T00:10:00.000Z');
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
    (
      filter: Record<string, unknown>,
      update: { $set: Record<string, unknown> },
    ) => {
      assert.deepEqual(filter, {
        _id: existing._id,
        canonicalTargetPath: canonicalStartTarget,
        queueState: 'waiting',
      });
      assert.deepEqual(update, {
        $set: {
          operation: 'reembed',
          requestPayload: {
            model: 'openai/text-embedding-3-small',
            embeddingProvider: 'openai',
            embeddingModel: 'text-embedding-3-small',
          },
        },
      });

      return {
        exec: async () =>
          createQueueRequest({
            ...existing,
            operation: 'reembed',
            requestPayload: {
              model: 'openai/text-embedding-3-small',
              embeddingProvider: 'openai',
              embeddingModel: 'text-embedding-3-small',
            },
            updatedAt: refreshedUpdatedAt,
          }),
      };
    },
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
  assert.equal(result.reusedExisting, true);
  assert.equal(result.updatedExisting, true);
  assert.equal(result.queueRequest.operation, 'reembed');
  assert.deepEqual(result.queueRequest.requestPayload, {
    model: 'openai/text-embedding-3-small',
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
  });
  assert.equal(waitingLookupMock.mock.calls.length, 1);
  assert.equal(waitingUpdateMock.mock.calls.length, 1);
});

test('reembed duplicate sees current running semantics when a waiting start row is promoted before reuse response assembly', async () => {
  const waitingSnapshot = createQueueRequest({
    operation: 'start',
    queueState: 'waiting',
    runId: null,
    requestPayload: {
      model: 'queued-start-model',
      embeddingProvider: 'lmstudio',
      embeddingModel: 'queued-start-model',
    },
  });
  const promotedRunning = createQueueRequest({
    ...waitingSnapshot,
    queueState: 'running',
    runId: '00000000-0000-0000-0000-000000000777',
  });

  const findOneMock = mock.method(
    IngestQueueRequestModel,
    'findOne',
    (filter: { queueState?: QueueStateFilter }) => {
      if (filter.queueState === 'waiting') {
        return {
          sort: () => ({
            exec: async () => waitingSnapshot,
          }),
        };
      }

      return {
        sort: () => ({
          exec: async () => promotedRunning,
        }),
      };
    },
  );
  const waitingUpdateMock = mock.method(
    IngestQueueRequestModel,
    'findOneAndUpdate',
    () => ({
      exec: async () => null,
    }),
  );
  const countMock = mock.method(
    IngestQueueRequestModel,
    'countDocuments',
    () => ({
      exec: async () => {
        throw new Error('promoted running reuse should not count waiting rows');
      },
    }),
  );

  const result = await enqueueOrReuseIngestRequest(
    buildInput({
      operation: 'reembed',
      requestPayload: {
        model: 'queued-reembed-model',
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
      },
      sourceSurface: 'rest/ingest/reembed',
    }),
  );

  assert.equal(result.requestId, promotedRunning._id.toString());
  assert.equal(result.queueState, 'running');
  assert.equal(result.queuePosition, null);
  assert.equal(result.runId, '00000000-0000-0000-0000-000000000777');
  assert.equal(result.reusedExisting, true);
  assert.equal(result.updatedExisting, false);
  assert.deepEqual(result.queueRequest.requestPayload, {
    model: 'queued-start-model',
    embeddingProvider: 'lmstudio',
    embeddingModel: 'queued-start-model',
  });
  assert.equal(findOneMock.mock.calls.length, 2);
  assert.equal(waitingUpdateMock.mock.calls.length, 1);
  assert.equal(countMock.mock.calls.length, 0);
});

test('start duplicate sees current running semantics when a waiting row is promoted before rewrite response assembly', async () => {
  const waitingSnapshot = createQueueRequest({
    operation: 'start',
    queueState: 'waiting',
    runId: null,
  });
  const promotedRunning = createQueueRequest({
    ...waitingSnapshot,
    queueState: 'running',
    runId: '00000000-0000-0000-0000-000000000778',
  });

  let waitingLookupCount = 0;
  let liveLookupCount = 0;
  const findOneMock = mock.method(
    IngestQueueRequestModel,
    'findOne',
    (filter: { queueState?: string | { $in?: string[] } }) => {
      if (filter.queueState === 'waiting') {
        return {
          sort: () => ({
            exec: async () => {
              waitingLookupCount += 1;
              return waitingSnapshot;
            },
          }),
        };
      }

      return {
        sort: () => ({
          exec: async () => {
            liveLookupCount += 1;
            return promotedRunning;
          },
        }),
      };
    },
  );
  const waitingUpdateMock = mock.method(
    IngestQueueRequestModel,
    'findOneAndUpdate',
    () => ({
      exec: async () => null,
    }),
  );
  const countMock = mock.method(
    IngestQueueRequestModel,
    'countDocuments',
    () => ({
      exec: async () => {
        throw new Error('promoted running reuse should not count waiting rows');
      },
    }),
  );

  const result = await enqueueOrReuseIngestRequest(
    buildInput({
      operation: 'start',
      requestPayload: {
        model: 'queued-start-model',
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
      },
      sourceSurface: 'rest/ingest/start',
    }),
  );

  assert.equal(result.requestId, promotedRunning._id.toString());
  assert.equal(result.queueState, 'running');
  assert.equal(result.queuePosition, null);
  assert.equal(result.runId, '00000000-0000-0000-0000-000000000778');
  assert.equal(result.reusedExisting, true);
  assert.equal(result.updatedExisting, false);
  assert.equal(waitingLookupCount, 1);
  assert.equal(liveLookupCount, 1);
  assert.equal(findOneMock.mock.calls.length, 2);
  assert.equal(waitingUpdateMock.mock.calls.length, 1);
  assert.equal(countMock.mock.calls.length, 0);
});

test('observed waiting-row rewrite-or-reuse race refuses to replay stale intent onto a newer waiting row', async () => {
  const observed = createQueueRequest({
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:05:00.000Z'),
    requestPayload: {
      model: 'old-observed-model',
      embeddingProvider: 'lmstudio',
      embeddingModel: 'old-observed-model',
    },
  });
  const newerWaiting = createQueueRequest({
    _id: new mongoose.Types.ObjectId('000000000000000000000042'),
    createdAt: new Date('2026-01-01T00:01:00.000Z'),
    updatedAt: new Date('2026-01-01T00:06:00.000Z'),
    operation: 'start',
    requestPayload: {
      model: 'newer-waiting-model',
      embeddingProvider: 'openai',
      embeddingModel: 'newer-waiting-model',
    },
  });
  let waitingLookupCount = 0;

  const waitingLookupMock = mock.method(
    IngestQueueRequestModel,
    'findOne',
    (filter: { queueState?: string | { $in?: string[] } }) => {
      if (filter.queueState === 'waiting') {
        return {
          sort: () => ({
            exec: async () => {
              waitingLookupCount += 1;
              return waitingLookupCount === 1 ? observed : null;
            },
          }),
        };
      }

      return {
        sort: () => ({
          exec: async () => newerWaiting,
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
        _id: observed._id,
        canonicalTargetPath: '/data/example',
        queueState: 'waiting',
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
    exec: async () => 1,
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

  assert.equal(result.requestId, newerWaiting._id.toString());
  assert.equal(result.queueRequest.operation, 'start');
  assert.deepEqual(result.queueRequest.requestPayload, {
    model: 'newer-waiting-model',
    embeddingProvider: 'openai',
    embeddingModel: 'newer-waiting-model',
  });
  assert.equal(result.queuePosition, 2);
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

test('observed waiting-row rewrite preserves queue identity metadata and reports updatedExisting true', async () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const priorUpdatedAt = new Date('2026-01-01T00:10:00.000Z');
  const refreshedUpdatedAt = new Date('2026-01-01T00:15:00.000Z');
  const existing = createQueueRequest({
    createdAt,
    updatedAt: priorUpdatedAt,
    operation: 'start',
    requestPayload: {
      model: 'queued-start-model',
      embeddingProvider: 'lmstudio',
      embeddingModel: 'queued-start-model',
    },
    sourceSurface: 'rest/ingest/start',
  });

  const waitingUpdateMock = mock.method(
    IngestQueueRequestModel,
    'findOneAndUpdate',
    (
      filter: Record<string, unknown>,
      update: { $set: Record<string, unknown> },
    ) => {
      assert.deepEqual(filter, {
        _id: existing._id,
        canonicalTargetPath: '/data/example',
        queueState: 'waiting',
      });
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
            updatedAt: refreshedUpdatedAt,
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
  assert.notEqual(
    result.queueRequest.updatedAt.toISOString(),
    priorUpdatedAt.toISOString(),
  );
  assert.equal(
    result.queueRequest.updatedAt.toISOString(),
    refreshedUpdatedAt.toISOString(),
  );
  assert.equal(result.queueRequest.sourceSurface, 'rest/ingest/start');
  assert.equal(result.queueRequest.operation, 'reembed');
  assert.deepEqual(result.queueRequest.requestPayload, {
    model: 'nomic-embed',
    embeddingProvider: 'lmstudio',
    embeddingModel: 'nomic-embed',
  });
  assert.equal(waitingUpdateMock.mock.calls.length, 1);
});

test('duplicate-key retry resolves the observed waiting-row rewrite without an impossible third branch', async () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const existing = createQueueRequest({
    createdAt,
    updatedAt: new Date('2026-01-01T00:05:00.000Z'),
    sourceSurface: 'rest/ingest/start',
  });
  const rewritten = createQueueRequest({
    ...existing,
    operation: 'reembed',
    requestPayload: {
      model: 'embed-second',
      embeddingProvider: 'openai',
      embeddingModel: 'embed-second',
    },
    updatedAt: new Date('2026-01-01T00:10:00.000Z'),
  });
  let waitingLookupCount = 0;
  let liveLookupCount = 0;
  const waitingUpdateMock = mock.method(
    IngestQueueRequestModel,
    'findOneAndUpdate',
    (
      filter: Record<string, unknown>,
      update: { $set: Record<string, unknown> },
    ) => {
      assert.deepEqual(filter, {
        _id: existing._id,
        canonicalTargetPath: '/data/example',
        queueState: 'waiting',
      });
      assert.deepEqual(update, {
        $set: {
          operation: 'reembed',
          requestPayload: {
            model: 'embed-second',
            embeddingProvider: 'openai',
            embeddingModel: 'embed-second',
          },
        },
      });

      return {
        exec: async () => (waitingLookupCount >= 2 ? rewritten : null),
      };
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
        waitingLookupCount += 1;
        return {
          sort: () => ({
            exec: async () => (waitingLookupCount >= 2 ? existing : null),
          }),
        };
      }
      return {
        sort: () => ({
          exec: async () => {
            liveLookupCount += 1;
            return null;
          },
        }),
      };
    },
  );
  const createMock = mock.method(
    IngestQueueRequestModel,
    'create',
    async () => {
      const error = new Error('duplicate waiting queue row');
      (error as Error & { code?: number }).code = 11000;
      throw error;
    },
  );
  mock.method(IngestQueueRequestModel, 'countDocuments', () => ({
    exec: async () => 0,
  }));

  const result = await enqueueOrReuseIngestRequest(
    buildInput({
      operation: 'reembed',
      requestPayload: {
        model: 'embed-second',
        embeddingProvider: 'openai',
        embeddingModel: 'embed-second',
      },
      sourceSurface: 'rest/ingest/reembed',
    }),
  );

  assert.equal(waitingLookupCount, 2);
  assert.equal(liveLookupCount, 1);
  assert.equal(createMock.mock.calls.length, 1);
  assert.equal(waitingUpdateMock.mock.calls.length, 1);
  assert.equal(result.requestId, existing._id.toString());
  assert.equal(result.updatedExisting, true);
  assert.equal(result.queuePosition, 1);
  assert.equal(result.queueRequest.operation, 'reembed');
  assert.equal(result.queueRequest.sourceSurface, 'rest/ingest/start');
  assert.deepEqual(result.queueRequest.requestPayload, {
    model: 'embed-second',
    embeddingProvider: 'openai',
    embeddingModel: 'embed-second',
  });
});

test('duplicate-key retry refuses to replay stale intent onto a newer waiting row after the observed row disappears', async () => {
  const observed = createQueueRequest({
    _id: new mongoose.Types.ObjectId('000000000000000000000051'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:05:00.000Z'),
    requestPayload: {
      model: 'observed-start-model',
      embeddingProvider: 'lmstudio',
      embeddingModel: 'observed-start-model',
    },
  });
  const newerWaiting = createQueueRequest({
    _id: new mongoose.Types.ObjectId('000000000000000000000052'),
    createdAt: new Date('2026-01-01T00:01:00.000Z'),
    updatedAt: new Date('2026-01-01T00:06:00.000Z'),
    requestPayload: {
      model: 'newer-start-model',
      embeddingProvider: 'openai',
      embeddingModel: 'newer-start-model',
    },
  });
  let waitingLookupCount = 0;
  let liveLookupCount = 0;
  const waitingUpdateMock = mock.method(
    IngestQueueRequestModel,
    'findOneAndUpdate',
    (
      filter: Record<string, unknown>,
      update: { $set: Record<string, unknown> },
    ) => {
      assert.deepEqual(filter, {
        _id: observed._id,
        canonicalTargetPath: '/data/example',
        queueState: 'waiting',
      });
      assert.deepEqual(update, {
        $set: {
          operation: 'reembed',
          requestPayload: {
            model: 'stale-reembed-model',
            embeddingProvider: 'openai',
            embeddingModel: 'stale-reembed-model',
          },
        },
      });

      return {
        exec: async () => null,
      };
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
        waitingLookupCount += 1;
        return {
          sort: () => ({
            exec: async () => (waitingLookupCount === 1 ? null : observed),
          }),
        };
      }

      assertLiveTargetQueueStateFilter(filter);
      return {
        sort: () => ({
          exec: async () => {
            liveLookupCount += 1;
            return liveLookupCount === 1 ? null : newerWaiting;
          },
        }),
      };
    },
  );
  const createMock = mock.method(
    IngestQueueRequestModel,
    'create',
    async () => {
      const error = new Error('duplicate waiting queue row');
      (error as Error & { code?: number }).code = 11000;
      throw error;
    },
  );
  mock.method(IngestQueueRequestModel, 'countDocuments', () => ({
    exec: async () => 1,
  }));

  const result = await enqueueOrReuseIngestRequest(
    buildInput({
      operation: 'reembed',
      requestPayload: {
        model: 'stale-reembed-model',
        embeddingProvider: 'openai',
        embeddingModel: 'stale-reembed-model',
      },
      sourceSurface: 'rest/ingest/reembed',
    }),
  );

  assert.equal(waitingLookupCount, 2);
  assert.equal(liveLookupCount, 2);
  assert.equal(createMock.mock.calls.length, 1);
  assert.equal(waitingUpdateMock.mock.calls.length, 1);
  assert.equal(result.requestId, newerWaiting._id.toString());
  assert.equal(result.updatedExisting, false);
  assert.equal(result.queuePosition, 2);
  assert.equal(result.queueRequest.operation, 'start');
  assert.deepEqual(result.queueRequest.requestPayload, {
    model: 'newer-start-model',
    embeddingProvider: 'openai',
    embeddingModel: 'newer-start-model',
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

  const waitingUpdateMock = mock.method(
    IngestQueueRequestModel,
    'findOneAndUpdate',
    () => ({
      exec: async () => null,
    }),
  );
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

      assertLiveTargetQueueStateFilter(filter);
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
  assert.equal(waitingUpdateMock.mock.calls.length, 0);
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

  const waitingUpdateMock = mock.method(
    IngestQueueRequestModel,
    'findOneAndUpdate',
    () => ({
      exec: async () => null,
    }),
  );
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
  assert.equal(waitingUpdateMock.mock.calls.length, 0);
});

test('waiting queue position counts only older waiting items and uses countDocuments instead of loading the full queue', async () => {
  const waiting = createQueueRequest({
    createdAt: new Date('2026-01-01T00:00:05.000Z'),
  });
  const findOneMock = mock.method(IngestQueueRequestModel, 'findOne', () => ({
    sort: () => ({
      exec: async () => null,
    }),
  }));
  const createMock = mock.method(
    IngestQueueRequestModel,
    'create',
    async () => waiting,
  );
  const waitingUpdateMock = mock.method(
    IngestQueueRequestModel,
    'findOneAndUpdate',
    () => ({
      exec: async () => null,
    }),
  );
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
  assert.equal(findOneMock.mock.calls.length, 2);
  assert.equal(createMock.mock.calls.length, 1);
  assert.equal(waitingUpdateMock.mock.calls.length, 0);
  assert.equal(countMock.mock.calls.length, 1);
  assert.equal(findMock.mock.calls.length, 0);
});
