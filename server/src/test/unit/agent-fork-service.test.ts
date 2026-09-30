import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { type TestContext } from 'node:test';
import {
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
import type { TurnSummary } from '../../mongo/repo.js';
import { TurnModel } from '../../mongo/turn.js';

const query = <T>(value: T) => ({ lean: () => ({ exec: async () => value }) });
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
  t.mock.method(ForkOperationModel, 'findById', (id: string) =>
    query(operations.has(id) ? structuredClone(operations.get(id)) : null),
  );
  t.mock.method(ForkOperationModel, 'create', async (value: ForkOperation) => {
    operations.set(value._id, structuredClone(value));
    return value;
  });
  t.mock.method(
    ForkSnapshotModel,
    'bulkWrite',
    async (
      writes: Array<{ updateOne: { update: { $setOnInsert: ForkSnapshot } } }>,
    ) => {
      for (const write of writes) {
        const record = write.updateOne.update.$setOnInsert;
        largestSnapshotRecord = Math.max(
          largestSnapshotRecord,
          Buffer.byteLength(JSON.stringify(record)),
        );
        if (!snapshots.has(record._id))
          snapshots.set(record._id, structuredClone(record));
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
    async (filter: { operationId: string }) => {
      for (const [key, row] of snapshots)
        if (row.operationId === filter.operationId) snapshots.delete(key);
      return { deletedCount: 1 };
    },
  );
  t.mock.method(
    ForkOperationModel,
    'findOneAndUpdate',
    (filter: { _id: string }, update: { $set: Partial<ForkOperation> }) => {
      const value = operations.get(filter._id)!;
      if (value.owner) return query(null);
      Object.assign(value, update.$set);
      return query(structuredClone(value));
    },
  );
  t.mock.method(
    ForkOperationModel,
    'updateOne',
    async (
      filter: { _id: string },
      update: {
        $set?: Partial<ForkOperation>;
        $unset?: Record<string, unknown>;
      },
    ) => {
      const value = operations.get(filter._id)!;
      if (update.$set) Object.assign(value, structuredClone(update.$set));
      for (const key of Object.keys(update.$unset ?? {}))
        delete (value as unknown as Record<string, unknown>)[key];
      return { acknowledged: true };
    },
  );
  t.mock.method(ConversationModel, 'findById', (id: string) =>
    query(conversations.get(id) ?? null),
  );
  t.mock.method(ConversationModel, 'exists', async () =>
    deletedSource ? null : { _id: sourceId },
  );
  t.mock.method(
    ConversationModel,
    'findOneAndUpdate',
    (filter: { _id: string }, update: { $setOnInsert: Conversation }) => {
      conversations.set(filter._id, structuredClone(update.$setOnInsert));
      return query(conversations.get(filter._id)!);
    },
  );
  t.mock.method(
    TurnModel,
    'bulkWrite',
    async (
      writes: Array<{
        updateOne: { update: { $setOnInsert: Record<string, unknown> } };
      }>,
    ) => {
      for (const write of writes) {
        const row = write.updateOne.update.$setOnInsert;
        copied.set(String(row._id), row);
        if (failCopy) {
          failCopy = false;
          throw new Error('Partial Mongo copy');
        }
      }
      return { acknowledged: true };
    },
  );
  t.mock.method(TurnModel, 'deleteMany', async () => {
    copied.clear();
    return { deletedCount: 1 };
  });
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
      fork: async (_boundary, config, model, cwd) => {
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
    stats: () => ({ nativeForks, removed, forkConfig, largestSnapshotRecord }),
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
  test(`Codex close failure keeps injecting retryable when acknowledged handover ${persisted ? 'was persisted' : 'was lost'}`, async (t) => {
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
