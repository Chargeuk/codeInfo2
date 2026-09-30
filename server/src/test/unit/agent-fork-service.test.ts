import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { type TestContext } from 'node:test';
import mongoose from 'mongoose';
import { ForkError } from '../../agents/forkHistory.js';
import { FORK_LEASE_MS, FORK_LEASE_RENEW_MS } from '../../agents/forkLease.js';
import {
  executeFork,
  forkAgentConversation,
  type ForkServiceDeps,
} from '../../agents/forkService.js';
import {
  getActiveRunOwnership,
  releaseConversationLock,
  tryAcquireConversationLock,
} from '../../agents/runLock.js';
import {
  ConversationModel,
  type Conversation,
} from '../../mongo/conversation.js';
import { onConversationUpsert } from '../../mongo/events.js';
import {
  ForkOperationModel,
  ForkSnapshotModel,
  type ForkOperation,
  type ForkSnapshot,
} from '../../mongo/forkOperation.js';
import { listAllTurns, type TurnSummary } from '../../mongo/repo.js';
import { TurnModel } from '../../mongo/turn.js';

const query = <T>(value: T) => ({ lean: () => ({ exec: async () => value }) });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const awaitGate = (gate: Promise<void>, operation: Promise<unknown>) =>
  Promise.race([
    gate,
    operation.then(() => {
      throw new Error('Fork finished before reaching the expected test gate');
    }),
  ]);
