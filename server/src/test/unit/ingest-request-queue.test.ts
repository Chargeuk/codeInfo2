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
    exec: async () => null,
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

test('canonical queue-target normalization collapses start-ingest and re-embed aliases onto one queue identity', async () => {
  const canonicalStartTarget =
    normalizeCanonicalQueueTargetPath('/data/example/');
  const canonicalReembedTarget =
    normalizeCanonicalQueueTargetPath('/data//example');
  const existing = createQueueRequest({
    canonicalTargetPath: canonicalStartTarget,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:05:00.000Z'),
  });

  const waitingUpdateMock = mock.method(
    IngestQueueRequestModel,
    'findOneAndUpdate',
    (filter: { canonicalTargetPath: string }) => {
      assert.equal(filter.canonicalTargetPath, canonicalStartTarget);
      return { exec: async () => existing };
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
  assert.equal(waitingUpdateMock.mock.calls.length, 1);
});

test('waiting duplicate reuse preserves queue identity and provenance while replacing the normalized payload', async () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const updatedAt = new Date('2026-01-01T00:10:00.000Z');
  const existing = createQueueRequest({
    createdAt,
    updatedAt,
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
    () => ({
      exec: async () => running,
    }),
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
  assert.equal(runningLookupMock.mock.calls.length, 1);
});

test('waiting queue position counts only older waiting items and uses countDocuments instead of loading the full queue', async () => {
  const waiting = createQueueRequest({
    createdAt: new Date('2026-01-01T00:00:05.000Z'),
  });
  mock.method(IngestQueueRequestModel, 'findOneAndUpdate', () => ({
    exec: async () => waiting,
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
  assert.equal(countMock.mock.calls.length, 1);
  assert.equal(findMock.mock.calls.length, 0);
});