function harness(t: TestContext, provider: 'codex' | 'copilot' = 'codex') {
  const sourceId = crypto.randomUUID();
  const source: Conversation = {
    _id: sourceId,
    provider,
    agentName: 'source_agent',
    model: 'historic-model',
    title: 'Source title',
    flags: {
      threadId: 'native-source',
      workingFolder: '/shared/folder',
      flow: { active: true },
    },
    source: 'REST',
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastMessageAt: new Date(),
  };
  const rows: TurnSummary[] = [
    {
      turnId: 'user-id',
      conversationId: sourceId,
      role: 'user',
      content: 'Prompt',
      provider,
      model: 'historic-model',
      status: 'ok',
      source: 'REST',
      toolCalls: null,
      createdAt: new Date(1),
    },
    {
      turnId: 'assistant-id',
      conversationId: sourceId,
      role: 'assistant',
      content: 'Answer',
      provider,
      model: 'historic-model',
      status: 'ok',
      source: 'REST',
      toolCalls: { calls: [{ result: 'tool result' }] },
      createdAt: new Date(2),
      native: { sessionId: 'native-source', turnId: 'native-turn' },
    },
    {
      turnId: 'later-id',
      conversationId: sourceId,
      role: 'user',
      content: 'Later active prompt',
      provider,
      model: 'historic-model',
      status: 'ok',
      source: 'REST',
      toolCalls: null,
      createdAt: new Date(3),
    },
  ];
  const operations = new Map<string, ForkOperation>();
  const snapshots = new Map<string, ForkSnapshot>();
  const conversations = new Map<string, Conversation>();
  const copied = new Map<string, Record<string, unknown>>();
  const injected = new Set<string>();
  let nativeForks = 0;
  let removed = 0;
  let deletedSource = false;
  let failCopy = false;
  let failSnapshot = false;
  let failFork = false;
  let forkConfig: unknown;
  let largestSnapshotRecord = 0;
  let failPublicationCommit = false;
  let failPublicationAck = false;
  let publicationGate: (() => Promise<void>) | undefined;
  let forkBoundary: string | undefined;
  const state = { operations, snapshots, conversations, copied };
  type State = typeof state;
  const transactionStates = new WeakMap<mongoose.ClientSession, State>();
  const data = (options?: { session?: mongoose.ClientSession }) =>
    options?.session ? transactionStates.get(options.session)! : state;
  const matches = (
    value: ForkOperation,
    filter: Record<string, unknown>,
  ): boolean =>
    Object.entries(filter).every(([key, expected]) => {
      if (key === '$or')
        return (expected as Record<string, unknown>[]).some((part) =>
          matches(value, part),
        );
      const actual = (value as unknown as Record<string, unknown>)[key];
      if (
        expected &&
        typeof expected === 'object' &&
        !(expected instanceof Date)
      ) {
        const rule = expected as Record<string, unknown>;
        if ('$exists' in rule) return (actual !== undefined) === rule.$exists;
        if ('$in' in rule) return (rule.$in as unknown[]).includes(actual);
        if ('$gt' in rule)
          return (
            Object.prototype.toString.call(actual) === '[object Date]' &&
            (actual as Date).getTime() > (rule.$gt as Date).getTime()
          );
        if ('$lt' in rule)
          return (
            Object.prototype.toString.call(actual) === '[object Date]' &&
            (actual as Date).getTime() < (rule.$lt as Date).getTime()
          );
      }
      return actual === expected;
    });
  t.mock.method(
    mongoose.connection,
    'transaction',
    async (work: (session: mongoose.ClientSession) => Promise<unknown>) => {
      const session = {} as mongoose.ClientSession;
      const staged: State = structuredClone(state);
      const original = structuredClone(operations);
      transactionStates.set(session, staged);
      try {
        const result = await work(session);
        const publishes = [...staged.operations.values()].some(
          (op) =>
            op.phase === 'ready' && original.get(op._id)?.phase !== 'ready',
        );
        if (publishes) {
          await publicationGate?.();
          if (failPublicationCommit) {
            failPublicationCommit = false;
            throw new Error('Publication commit failed');
          }
        }
        for (const [id, op] of original) {
          const current = operations.get(id)!;
          if (
            current.owner !== op.owner ||
            current.phase !== op.phase ||
            current.leaseUntil?.getTime() !== op.leaseUntil?.getTime()
          )
            throw new Error('Mock transaction write conflict');
        }
        for (const key of [
          'operations',
          'snapshots',
          'conversations',
          'copied',
        ] as const) {
          state[key].clear();
          for (const [id, value] of staged[key])
            (state[key] as Map<string, unknown>).set(id, value);
        }
        if (publishes && failPublicationAck) {
          failPublicationAck = false;
          throw new Error('Publication acknowledgement lost');
        }
        return result;
      } finally {
        transactionStates.delete(session);
      }
    },
  );
  t.mock.method(ForkOperationModel, 'findById', (id: string) =>
    query(operations.has(id) ? structuredClone(operations.get(id)) : null),
  );
  t.mock.method(ForkOperationModel, 'create', async (value: ForkOperation) => {
    if (operations.has(value._id))
      throw Object.assign(new Error('Duplicate operation'), { code: 11000 });
    operations.set(value._id, structuredClone(value));
    return value;
  });
  t.mock.method(
    ForkSnapshotModel,
    'bulkWrite',
    async (
      writes: Array<{ updateOne: { update: { $setOnInsert: ForkSnapshot } } }>,
      options?: { session?: mongoose.ClientSession },
    ) => {
      const records = data(options).snapshots;
      for (const write of writes) {
        const record = write.updateOne.update.$setOnInsert;
        largestSnapshotRecord = Math.max(
          largestSnapshotRecord,
          Buffer.byteLength(JSON.stringify(record)),
        );
        if (!records.has(record._id))
          records.set(record._id, structuredClone(record));
        if (failSnapshot) {
          failSnapshot = false;
          throw new Error('Partial frozen snapshot');
        }
      }
      return { acknowledged: true };
    },
  );
  t.mock.method(
    ForkSnapshotModel,
    'find',
    (filter: { operationId: string }) => ({
      sort: () =>
        query(
          [...snapshots.values()]
            .filter((row) => row.operationId === filter.operationId)
            .sort((a, b) => a.index - b.index),
        ),
    }),
  );
  t.mock.method(
    ForkSnapshotModel,
    'deleteMany',
    async (
      filter: { operationId: string },
      options?: { session?: mongoose.ClientSession },
    ) => {
      const records = data(options).snapshots;
      for (const [key, row] of records)
        if (row.operationId === filter.operationId) records.delete(key);
      return { deletedCount: 1 };
    },
  );
  t.mock.method(
    ForkOperationModel,
    'findOneAndUpdate',
    (
      filter: Record<string, unknown>,
      update: { $set: Partial<ForkOperation> },
      options?: { new?: boolean },
    ) => {
      const value = operations.get(String(filter._id));
      if (!value || !matches(value, filter)) return query(null);
      const previous = structuredClone(value);
      Object.assign(value, update.$set);
      return query(options?.new === false ? previous : structuredClone(value));
    },
  );
  t.mock.method(
    ForkOperationModel,
    'updateOne',
    async (
      filter: Record<string, unknown>,
      update: {
        $set?: Partial<ForkOperation>;
        $unset?: Record<string, unknown>;
      },
      options?: { session?: mongoose.ClientSession },
    ) => {
      const value = data(options).operations.get(String(filter._id));
      if (!value || !matches(value, filter))
        return { acknowledged: true, matchedCount: 0 };
      if (update.$set) Object.assign(value, structuredClone(update.$set));
      for (const key of Object.keys(update.$unset ?? {}))
        delete (value as unknown as Record<string, unknown>)[key];
      return { acknowledged: true, matchedCount: 1 };
    },
  );
  t.mock.method(
    ConversationModel,
    'findById',
    (
      id: string,
      _projection?: unknown,
      options?: { session?: mongoose.ClientSession },
    ) =>
      query(
        id === sourceId
          ? deletedSource
            ? null
            : source
          : (data(options).conversations.get(id) ?? null),
      ),
  );
  t.mock.method(
    ConversationModel,
    'exists',
    async (filter: { _id: string; agentName: string; createdAt: Date }) => {
      const document =
        filter._id === sourceId
          ? deletedSource
            ? undefined
            : source
          : conversations.get(filter._id);
      return document &&
        document.agentName === filter.agentName &&
        document.createdAt.getTime() === filter.createdAt.getTime()
        ? { _id: document._id }
        : null;
    },
  );
  t.mock.method(
    ConversationModel,
    'findOneAndUpdate',
    (
      filter: { _id: string },
      update: { $setOnInsert: Conversation },
      options?: { session?: mongoose.ClientSession; timestamps?: boolean },
    ) => {
      assert.equal(options?.timestamps, false);
      const documents = data(options).conversations;
      if (!documents.has(filter._id))
        documents.set(filter._id, structuredClone(update.$setOnInsert));
      return query(documents.get(filter._id)!);
    },
  );
  t.mock.method(
    TurnModel,
    'bulkWrite',
    async (
      writes: Array<{
        updateOne: { update: { $setOnInsert: Record<string, unknown> } };
      }>,
      options?: { session?: mongoose.ClientSession },
    ) => {
      const records = data(options).copied;
      for (const write of writes) {
        const row = write.updateOne.update.$setOnInsert;
        if (!records.has(String(row._id))) records.set(String(row._id), row);
        if (failCopy) {
          failCopy = false;
          throw new Error('Partial Mongo copy');
        }
      }
      return { acknowledged: true };
    },
  );
  t.mock.method(
    TurnModel,
    'deleteMany',
    async (
      filter: { conversationId: string },
      options?: { session?: mongoose.ClientSession },
    ) => {
      const records = data(options).copied;
      for (const [id, row] of records)
        if (row.conversationId === filter.conversationId) records.delete(id);
      return { deletedCount: 1 };
    },
  );
  const repositoryContext = {
    selectedRepositoryPath: '/shared/folder',
    defaultExecutionRoot: '/shared/folder',
    workingDirectoryOverride: '/shared/folder',
    fallbackUsed: false,
    workingRepositoryAvailable: true,
  };
  const target: Awaited<ReturnType<ForkServiceDeps['prepareTarget']>> = {
    executionProviderId: provider,
    requestedProviderId: provider,
    modelId: 'target-model',
    prompt: 'Complete target prompt',
    runtimeConfig: {
      model: 'target-model',
      mcp_servers: { target_server: { command: 'target' } },
    },
    workingDirectoryOverride: '/shared/folder',
    warnings: [],
    copilotModels: [],
    availability: {
      requestedProviderId: provider,
      executionProviderId: provider,
      disabled: false,
      warnings: [],
      fallbackCandidates: [],
    },
    repositoryContext,
    executionContext: {
      selectedRepositoryPath: '/shared/folder',
      defaultExecutionRoot: '/shared/folder',
      repositoryMetadata: repositoryContext,
      runtime: { workingFolder: '/shared/folder' },
      workingDirectoryOverride: '/shared/folder',
    },
  };
  const deps: ForkServiceDeps = {
    removeOwnedNative: async () => {
      removed++;
    },
    loadSource: async () => source,
    prepareTarget: async () => target,
    listTurns: async () => ({ items: rows.slice().reverse() }),
    openNative: async () => ({
      turns: [
        {
          id: 'native-turn',
          user: 'Prompt',
          assistant: 'Answer',
          completed: true,
          nextEventId: 'later-native-event',
        },
      ],
      fork: async (boundary, config, model, cwd) => {
        forkBoundary = boundary.id;
        nativeForks++;
        forkConfig = { config, model, cwd };
        if (failFork) throw new Error('Provider acknowledgement lost');
        return 'native-child';
      },
      inject: async (_id, text) => {
        injected.add(text);
      },
      hasInjected: async (_id, text) => injected.has(text),
      remove: async () => {
        removed++;
      },
      close: async () => {},
    }),
  };
  const input = {
    sourceConversationId: sourceId,
    targetAgentName: 'target_agent',
    sourceTurnId: 'assistant-id',
    requestId: crypto.randomUUID(),
  };
  return {
    source,
    rows,
    input,
    deps,
    target,
    operations,
    snapshots,
    conversations,
    copied,
    injected,
    setFailCopy: () => {
      failCopy = true;
    },
    setFailSnapshot: () => {
      failSnapshot = true;
    },
    setFailFork: () => {
      failFork = true;
    },
    deleteSource: () => {
      deletedSource = true;
    },
    setFailPublicationCommit: () => {
      failPublicationCommit = true;
    },
    setFailPublicationAck: () => {
      failPublicationAck = true;
    },
    setPublicationGate: (gate: () => Promise<void>) => {
      publicationGate = gate;
    },
    runWorker: () =>
      executeFork(
        input,
        crypto.createHash('sha256').update(input.requestId).digest('hex'),
        deps,
      ),
    stats: () => ({
      nativeForks,
      removed,
      forkConfig,
      forkBoundary,
      largestSnapshotRecord,
    }),
  };
}

test('Codex flush is a publication gate: no conversation, broadcast, or delivered acknowledgement before close', async (t) => {
  const h = harness(t);
  let released!: () => void;
  let closing!: () => void;
  const closed = new Promise<void>((resolve) => {
    released = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    closing = resolve;
  });
  const buffered = new Set<string>();
  const open = h.deps.openNative;
  h.deps.openNative = async (...args) => {
    const native = await open(...args);
    native.inject = async (_id, text) => {
      buffered.add(text);
    };
    native.close = async () => {
      closing();
      await closed;
      for (const text of buffered) h.injected.add(text);
    };
    return native;
  };
  let broadcasts = 0;
  const unsubscribe = onConversationUpsert((event) => {
    if (event.agentName === h.input.targetAgentName) broadcasts++;
  });
  const result = forkAgentConversation(h.input, h.deps);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  try {
    await entered;
    assert.equal(h.conversations.size, 0);
    assert.equal(h.copied.size, 0);
    assert.equal(broadcasts, 0);
    const operation = [...h.operations.values()][0];
    assert.equal(operation.phase, 'injecting');
    assert.equal(operation.conversation.fork?.handoverDelivered, false);
    released();
    await result;
    assert.equal(broadcasts, 1);
    assert.equal(h.conversations.size, 1);
    assert.equal(h.injected.size, 1);
    assert.equal(
      [...h.operations.values()][0].conversation.fork?.handoverDelivered,
      true,
    );
  } finally {
    released();
    await settled;
    unsubscribe();
  }
});

for (const persisted of [false, true]) {
  test(`Codex close failure with confirmed writer termination keeps injecting retryable when acknowledged handover ${persisted ? 'was persisted' : 'was lost'}`, async (t) => {
    const h = harness(t);
    const open = h.deps.openNative;
    let failClose = true;
    let injections = 0;
    h.deps.openNative = async (...args) => {
      const native = await open(...args);
      const inject = native.inject;
      native.inject = async (...params) => {
        injections++;
        await inject(...params);
      };
      native.close = async () => {
        if (failClose) {
          failClose = false;
          if (!persisted) h.injected.clear();
          throw new Error('Writer close failed');
        }
      };
      native.isWriterTerminated = () => true;
      return native;
    };
    await assert.rejects(
      forkAgentConversation(h.input, h.deps),
      /Writer close failed/,
    );
    assert.equal(h.conversations.size, 0);
    assert.equal([...h.operations.values()][0].phase, 'injecting');
    assert.equal(
      [...h.operations.values()][0].conversation.fork?.handoverDelivered,
      false,
    );
    await forkAgentConversation(h.input, h.deps);
    assert.equal(h.stats().nativeForks, 1);
    assert.equal(injections, persisted ? 1 : 2);
    assert.equal(h.injected.size, 1);
    assert.equal(h.copied.size, 3);
  });
}

test('a graceful close with missing persisted injection leaves the handover recoverable and unpublished', async (t) => {
  const h = harness(t);
  const open = h.deps.openNative;
  let loseOnClose = true;
  h.deps.openNative = async (...args) => {
    const native = await open(...args);
    native.close = async () => {
      if (loseOnClose) {
        loseOnClose = false;
        h.injected.clear();
      }
    };
    return native;
  };
  await assert.rejects(forkAgentConversation(h.input, h.deps), {
    code: 'FORK_HANDOVER_UNAVAILABLE',
  });
  assert.equal(h.conversations.size, 0);
  assert.equal([...h.operations.values()][0].phase, 'injecting');
  assert.equal(
    [...h.operations.values()][0].conversation.fork?.handoverDelivered,
    false,
  );
  await forkAgentConversation(h.input, h.deps);
  assert.equal(h.injected.size, 1);
  assert.equal(h.stats().nativeForks, 1);
});

test('expired injecting takeover quarantines a buffered live writer across retries and recovers only durable handovers', async (t) => {
  const h = harness(t);
  const closing = deferred();
  const flush = deferred();
  const persisted: string[] = [];
  const buffered: string[] = [];
  let helpers = 0;
  let injections = 0;
  const open = h.deps.openNative;
  h.deps.openNative = async (...args) => {
    const native = await open(...args);
    const writer = ++helpers;
    native.hasInjected = async (_id, text) => persisted.includes(text);
    native.inject = async (_id, text) => {
      injections++;
      assert.equal(
        writer,
        1,
        'A takeover must never reinject buffered history',
      );
      buffered.push(text);
    };
    native.close = async () => {
      if (writer === 1) {
        closing.resolve();
        await flush.promise;
        persisted.push(...buffered);
      }
    };
    return native;
  };
  let broadcasts = 0;
  const unsubscribe = onConversationUpsert(() => broadcasts++);
  const first = forkAgentConversation(h.input, h.deps);
  const rejected = assert.rejects(first, { code: 'FORK_LEASE_LOST' });
  try {
    await awaitGate(closing.promise, first);
    const operation = [...h.operations.values()][0];
    assert.equal(operation.phase, 'injecting');
    assert.equal(operation.injectionWriterClosed, false);
    operation.leaseUntil = new Date(Date.now() - 1);
    await assert.rejects(h.runWorker(), {
      code: 'FORK_INJECTION_OUTCOME_UNKNOWN',
    });
    assert.equal([...h.operations.values()][0].phase, 'injection_uncertain');
    assert.equal([...h.operations.values()][0].owner, undefined);
    // Releasing worker B's owner must not make worker C assume the first
    // acknowledged injection was lost while worker A still holds its writer.
    await assert.rejects(h.runWorker(), {
      code: 'FORK_INJECTION_OUTCOME_UNKNOWN',
    });
    assert.equal(injections, 1);
    assert.equal(persisted.length, 0);
    assert.equal(h.conversations.size, 0);
    assert.equal(h.copied.size, 0);
    assert.equal(broadcasts, 0);
    assert.equal(operation.conversation.fork?.handoverDelivered, false);
  } finally {
    flush.resolve();
    await rejected;
    unsubscribe();
  }
  assert.equal(persisted.length, 1);
  await h.runWorker();
  assert.equal(injections, 1);
  assert.equal(persisted.length, 1);
  assert.equal(h.stats().nativeForks, 1);
  assert.equal(h.conversations.size, 1);
  assert.equal(h.copied.size, 3);
  assert.equal([...h.operations.values()][0].phase, 'ready');
});

test('failed close without termination proof remains quarantined after owner release', async (t) => {
  const h = harness(t);
  const open = h.deps.openNative;
  let helpers = 0;
  let injections = 0;
  h.deps.openNative = async (...args) => {
    const native = await open(...args);
    const writer = ++helpers;
    native.inject = async () => {
      injections++;
    };
    native.hasInjected = async () => false;
    native.close = async () => {
      if (writer === 1) throw new Error('Writer termination unknown');
    };
    return native;
  };
  await assert.rejects(
    forkAgentConversation(h.input, h.deps),
    /Writer termination unknown/,
  );
  for (let retry = 0; retry < 2; retry++) {
    await assert.rejects(forkAgentConversation(h.input, h.deps), {
      code: 'FORK_INJECTION_OUTCOME_UNKNOWN',
    });
    assert.equal([...h.operations.values()][0].phase, 'injection_uncertain');
    assert.equal(h.conversations.size, 0);
  }
  assert.equal(injections, 1);
  assert.equal(h.stats().nativeForks, 1);
});

test('large cumulative tool history is frozen per turn and never embedded in one operation document', async (t) => {
  const h = harness(t);
  const original = (await h.deps.listTurns(h.source._id)).items.reverse();
  const toolOutput = 'x'.repeat(1024 * 1024);
  const history: TurnSummary[] = Array.from(
    { length: 20 },
    (_unused, index) => [
      {
        ...original[0],
        turnId: `large-user-${index}`,
        createdAt: new Date(index * 2 + 1),
      },
      {
        ...original[1],
        turnId: `large-assistant-${index}`,
        createdAt: new Date(index * 2 + 2),
        toolCalls: { output: toolOutput },
      },
    ],
  ).flat();
  h.deps.listTurns = async () => ({ items: history.slice().reverse() });
  await forkAgentConversation(
    { ...h.input, sourceTurnId: 'large-assistant-19' },
    h.deps,
  );
  const operation = [...h.operations.values()][0];
  assert.equal('snapshot' in operation, false);
  assert.equal(operation.snapshotCount, 40);
  assert.ok(Buffer.byteLength(JSON.stringify(operation)) < 64 * 1024);
  assert.ok(h.stats().largestSnapshotRecord < 2 * 1024 * 1024);
  assert.equal(h.copied.size, 41);
  assert.ok(
    [...h.copied.values()].reduce(
      (sum, turn) => sum + Buffer.byteLength(JSON.stringify(turn)),
      0,
    ) >
      16 * 1024 * 1024,
  );
  assert.equal(h.snapshots.size, 0);
});

test('partial snapshot writes retry at the frozen DB boundary even after another source response completes', async (t) => {
  const h = harness(t);
  h.setFailSnapshot();
  await assert.rejects(
    forkAgentConversation({ ...h.input, sourceTurnId: undefined }, h.deps),
    /Partial frozen snapshot/,
  );
  assert.equal(h.stats().nativeForks, 0);
  const read = h.deps.listTurns;
  h.deps.listTurns = async (...args) => {
    const previous = await read(...args);
    return {
      items: [
        {
          ...previous.items[1],
          turnId: 'later-response',
          createdAt: new Date(4),
        },
        ...previous.items,
      ],
    };
  };
  await forkAgentConversation({ ...h.input, sourceTurnId: undefined }, h.deps);
  assert.equal(h.stats().nativeForks, 1);
  assert.equal(h.copied.size, 3);
  assert.equal(
    [...h.copied.values()].some(
      (turn) => turn.content === 'Later active prompt',
    ),
    false,
  );
});

test('retry reuses one native session and copied history; target configuration and source ownership stay independent', async (t) => {
  const h = harness(t);
  assert.equal(tryAcquireConversationLock(h.source._id), true);
  const ownership = getActiveRunOwnership(h.source._id);
  try {
    const first = await forkAgentConversation(h.input, h.deps);
    const second = await forkAgentConversation(h.input, h.deps);
    assert.deepEqual(second, first);
    assert.equal(h.stats().nativeForks, 1);
    assert.equal(h.conversations.size, 1);
    assert.equal(h.copied.size, 3);
    assert.equal(h.injected.size, 1);
    const copied = [...h.copied.values()];
    assert.equal(
      copied.some((row) => row.content === 'Later active prompt'),
      false,
    );
    assert.equal(copied[0].model, 'historic-model');
    assert.deepEqual(copied[1].toolCalls, {
      calls: [{ result: 'tool result' }],
    });
    assert.deepEqual(getActiveRunOwnership(h.source._id), ownership);
    assert.equal(h.source.flags.threadId, 'native-source');
    const child = [...h.conversations.values()][0];
    assert.equal(child.agentName, 'target_agent');
    assert.equal(child.flags.flow, undefined);
    assert.equal(child.flags.threadId, 'native-child');
    assert.match(child.fork!.handover, /Complete target prompt/);
    assert.match(child.fork!.handover, /source_agent/);
    assert.match(child.fork!.handover, /target_agent/);
    assert.deepEqual(h.stats().forkConfig, {
      config: h.target.runtimeConfig,
      model: 'target-model',
      cwd: '/shared/folder',
    });
  } finally {
    releaseConversationLock(h.source._id, ownership?.runToken);
  }
});

test('partial Mongo writes are invisible and retry without duplicate turns, sessions, or handover', async (t) => {
  const h = harness(t);
  h.setFailCopy();
  await assert.rejects(
    forkAgentConversation(h.input, h.deps),
    /Partial Mongo copy/,
  );
  assert.equal(h.conversations.size, 0);
  const result = await forkAgentConversation(h.input, h.deps);
  assert.ok(result.conversationId);
  assert.equal(h.stats().nativeForks, 1);
  assert.equal(h.injected.size, 1);
  assert.equal(h.copied.size, 3);
});

test('unknown native outcome never retries a non-idempotent provider RPC or publishes a partial conversation', async (t) => {
  const h = harness(t);
  h.setFailFork();
  await assert.rejects(
    forkAgentConversation(h.input, h.deps),
    /Provider acknowledgement lost/,
  );
  await assert.rejects(forkAgentConversation(h.input, h.deps), {
    code: 'FORK_NATIVE_OUTCOME_UNKNOWN',
  });
  assert.equal(h.stats().nativeForks, 1);
  assert.equal(h.conversations.size, 0);
  assert.equal(h.copied.size, 0);
});

test('source deletion during copy cleans only owned incomplete fork resources', async (t) => {
  const h = harness(t);
  const open = h.deps.openNative;
  let closed = false;
  h.deps.openNative = async (...args) => {
    const native = await open(...args);
    native.close = async () => {
      closed = true;
    };
    native.remove = async () => {
      assert.fail('Cleanup must use a fresh helper after close');
    };
    return native;
  };
  const removeOwned = h.deps.removeOwnedNative!;
  h.deps.removeOwnedNative = async (...args) => {
    assert.equal(closed, true);
    await removeOwned(...args);
  };
  h.deleteSource();
  await assert.rejects(forkAgentConversation(h.input, h.deps), {
    code: 'FORK_SOURCE_UNAVAILABLE',
  });
  assert.equal(h.stats().removed, 1);
  assert.equal(h.copied.size, 0);
  assert.equal(h.conversations.size, 0);
  assert.equal(h.snapshots.size, 0);
  assert.equal(h.source.flags.threadId, 'native-source');
});

test('provider rejection precedes native fork and persistence side effects', async (t) => {
  const h = harness(t);
  h.deps.prepareTarget = async () => ({
    ...h.target,
    executionProviderId: 'copilot',
    requestedProviderId: 'copilot',
  });
  await assert.rejects(forkAgentConversation(h.input, h.deps), {
    code: 'FORK_UNSUPPORTED',
  });
  assert.equal(h.stats().nativeForks, 0);
  assert.equal(h.operations.size, 0);
});

test('Copilot stores a pending handover and independent native ID without triggering inference', async (t) => {
  const h = harness(t, 'copilot');
  await forkAgentConversation(h.input, h.deps);
  const child = [...h.conversations.values()][0];
  assert.equal(child.fork?.nativeSessionId, 'native-child');
  assert.equal(child.flags.threadId, undefined);
  assert.equal(child.fork?.handoverDelivered, false);
  assert.equal(child.fork?.pendingHandovers?.length, 1);
  assert.equal(h.injected.size, 0);
});

test('same-agent latest idle fork uses a completed response and includes only one new handover', async (t) => {
  const h = harness(t);
  const input = {
    ...h.input,
    targetAgentName: 'source_agent',
    sourceTurnId: undefined,
  };
  await forkAgentConversation(input, h.deps);
  const child = [...h.conversations.values()][0];
  assert.equal(child.agentName, 'source_agent');
  assert.equal(child.fork?.sourceTurnId, 'assistant-id');
  assert.equal(
    [...h.copied.values()].filter(
      (row) => (row.fork as { handover?: boolean })?.handover,
    ).length,
    1,
  );
});

test('simultaneous retries coalesce while distinct input using the same identity is rejected', async (t) => {
  const h = harness(t);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const original = h.deps.openNative;
  h.deps.openNative = async (...args) => {
    const native = await original(...args);
    const fork = native.fork;
    native.fork = async (...params) => {
      entered();
      await gate;
      return fork(...params);
    };
    return native;
  };
  const first = forkAgentConversation(h.input, h.deps);
  const repeated = forkAgentConversation(h.input, h.deps);
  const all = Promise.all([first, repeated]);
  try {
    await ready;
    assert.equal(h.conversations.size, 0);
    await assert.rejects(
      forkAgentConversation({ ...h.input, targetAgentName: 'other' }, h.deps),
      { code: 'FORK_REQUEST_CONFLICT' },
    );
  } finally {
    release();
  }
  const [a, b] = await all;
  assert.equal(a.conversationId, b.conversationId);
  assert.equal(h.stats().nativeForks, 1);
});

test('unavailable native session fails before operation or copied history creation', async (t) => {
  const h = harness(t);
  h.deps.openNative = async () => {
    throw new Error('Native session unavailable');
  };
  await assert.rejects(
    forkAgentConversation(h.input, h.deps),
    /Native session unavailable/,
  );
  assert.equal(h.operations.size, 0);
  assert.equal(h.copied.size, 0);
});

test('Copilot whole idle fork holds only the short source lock and releases it on completion', async (t) => {
  const h = harness(t, 'copilot');
  const open = h.deps.openNative;
  let lockObserved = false;
  h.deps.openNative = async (...args) => {
    const native = await open(...args);
    native.turns[0].nextEventId = undefined;
    const fork = native.fork;
    native.fork = async (...params) => {
      lockObserved = !!getActiveRunOwnership(h.source._id);
      return fork(...params);
    };
    return native;
  };
  await forkAgentConversation(h.input, h.deps);
  assert.equal(lockObserved, true);
  assert.equal(getActiveRunOwnership(h.source._id), null);
});

test('Copilot copy retry reuses its native snapshot while the source has started another run', async (t) => {
  const h = harness(t, 'copilot');
  const open = h.deps.openNative;
  h.deps.openNative = async (...args) => {
    const native = await open(...args);
    native.turns[0].nextEventId = undefined;
    return native;
  };
  h.setFailCopy();
  await assert.rejects(
    forkAgentConversation(h.input, h.deps),
    /Partial Mongo copy/,
  );
  assert.equal(getActiveRunOwnership(h.source._id), null);
  assert.equal(tryAcquireConversationLock(h.source._id), true);
  const ownership = getActiveRunOwnership(h.source._id)!;
  try {
    const result = await forkAgentConversation(h.input, h.deps);
    assert.ok(result.conversationId);
    assert.equal(h.stats().nativeForks, 1);
    assert.equal(
      getActiveRunOwnership(h.source._id)?.runToken,
      ownership.runToken,
    );
  } finally {
    releaseConversationLock(h.source._id, ownership.runToken);
  }
});

test('latest fork-of-fork keeps previous handover context and adds exactly one new visible handover', async (t) => {
  const h = harness(t);
  h.source.fork = {
    requestId: 'previous-request',
    sourceConversationId: 'original-source',
    sourceTurnId: 'original-turn',
    sourceAgentName: 'original_agent',
    targetAgentName: 'source_agent',
    nativeSessionId: 'previous-native-child',
    estimated: false,
    handover: 'Previous target prompt',
    handoverDelivered: true,
  };
  const read = h.deps.listTurns;
  h.deps.listTurns = async (...args) => {
    const previous = await read(...args);
    return {
      items: [
        {
          turnId: 'previous-handover',
          conversationId: h.source._id,
          role: 'user',
          content: 'Previous target prompt',
          model: 'historic-model',
          provider: 'codex',
          status: 'ok',
          source: 'REST',
          toolCalls: null,
          createdAt: new Date(3),
          fork: { handover: true },
        },
        ...previous.items.filter((turn) => turn.turnId !== 'later-id'),
      ],
    };
  };
  await forkAgentConversation({ ...h.input, sourceTurnId: undefined }, h.deps);
  assert.equal(h.copied.size, 4);
  assert.equal(h.injected.size, 2);
  assert.ok(h.injected.has('Previous target prompt'));
  assert.equal(
    [...h.copied.values()].filter(
      (row) => (row.fork as { handover?: boolean })?.handover,
    ).length,
    2,
  );
});

test('latest-point DB cutoff is frozen before native read while a repeated response completes', async (t) => {
  const h = harness(t);
  const open = h.deps.openNative;
  let dbRead = false;
  const read = h.deps.listTurns;
  h.deps.listTurns = async (...args) => {
    dbRead = true;
    return read(...args);
  };
  h.deps.openNative = async (...args) => {
    assert.equal(dbRead, true);
    const native = await open(...args);
    h.rows.push({
      ...h.rows[1],
      turnId: 'new-response',
      createdAt: new Date(4),
      native: { sessionId: 'native-source', turnId: 'new-native-turn' },
    });
    // This native read captured the earlier completed point. Identical text in
    // the newer DB response must not move the already-frozen visible cutoff.
    return native;
  };
  await forkAgentConversation({ ...h.input, sourceTurnId: undefined }, h.deps);
  assert.equal(h.stats().forkBoundary, 'native-turn');
  assert.equal(
    [...h.conversations.values()][0].fork?.sourceTurnId,
    'assistant-id',
  );
  assert.equal(h.copied.size, 3);
  assert.equal(
    [...h.copied.values()].some(
      (row) =>
        (row.fork as { sourceTurnId?: string })?.sourceTurnId ===
        'new-response',
    ),
    false,
  );
});

test('stale native read cannot replace a recorded response ID with an identical earlier response', async (t) => {
  const h = harness(t);
  h.rows[1].native = {
    sessionId: 'native-source',
    turnId: 'not-yet-persisted',
  };
  await assert.rejects(forkAgentConversation(h.input, h.deps), {
    code: 'FORK_HISTORY_UNAVAILABLE',
  });
  assert.equal(h.stats().nativeForks, 0);
  assert.equal(h.operations.size, 0);
  assert.equal(h.conversations.size, 0);
});

for (const legacyCopy of [false, true]) {
  test(`fork-of-fork cutoff uses persisted ${legacyCopy ? 'legacy source IDs' : 'chronology'} when a later prompt displays before the selected answer`, async (t) => {
    const h = harness(t);
    h.rows[2].createdAt = h.rows[1].createdAt;
    h.rows.push({
      ...h.rows[1],
      turnId: 'later-answer',
      content: 'Later answer',
      createdAt: new Date(3),
      native: { sessionId: 'native-source', turnId: 'later-native-turn' },
    });
    const sourceDocuments = h.rows.map((row) => ({ ...row, _id: row.turnId }));
    t.mock.method(TurnModel, 'find', (filter: { conversationId: string }) => ({
      sort: (sort: Record<string, number>) => ({
        lean: async () => {
          const documents =
            filter.conversationId === h.source._id
              ? sourceDocuments.slice()
              : [...h.copied.entries()]
                  .filter(
                    ([, row]) => row.conversationId === filter.conversationId,
                  )
                  .map(([id, row]) => ({ ...row, _id: id }));
          return documents.sort((a, b) => {
            for (const [key, direction] of Object.entries(sort)) {
              const field = (row: unknown) =>
                key
                  .split('.')
                  .reduce<unknown>(
                    (value, part) =>
                      (value as Record<string, unknown> | undefined)?.[part],
                    row,
                  );
              const left = field(a);
              const right = field(b);
              if (left === right) continue;
              if (left === undefined) return -direction;
              if (right === undefined) return direction;
              const compared =
                left instanceof Date && right instanceof Date
                  ? left.getTime() - right.getTime()
                  : typeof left === 'number' && typeof right === 'number'
                    ? left - right
                    : String(left).localeCompare(String(right));
              if (compared) return compared * direction;
            }
            return 0;
          });
        },
      }),
    }));
    h.deps.listTurns = listAllTurns;
    const open = h.deps.openNative;
    h.deps.openNative = async (...args) => {
      const native = await open(...args);
      native.turns.push({
        id: 'later-native-turn',
        completed: true,
        user: 'Later active prompt',
        assistant: 'Later answer',
      });
      const fork = native.fork;
      native.fork = async (...params) => {
        const child = await fork(...params);
        return args[1] === 'native-child' ? 'native-grandchild' : child;
      };
      return native;
    };
    const parent = await forkAgentConversation(
      { ...h.input, sourceTurnId: 'later-answer' },
      h.deps,
    );
    if (legacyCopy) {
      for (const row of h.copied.values()) delete row.chronologicalOrder;
    }
    const childHistory = (
      await listAllTurns(parent.conversationId)
    ).items.reverse();
    const answer = childHistory.find((row) => row.content === 'Answer')!;
    const laterPrompt = childHistory.find(
      (row) => row.content === 'Later active prompt',
    )!;
    if (legacyCopy) {
      assert.equal(answer.chronologicalOrder, undefined);
      assert.equal(laterPrompt.chronologicalOrder, undefined);
    } else {
      assert.ok(answer.chronologicalOrder! < laterPrompt.chronologicalOrder!);
    }
    assert.ok(answer.displayOrder! > laterPrompt.displayOrder!);
    const child = h.conversations.get(parent.conversationId)!;
    h.deps.loadSource = async () => child;
    const nested = await forkAgentConversation(
      {
        ...h.input,
        sourceConversationId: parent.conversationId,
        sourceTurnId: answer.turnId,
        requestId: crypto.randomUUID(),
      },
      h.deps,
    );
    assert.deepEqual(
      (await listAllTurns(nested.conversationId)).items
        .reverse()
        .slice(0, -1)
        .map((row) => row.content),
      ['Prompt', 'Answer'],
    );
    assert.equal(h.stats().forkBoundary, 'native-turn');
    assert.equal(
      h.conversations.get(nested.conversationId)?.fork?.nativeSessionId,
      'native-grandchild',
    );
    assert.equal(
      (await listAllTurns(parent.conversationId)).items.length,
      childHistory.length,
    );
    assert.equal(
      h.rows.every(
        (row) =>
          row.chronologicalOrder === undefined &&
          row.displayOrder === undefined,
      ),
      true,
    );
  });
}

test('publication transaction hides both child and ready state until commit', async (t) => {
  const h = harness(t);
  const entered = deferred();
  const release = deferred();
  h.setPublicationGate(async () => {
    entered.resolve();
    await release.promise;
  });
  const result = forkAgentConversation(h.input, h.deps);
  const settled = result.catch(() => undefined);
  try {
    await awaitGate(entered.promise, result);
    assert.equal(h.conversations.size, 0);
    assert.equal([...h.operations.values()][0].phase, 'copied');
  } finally {
    release.resolve();
    await settled;
  }
  await result;
  assert.equal(h.conversations.size, 1);
  assert.equal([...h.operations.values()][0].phase, 'ready');
});

test('publication failure rolls back ready and retries without another native child', async (t) => {
  const h = harness(t);
  h.setFailPublicationCommit();
  await assert.rejects(
    forkAgentConversation(h.input, h.deps),
    /Publication commit failed/,
  );
  assert.equal(h.conversations.size, 0);
  assert.equal([...h.operations.values()][0].phase, 'copied');
  await forkAgentConversation(h.input, h.deps);
  assert.equal(h.stats().nativeForks, 1);
  assert.equal(h.copied.size, 3);
});

test('lost publication acknowledgement followed by child deletion cannot resurrect the fork on retry', async (t) => {
  const h = harness(t);
  h.setFailPublicationAck();
  await assert.rejects(
    forkAgentConversation(h.input, h.deps),
    /Publication acknowledgement lost/,
  );
  assert.equal([...h.operations.values()][0].phase, 'ready');
  assert.equal(h.conversations.size, 1);
  h.conversations.clear();
  h.copied.clear();
  await assert.rejects(forkAgentConversation(h.input, h.deps), {
    code: 'FORK_DELETED',
  });
  assert.equal(h.stats().nativeForks, 1);
  assert.equal(h.conversations.size, 0);
  assert.equal(h.copied.size, 0);
});

test('owner takeover before native transition fences the old worker without issuing a provider fork', async (t) => {
  const h = harness(t);
  const update = ForkOperationModel.updateOne.bind(ForkOperationModel);
  t.mock.method(
    ForkOperationModel,
    'updateOne',
    async (...args: Parameters<typeof ForkOperationModel.updateOne>) => {
      const values = (args[1] as { $set?: Partial<ForkOperation> }).$set;
      if (values?.phase === 'native_creating') {
        const op = [...h.operations.values()][0];
        op.owner = 'replacement-worker';
        op.leaseUntil = new Date(Date.now() + FORK_LEASE_MS);
      }
      return update(...args);
    },
  );
  await assert.rejects(forkAgentConversation(h.input, h.deps), {
    code: 'FORK_LEASE_LOST',
  });
  assert.equal(h.stats().nativeForks, 0);
  assert.equal(h.conversations.size, 0);
  assert.equal([...h.operations.values()][0].owner, 'replacement-worker');
});

test('owner takeover after staging fences publication and cannot be cleared by the old worker', async (t) => {
  const h = harness(t);
  const exists = ConversationModel.exists.bind(ConversationModel);
  t.mock.method(
    ConversationModel,
    'exists',
    async (filter: Parameters<typeof ConversationModel.exists>[0]) => {
      const op = [...h.operations.values()][0];
      op.owner = 'replacement-worker';
      op.leaseUntil = new Date(Date.now() + FORK_LEASE_MS);
      return exists(filter);
    },
  );
  await assert.rejects(forkAgentConversation(h.input, h.deps), {
    code: 'FORK_LEASE_LOST',
  });
  assert.equal(h.stats().nativeForks, 1);
  assert.equal(h.conversations.size, 0);
  assert.equal([...h.operations.values()][0].phase, 'copied');
  assert.equal([...h.operations.values()][0].owner, 'replacement-worker');
});

test('long native creation renews its lease and a second worker cannot take over after five minutes', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const h = harness(t);
  const entered = deferred();
  const release = deferred();
  const open = h.deps.openNative;
  h.deps.openNative = async (...args) => {
    const native = await open(...args);
    const fork = native.fork;
    native.fork = async (...params) => {
      entered.resolve();
      await release.promise;
      return fork(...params);
    };
    return native;
  };
  const update = ForkOperationModel.updateOne.bind(ForkOperationModel);
  let renewed = deferred();
  t.mock.method(
    ForkOperationModel,
    'updateOne',
    async (...args: Parameters<typeof ForkOperationModel.updateOne>) => {
      const result = await update(...args);
      if (
        !(args[1] as { $set?: Partial<ForkOperation> }).$set?.phase &&
        (args[1] as { $set?: Partial<ForkOperation> }).$set?.leaseUntil
      )
        renewed.resolve();
      return result;
    },
  );
  const first = forkAgentConversation(h.input, h.deps);
  const settled = first.catch(() => undefined);
  try {
    await awaitGate(entered.promise, first);
    for (let minute = 0; minute < 7; minute++) {
      renewed = deferred();
      t.mock.timers.tick(FORK_LEASE_RENEW_MS);
      await awaitGate(renewed.promise, first);
      assert.ok(
        [...h.operations.values()][0].leaseUntil!.getTime() > Date.now(),
      );
    }
    await assert.rejects(h.runWorker(), { code: 'FORK_CREATING' });
  } finally {
    release.resolve();
    await settled;
  }
  await first;
  assert.equal(h.stats().nativeForks, 1);
});

test('source deletion cleanup cannot claim a fork published by another worker after its initial visibility read', async (t) => {
  const h = harness(t);
  const closeEntered = deferred();
  const closeRelease = deferred();
  const loadEntered = deferred();
  const loadRelease = deferred();
  const open = h.deps.openNative;
  h.deps.openNative = async (...args) => {
    const native = await open(...args);
    native.close = async () => {
      closeEntered.resolve();
      await closeRelease.promise;
    };
    return native;
  };
  const first = forkAgentConversation(h.input, h.deps);
  const settledFirst = first.catch(() => undefined);
  let second: Promise<Awaited<typeof first>> | undefined;
  try {
    await awaitGate(closeEntered.promise, first);
    h.deps.loadSource = async () => {
      loadEntered.resolve();
      await loadRelease.promise;
      throw new ForkError('FORK_SOURCE_UNAVAILABLE', 'Source deleted', 404);
    };
    second = h.runWorker();
    const settledSecond = second.catch(() => undefined);
    await awaitGate(loadEntered.promise, second);
    closeRelease.resolve();
    const published = await first;
    h.deleteSource();
    loadRelease.resolve();
    await settledSecond;
    assert.deepEqual(await second, published);
    assert.equal(h.stats().removed, 0);
    assert.equal(h.copied.size, 3);
    assert.equal(h.conversations.size, 1);
    assert.equal([...h.operations.values()][0].phase, 'ready');
  } finally {
    closeRelease.resolve();
    loadRelease.resolve();
    await settledFirst;
    await second?.catch(() => undefined);
  }
});

test('an expired owner cannot advance to native creation and a safe retry creates only one session', async (t) => {
  const h = harness(t);
  const update = ForkOperationModel.updateOne.bind(ForkOperationModel);
  let expire = true;
  t.mock.method(
    ForkOperationModel,
    'updateOne',
    async (...args: Parameters<typeof ForkOperationModel.updateOne>) => {
      if (
        expire &&
        (args[1] as { $set?: Partial<ForkOperation> }).$set?.phase ===
          'native_creating'
      ) {
        expire = false;
        [...h.operations.values()][0].leaseUntil = new Date(Date.now() - 1);
      }
      return update(...args);
    },
  );
  await assert.rejects(forkAgentConversation(h.input, h.deps), {
    code: 'FORK_LEASE_LOST',
  });
  assert.equal(h.stats().nativeForks, 0);
  assert.equal([...h.operations.values()][0].phase, 'prepared');
  await forkAgentConversation(h.input, h.deps);
  assert.equal(h.stats().nativeForks, 1);
});

test('takeover during an uncertain native call quarantines both workers without repeating the RPC', async (t) => {
  const h = harness(t);
  const entered = deferred();
  const release = deferred();
  const open = h.deps.openNative;
  h.deps.openNative = async (...args) => {
    const native = await open(...args);
    const fork = native.fork;
    native.fork = async (...params) => {
      entered.resolve();
      await release.promise;
      return fork(...params);
    };
    return native;
  };
  const first = forkAgentConversation(h.input, h.deps);
  const rejected = assert.rejects(first, { code: 'FORK_LEASE_LOST' });
  try {
    await awaitGate(entered.promise, first);
    [...h.operations.values()][0].leaseUntil = new Date(Date.now() - 1);
    await assert.rejects(h.runWorker(), {
      code: 'FORK_NATIVE_OUTCOME_UNKNOWN',
    });
    assert.equal(h.conversations.size, 0);
  } finally {
    release.resolve();
    await rejected;
  }
  await assert.rejects(forkAgentConversation(h.input, h.deps), {
    code: 'FORK_NATIVE_OUTCOME_UNKNOWN',
  });
  assert.equal(h.stats().nativeForks, 1);
  assert.equal(h.conversations.size, 0);
});

test('cleanup rechecks child visibility under ownership even for an older incomplete publication record', async (t) => {
  const h = harness(t);
  h.setFailPublicationCommit();
  await assert.rejects(
    forkAgentConversation(h.input, h.deps),
    /Publication commit failed/,
  );
  const operation = [...h.operations.values()][0];
  h.deps.loadSource = async () => {
    h.conversations.set(
      operation.conversationId,
      structuredClone(operation.conversation),
    );
    throw new ForkError('FORK_SOURCE_UNAVAILABLE', 'Source deleted', 404);
  };
  const result = await forkAgentConversation(h.input, h.deps);
  assert.equal(result.conversationId, operation.conversationId);
  assert.equal(h.stats().removed, 0);
  assert.equal(h.copied.size, 3);
  assert.equal([...h.operations.values()][0].phase, 'ready');
});

test('bounded snapshot transactions retain committed batches and retry with stable global row indices', async (t) => {
  const h = harness(t);
  const history: TurnSummary[] = [
    ...Array.from({ length: 125 }, (_, index) => ({
      ...h.rows[0],
      turnId: `system-${index}`,
      role: 'system' as const,
      content: `Historical context ${index}`,
      createdAt: new Date(0),
    })),
    ...h.rows.slice(0, 2),
  ];
  h.deps.listTurns = async () => ({ items: history.slice().reverse() });
  const write = ForkSnapshotModel.bulkWrite.bind(ForkSnapshotModel);
  let batch = 0;
  t.mock.method(
    ForkSnapshotModel,
    'bulkWrite',
    async (...args: Parameters<typeof ForkSnapshotModel.bulkWrite>) => {
      if (++batch === 2) h.setFailSnapshot();
      return write(...args);
    },
  );
  await assert.rejects(
    forkAgentConversation(h.input, h.deps),
    /Partial frozen snapshot/,
  );
  assert.equal(h.snapshots.size, 100);
  assert.equal(h.stats().nativeForks, 0);
  await forkAgentConversation(h.input, h.deps);
  assert.equal(h.stats().nativeForks, 1);
  assert.equal(h.copied.size, 128);
  assert.deepEqual(
    [...h.copied.values()]
      .map((row) => row.chronologicalOrder)
      .sort((a, b) => Number(a) - Number(b)),
    Array.from({ length: 128 }, (_, index) => index),
  );
});

test('delayed ownership acknowledgement after expiry cannot authorize an old worker native RPC', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const h = harness(t);
  const entered = deferred();
  const release = deferred();
  const update = ForkOperationModel.updateOne.bind(ForkOperationModel);
  t.mock.method(
    ForkOperationModel,
    'updateOne',
    async (...args: Parameters<typeof ForkOperationModel.updateOne>) => {
      const result = await update(...args);
      if (
        (args[1] as { $set?: Partial<ForkOperation> }).$set?.phase ===
        'native_creating'
      ) {
        entered.resolve();
        await release.promise;
      }
      return result;
    },
  );
  const first = forkAgentConversation(h.input, h.deps);
  const rejected = assert.rejects(first, { code: 'FORK_LEASE_LOST' });
  try {
    await awaitGate(entered.promise, first);
    t.mock.timers.tick(FORK_LEASE_MS + 1);
    await assert.rejects(h.runWorker(), {
      code: 'FORK_NATIVE_OUTCOME_UNKNOWN',
    });
  } finally {
    release.resolve();
    await rejected;
  }
  assert.equal(h.stats().nativeForks, 0);
  assert.equal(h.conversations.size, 0);
});
