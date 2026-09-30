import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { baseLogger } from '../logger.js';
import { ConversationModel, type Conversation } from '../mongo/conversation.js';
import { emitConversationUpsert } from '../mongo/events.js';
import {
  ForkOperationModel,
  ForkSnapshotModel,
  type ForkOperation,
} from '../mongo/forkOperation.js';
import { listAllTurns, type TurnSummary } from '../mongo/repo.js';
import { TurnModel, type Turn } from '../mongo/turn.js';
import {
  ForkError,
  forkHandoverAt,
  last,
  lastIndex,
  orderForkDisplayHistory,
  resolveForkBoundary,
  selectForkSnapshot,
} from './forkHistory.js';
import {
  FORK_LEASE_MS,
  incompleteForkPhases,
  maintainForkLease,
} from './forkLease.js';
import { openForkNative, removeOwnedNativeFork } from './forkNative.js';
import {
  getActiveRunOwnership,
  releaseConversationLock,
  tryAcquireConversationLock,
} from './runLock.js';
import { listAgents, prepareAgentForkTarget } from './service.js';

export type ForkInput = {
  sourceConversationId: string;
  targetAgentName: string;
  sourceTurnId?: string;
  requestId: string;
};
export type ForkResult = {
  conversationId: string;
  agentName: string;
  model: string;
  workingFolder?: string;
  estimated: boolean;
};

export function assertForkCompatible(
  source: Pick<Conversation, 'provider' | 'flags'>,
  target: Awaited<ReturnType<typeof prepareAgentForkTarget>>,
) {
  if (
    !['codex', 'copilot'].includes(source.provider) ||
    source.provider !== target.executionProviderId ||
    (target.requestedProviderId &&
      target.requestedProviderId !== target.executionProviderId) ||
    (source.flags.endpointId ?? '') !== (target.endpointId ?? '')
  ) {
    throw new ForkError(
      'FORK_UNSUPPORTED',
      'Forking requires compatible agents on the same Codex or Copilot provider and endpoint; provider fallback is not supported.',
    );
  }
}

const loadSource = async (id: string): Promise<Conversation> => {
  const source = await ConversationModel.findById(id).lean().exec();
  if (!source?.agentName || source.flowName)
    throw new ForkError(
      'FORK_SOURCE_UNAVAILABLE',
      'The source agent conversation is unavailable.',
      404,
    );
  return source;
};

export async function getForkOptions(sourceId: string, sourceTurnId?: string) {
  const source = await loadSource(sourceId);
  const snapshot = selectForkSnapshot(
    (await listAllTurns(sourceId)).items.reverse(),
    sourceTurnId,
  );
  const sourceProvider =
    source.provider ??
    (
      await prepareAgentForkTarget(
        source.agentName!,
        source.flags.workingFolder,
      )
    ).executionProviderId;
  if (!['codex', 'copilot'].includes(sourceProvider))
    throw new ForkError(
      'FORK_UNSUPPORTED',
      'This provider does not support native conversation forks.',
    );
  const sessionId =
    source.fork?.nativeSessionId ??
    (sourceProvider === 'codex' ? source.flags.threadId : source._id);
  if (!sessionId)
    throw new ForkError(
      'FORK_NATIVE_UNAVAILABLE',
      'The source has no native provider session.',
    );
  const native = await openForkNative(
    sourceProvider as 'codex' | 'copilot',
    sessionId,
  );
  let estimated: boolean;
  try {
    estimated = resolveForkBoundary(snapshot, native.turns).estimated;
  } finally {
    await native.close();
  }
  const compatible = [];
  for (const agent of (await listAgents()).agents) {
    try {
      const target = await prepareAgentForkTarget(
        agent.name,
        source.flags.workingFolder,
      );
      assertForkCompatible({ ...source, provider: sourceProvider }, target);
      compatible.push({
        name: agent.name,
        sameAgent: agent.name === source.agentName,
      });
    } catch {
      /* Unavailable and fallback-only agents cannot resume this native session. */
    }
  }
  return {
    sourceTitle: source.title,
    sourceAgentName: source.agentName,
    agents: compatible,
    estimated,
    sourceTurnId: snapshot.at(-1)!.turnId,
  };
}

export function copyForkTurn(
  turn: TurnSummary,
  conversationId: string,
  nativeSessionId: string,
  displayOrder: number,
  chronologicalOrder?: number,
) {
  const { turnId, runtime, ...history } = turn;
  return {
    ...history,
    conversationId,
    displayOrder,
    chronologicalOrder,
    // Command/tool metadata remains display history. Replay and run ownership
    // would make a child appear to own work still executing on its parent.
    runtime: runtime
      ? {
          workingFolder: runtime.workingFolder,
          lookupSummary: runtime.lookupSummary,
        }
      : undefined,
    native: turn.native
      ? { ...turn.native, sessionId: nativeSessionId }
      : undefined,
    fork: { ...turn.fork, sourceTurnId: turnId },
  };
}

const resultFor = (conversation: Conversation): ForkResult => ({
  conversationId: conversation._id,
  agentName: conversation.agentName!,
  model: conversation.model,
  workingFolder: conversation.flags.workingFolder,
  estimated: conversation.fork!.estimated,
});

async function readForkSnapshot(
  operation: ForkOperation,
): Promise<TurnSummary[]> {
  const records = await ForkSnapshotModel.find({ operationId: operation._id })
    .sort({ index: 1 })
    .lean()
    .exec();
  if (
    records.length !== operation.snapshotCount ||
    records.some((record, index) => record.index !== index) ||
    records.at(-1)?.turn.turnId !== operation.snapshotLastTurnId
  )
    throw new ForkError(
      'FORK_SNAPSHOT_UNAVAILABLE',
      'The frozen fork history is incomplete. Retry this request.',
    );
  return records.map((record) => record.turn);
}

async function readFinishedFork(operationId: string) {
  const operation = await ForkOperationModel.findById(operationId)
    .lean()
    .exec();
  if (!operation) return undefined;
  const conversation = await ConversationModel.findById(
    operation.conversationId,
  )
    .lean()
    .exec();
  if (conversation) return resultFor(conversation);
  if (operation.phase === 'ready')
    throw new ForkError(
      'FORK_DELETED',
      'The previously created fork was deleted; start a new fork request.',
    );
  if (operation.phase === 'failed')
    throw new ForkError(
      'FORK_FAILED',
      operation.error ?? 'The fork failed; start a new fork request.',
    );
  return undefined;
}

async function closeInjectionWriter(
  writer: Awaited<ReturnType<typeof openForkNative>>,
  lease: ReturnType<typeof maintainForkLease>,
) {
  let closed = false;
  try {
    await writer.close();
    closed = true;
  } finally {
    // Persist termination separately from delivery: a dead writer cannot append
    // a buffered duplicate later, even if its final flush failed or lost data.
    if (closed || writer.isWriterTerminated?.())
      await lease.update({ injectionWriterClosed: true });
  }
}

async function cleanupIncompleteFork(
  operation: ForkOperation,
  lease: ReturnType<typeof maintainForkLease>,
  deps: ForkServiceDeps,
) {
  // Claiming an incomplete phase and checking visibility in the same owned
  // transaction prevents a delayed cleanup worker from destroying a ready fork.
  const published = await mongoose.connection.transaction(async (session) => {
    await lease.update({}, session);
    const conversation = await ConversationModel.findById(
      operation.conversationId,
      null,
      { session },
    )
      .lean()
      .exec();
    if (conversation) {
      await lease.update({ phase: 'ready', conversation }, session);
      return conversation;
    }
    await lease.update({ phase: 'cleaning' }, session);
    return null;
  });
  if (published) return resultFor(published);
  if (operation.nativeSessionId === operation.sourceNativeSessionId)
    throw new ForkError(
      'FORK_CLEANUP_UNAVAILABLE',
      'Cannot establish independent fork ownership.',
    );
  if (operation.nativeSessionId) {
    await lease.update();
    await (deps.removeOwnedNative ?? removeOwnedNativeFork)(
      operation.conversation.provider as 'codex' | 'copilot',
      operation.nativeSessionId,
    );
  }
  await mongoose.connection.transaction(async (session) => {
    await lease.update(
      {
        phase: 'failed',
        error: 'The source was deleted during fork creation.',
      },
      session,
    );
    await TurnModel.deleteMany(
      { conversationId: operation.conversationId },
      { session },
    );
    await ForkSnapshotModel.deleteMany(
      { operationId: operation._id },
      { session },
    );
  });
  return undefined;
}

export type ForkServiceDeps = {
  loadSource: typeof loadSource;
  prepareTarget: typeof prepareAgentForkTarget;
  openNative: typeof openForkNative;
  listTurns: typeof listAllTurns;
  removeOwnedNative?: typeof removeOwnedNativeFork;
};
const defaultDeps: ForkServiceDeps = {
  loadSource,
  prepareTarget: prepareAgentForkTarget,
  openNative: openForkNative,
  listTurns: listAllTurns,
};
const activeRequests = new Map<
  string,
  { inputKey: string; promise: Promise<ForkResult> }
>();
const FORK_WRITE_BATCH_SIZE = 100;
export function forkAgentConversation(
  input: ForkInput,
  deps: ForkServiceDeps = defaultDeps,
): Promise<ForkResult> {
  const key = crypto.createHash('sha256').update(input.requestId).digest('hex');
  const active = activeRequests.get(key);
  // The DB also checks input identity. Never coalesce two different requests.
  const inputKey = JSON.stringify([
    input.sourceConversationId,
    input.targetAgentName,
    input.sourceTurnId ?? null,
  ]);
  if (active) {
    if (active.inputKey !== inputKey)
      return Promise.reject(
        new ForkError(
          'FORK_REQUEST_CONFLICT',
          'This request identity was already used with a different source or target.',
        ),
      );
    return active.promise;
  }
  const task = executeFork(input, key, deps).finally(() =>
    activeRequests.delete(key),
  );
  activeRequests.set(key, { inputKey, promise: task });
  return task;
}

// Each server worker executes independently; only the public facade coalesces
// requests in its own process. Durable ownership must therefore fence this path.
export async function executeFork(
  input: ForkInput,
  operationId: string,
  deps: ForkServiceDeps,
): Promise<ForkResult> {
  const inputKey = JSON.stringify([
    input.sourceConversationId,
    input.targetAgentName,
    input.sourceTurnId ?? null,
  ]);
  let operation = await ForkOperationModel.findById(operationId).lean().exec();
  if (operation && operation.inputKey !== inputKey)
    throw new ForkError(
      'FORK_REQUEST_CONFLICT',
      'This request identity was already used with a different source or target.',
    );
  if (operation) {
    const ready = await ConversationModel.findById(operation.conversationId)
      .lean()
      .exec();
    if (ready) return resultFor(ready);
    if (operation.phase === 'ready')
      throw new ForkError(
        'FORK_DELETED',
        'The previously created fork was deleted; start a new fork request.',
      );
    if (operation.phase === 'failed')
      throw new ForkError(
        'FORK_FAILED',
        operation.error ?? 'The fork failed; start a new fork request.',
      );
  }

  let source: Conversation;
  try {
    source = await deps.loadSource(input.sourceConversationId);
  } catch (error) {
    if (
      error instanceof ForkError &&
      error.code === 'FORK_SOURCE_UNAVAILABLE' &&
      operation
    ) {
      const cleanupOwner = crypto.randomUUID();
      const owned = await ForkOperationModel.findOneAndUpdate(
        {
          _id: operationId,
          phase: { $in: incompleteForkPhases },
          $or: [
            { owner: { $exists: false } },
            { leaseUntil: { $lt: new Date() } },
          ],
        },
        {
          $set: {
            owner: cleanupOwner,
            leaseUntil: new Date(Date.now() + FORK_LEASE_MS),
          },
        },
        { new: true },
      )
        .lean()
        .exec();
      if (owned) {
        const cleanupLease = maintainForkLease(operationId, cleanupOwner);
        try {
          const ready = await cleanupIncompleteFork(owned, cleanupLease, deps);
          if (ready) return ready;
        } finally {
          await cleanupLease.stop();
          await ForkOperationModel.updateOne(
            { _id: operationId, owner: cleanupOwner },
            { $unset: { owner: 1, leaseUntil: 1 } },
          );
        }
      } else {
        const ready = await readFinishedFork(operationId);
        if (ready) return ready;
      }
    }
    throw error;
  }
  const sourceProvider =
    source.provider ??
    (await deps.prepareTarget(source.agentName!, source.flags.workingFolder))
      .executionProviderId;
  const target = await deps.prepareTarget(
    input.targetAgentName,
    operation?.conversation.flags.workingFolder ?? source.flags.workingFolder,
  );
  assertForkCompatible({ ...source, provider: sourceProvider }, target);
  const nativeId =
    operation?.sourceNativeSessionId ??
    source.fork?.nativeSessionId ??
    (sourceProvider === 'codex' ? source.flags.threadId : source._id);
  if (!nativeId)
    throw new ForkError(
      'FORK_NATIVE_UNAVAILABLE',
      'The source has no native provider session.',
    );

  const owner = crypto.randomUUID();
  let sourceLock: string | undefined;
  let native: Awaited<ReturnType<typeof openForkNative>> | undefined;
  let claimed = false;
  let lease: ReturnType<typeof maintainForkLease> | undefined;
  try {
    // Freeze the visible DB point first. Native history may advance while it is
    // read, but it must never be older than the selected recorded response.
    let snapshot =
      operation && operation.phase !== 'snapshotting'
        ? await readForkSnapshot(operation)
        : selectForkSnapshot(
            (await deps.listTurns(source._id)).items.reverse(),
            operation?.snapshotLastTurnId ?? input.sourceTurnId,
          );
    native = await deps.openNative(
      sourceProvider as 'codex' | 'copilot',
      nativeId,
    );
    let boundary = resolveForkBoundary(snapshot, native.turns);

    if (!operation) {
      const conversationId = crypto.randomUUID();
      const now = forkHandoverAt(snapshot);
      const handover = `Conversation handover\nFork request: ${input.requestId}\nSource agent: ${source.agentName}\nSource conversation: ${source.title} (${source._id})\nTarget agent: ${input.targetAgentName}\nProvider: ${sourceProvider}\n\nContinue as the target agent using its current tools and model. The working folder is shared; this fork does not isolate files.\n\nComplete target agent prompt captured at fork time:\n${target.prompt}`;
      const conversation: Conversation = {
        _id: conversationId,
        agentName: input.targetAgentName,
        provider: sourceProvider,
        model: target.modelId,
        title: `Fork: ${source.title}`.slice(0, 160),
        source: 'REST',
        flags: {
          workingFolder: source.flags.workingFolder,
          endpointId: target.endpointId,
          requestedProviderId: target.requestedProviderId,
        },
        createdAt: now,
        updatedAt: now,
        lastMessageAt: now,
        archivedAt: null,
        fork: {
          requestId: input.requestId,
          sourceConversationId: source._id,
          sourceTurnId: last(snapshot, (turn) => turn.role === 'assistant')!
            .turnId,
          sourceAgentName: source.agentName!,
          targetAgentName: input.targetAgentName,
          nativeSessionId: '',
          estimated: boundary.estimated,
          handover,
          handoverDelivered: false,
          pendingHandovers: [
            ...snapshot
              .slice(
                lastIndex(snapshot, (turn) => turn.role === 'assistant') + 1,
              )
              .filter((turn) => turn.fork?.handover)
              .map((turn) => turn.content),
            handover,
          ],
        },
      };
      try {
        await ForkOperationModel.create({
          _id: operationId,
          inputKey,
          sourceId: source._id,
          sourceNativeSessionId: nativeId,
          targetAgentName: input.targetAgentName,
          conversationId,
          phase: 'snapshotting',
          snapshotCount: snapshot.length,
          snapshotLastTurnId: snapshot.at(-1)!.turnId,
          conversation,
          handoverAt: now,
          runtimeConfig: target.runtimeConfig,
          workingDirectory: target.workingDirectoryOverride,
        });
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
      operation = await ForkOperationModel.findById(operationId).lean().exec();
      if (!operation || operation.inputKey !== inputKey)
        throw new ForkError(
          'FORK_REQUEST_CONFLICT',
          'Conflicting fork request.',
        );
    }
    const leaseUntil = new Date(Date.now() + FORK_LEASE_MS);
    const claimedOperation = await ForkOperationModel.findOneAndUpdate(
      {
        _id: operationId,
        phase: { $in: incompleteForkPhases },
        $or: [
          { owner: { $exists: false } },
          { leaseUntil: { $lt: new Date() } },
        ],
      },
      { $set: { owner, leaseUntil } },
      // The atomic preimage retains the expired writer's ownership metadata.
      // A lease takeover cannot prove that its provider process has terminated.
      { new: false },
    )
      .lean()
      .exec();
    if (!claimedOperation) {
      const ready = await readFinishedFork(operationId);
      if (ready) return ready;
      throw new ForkError(
        'FORK_CREATING',
        'This fork is being created. Retry with the same request identity.',
      );
    }
    operation = { ...claimedOperation, owner, leaseUntil };
    claimed = true;
    const ownedLease = maintainForkLease(operationId, owner);
    lease = ownedLease;
    if (operation.phase === 'cleaning') {
      await cleanupIncompleteFork(operation, ownedLease, deps);
      throw new ForkError(
        'FORK_SOURCE_UNAVAILABLE',
        'The source was deleted during fork creation.',
        404,
      );
    }
    if (operation.phase === 'native_creating') {
      // Neither provider offers an idempotent native fork RPC. Reissuing an
      // uncertain RPC can leak a second session; quarantine rather than guess.
      throw new ForkError(
        'FORK_NATIVE_OUTCOME_UNKNOWN',
        'The provider fork outcome is uncertain. This request will not create a duplicate session.',
      );
    }
    if (operation.phase === 'snapshotting') {
      if (snapshot.at(-1)?.turnId !== operation.snapshotLastTurnId)
        snapshot = selectForkSnapshot(
          (await deps.listTurns(source._id)).items.reverse(),
          operation.snapshotLastTurnId,
        );
      if (snapshot.length !== operation.snapshotCount)
        throw new ForkError(
          'FORK_SNAPSHOT_UNAVAILABLE',
          'The source history changed before its snapshot was frozen.',
        );
      // Each immutable snapshot record stays within the same per-turn BSON
      // bound as source history. No aggregate content/tool output enters the operation.
      // Bounded transactions fence staging writes without holding a Mongo
      // transaction open for the entire cumulative conversation history.
      for (
        let offset = 0;
        offset < snapshot.length;
        offset += FORK_WRITE_BATCH_SIZE
      ) {
        await mongoose.connection.transaction(async (session) => {
          await ownedLease.update({}, session);
          await ForkSnapshotModel.bulkWrite(
            snapshot
              .slice(offset, offset + FORK_WRITE_BATCH_SIZE)
              .map((turn, position) => ({
                updateOne: {
                  filter: {
                    _id: `${operationId}:${offset + position}`,
                    'turn.turnId': turn.turnId,
                  },
                  update: {
                    $setOnInsert: {
                      _id: `${operationId}:${offset + position}`,
                      operationId,
                      index: offset + position,
                      turn,
                    },
                  },
                  upsert: true,
                },
              })),
            { session },
          );
        });
      }
      snapshot = await readForkSnapshot(operation);
      await ownedLease.update({ phase: 'prepared' });
      operation.phase = 'prepared';
    } else {
      snapshot = await readForkSnapshot(operation);
    }
    boundary = resolveForkBoundary(snapshot, native.turns);
    if (!operation.nativeSessionId) {
      if (sourceProvider === 'copilot' && !boundary.turn.nextEventId) {
        // Only a whole-session native fork needs an idle source. The history
        // copy and retries never own or stop a source's later run.
        if (!tryAcquireConversationLock(source._id))
          throw new ForkError(
            'FORK_SNAPSHOT_BUSY',
            'The native history is still being persisted. Retry this fork shortly.',
          );
        sourceLock = getActiveRunOwnership(source._id)?.runToken;
        const previous = native;
        native = undefined;
        await previous.close();
        native = await deps.openNative('copilot', nativeId);
        boundary = resolveForkBoundary(snapshot, native.turns);
      }
      // Persist the uncertain-outcome fence under a live lease before issuing
      // the non-idempotent RPC. A takeover can never blindly repeat this call.
      await ownedLease.update({ phase: 'native_creating' });
      const child = await native.fork(
        boundary.turn,
        operation.runtimeConfig,
        operation.conversation.model,
        operation.workingDirectory,
      );
      // Once the independent native snapshot exists, Mongo copy/retry no longer
      // needs to hold the source idle or delay its next instruction.
      if (sourceLock) {
        releaseConversationLock(source._id, sourceLock);
        sourceLock = undefined;
      }
      operation.nativeSessionId = child;
      operation.phase = 'native_ready';
      await ownedLease.update({
        nativeSessionId: child,
        phase: 'native_ready',
      });
    }
    const childId = operation.nativeSessionId;
    const conversation = operation.conversation;
    conversation.fork!.nativeSessionId = childId;
    if (sourceProvider === 'codex') conversation.flags.threadId = childId;
    const handovers = conversation.fork!.pendingHandovers ?? [
      conversation.fork!.handover,
    ];
    if (
      sourceProvider === 'codex' &&
      (operation.phase === 'injection_uncertain' ||
        (claimedOperation.phase === 'injecting' &&
          claimedOperation.injectionWriterClosed !== true))
    ) {
      // Missing disk history is not proof of a lost injection: an expired
      // owner's writer may still flush it. Persist quarantine before probing,
      // including ownerless retries, so releasing this lease cannot erase it.
      await ownedLease.update({ phase: 'injection_uncertain' });
      operation.phase = 'injection_uncertain';
      for (const text of handovers) {
        if (!(await native.hasInjected(childId, text)))
          throw new ForkError(
            'FORK_INJECTION_OUTCOME_UNKNOWN',
            'The previous fork writer may still persist its handover. This request remains quarantined and will not inject it again; retry can recover once all handovers are durably present.',
          );
      }
    }
    if (
      ['injecting', 'injection_uncertain', 'native_ready'].includes(
        operation.phase,
      ) &&
      sourceProvider === 'codex'
    ) {
      const durableRecovery = operation.phase === 'injection_uncertain';
      if (!durableRecovery) {
        await ownedLease.update({
          phase: 'injecting',
          injectionWriterClosed: false,
        });
        operation.phase = 'injecting';
        // Latest fork-of-fork can have trailing visible handovers outside the
        // chosen native turn. Reinject those into the child, never the source.
        const lastAssistant = lastIndex(
          snapshot,
          (turn) => turn.role === 'assistant',
        );
        for (const turn of snapshot.slice(lastAssistant + 1)) {
          if (
            turn.fork?.handover &&
            !(await native.hasInjected(childId, turn.content))
          ) {
            await ownedLease.update();
            await native.inject(childId, turn.content);
          }
        }
        if (!(await native.hasInjected(childId, conversation.fork!.handover))) {
          await ownedLease.update();
          await native.inject(childId, conversation.fork!.handover);
        }
      }
      const writer = native;
      native = undefined;
      // Injection acknowledgement is not a durability boundary. Release this
      // owned child writer, then read persisted items before any publication.
      if (durableRecovery) await writer.close();
      else await closeInjectionWriter(writer, ownedLease);
      for (const text of handovers) {
        if (!(await writer.hasInjected(childId, text)))
          throw new ForkError(
            'FORK_HANDOVER_UNAVAILABLE',
            'The native handover was not persisted. Retry this fork request.',
          );
      }
      conversation.fork!.handoverDelivered = true;
      await ownedLease.update({ phase: 'copied', conversation });
      operation.phase = 'copied';
    }
    if (native) {
      const helper = native;
      native = undefined;
      await helper.close();
    }
    const displayOrders = new Map(
      orderForkDisplayHistory(snapshot).map((turn, index) => [
        turn.turnId,
        index,
      ]),
    );
    const rows: Array<Turn & { _id: mongoose.Types.ObjectId }> = snapshot.map(
      (turn, index) => ({
        _id: new mongoose.Types.ObjectId(
          crypto
            .createHash('sha256')
            .update(`${operationId}:${index}`)
            .digest('hex')
            .slice(0, 24),
        ),
        ...copyForkTurn(
          turn,
          conversation._id,
          childId,
          displayOrders.get(turn.turnId)!,
          index,
        ),
      }),
    );
    rows.push({
      _id: new mongoose.Types.ObjectId(
        crypto
          .createHash('sha256')
          .update(`${operationId}:handover`)
          .digest('hex')
          .slice(0, 24),
      ),
      conversationId: conversation._id,
      role: 'user',
      content: conversation.fork!.handover,
      provider: sourceProvider,
      model: conversation.model,
      source: 'REST',
      status: 'ok',
      toolCalls: null,
      createdAt: operation.handoverAt,
      displayOrder: rows.length,
      chronologicalOrder: rows.length,
      runtime: undefined,
      native: undefined,
      fork: { handover: true },
    });
    for (
      let offset = 0;
      offset < rows.length;
      offset += FORK_WRITE_BATCH_SIZE
    ) {
      await mongoose.connection.transaction(async (session) => {
        await ownedLease.update({}, session);
        await TurnModel.bulkWrite(
          rows.slice(offset, offset + FORK_WRITE_BATCH_SIZE).map((row) => ({
            updateOne: {
              filter: { _id: row._id },
              update: { $setOnInsert: row },
              upsert: true,
            },
          })),
          { session },
        );
      });
    }
    if (
      !(await ConversationModel.exists({
        _id: source._id,
        agentName: source.agentName,
        createdAt: source.createdAt,
      }))
    ) {
      await cleanupIncompleteFork(operation, ownedLease, deps);
      throw new ForkError(
        'FORK_SOURCE_UNAVAILABLE',
        'The source was deleted during fork creation.',
        404,
      );
    }
    // Ready and visibility must commit together: after a user deletes a
    // published child, retry must report deletion rather than resurrect it.
    // Stop renewal first so its own writes cannot conflict with this transaction.
    await ownedLease.stop();
    const ready = await mongoose.connection
      .transaction(async (session) => {
        await ownedLease.update({ phase: 'ready', conversation }, session);
        const sourceExists = await ConversationModel.findById(
          source._id,
          null,
          { session },
        )
          .lean()
          .exec();
        if (!sourceExists)
          throw new ForkError(
            'FORK_SOURCE_UNAVAILABLE',
            'The source was deleted during fork creation.',
            404,
          );
        const published = await ConversationModel.findOneAndUpdate(
          { _id: conversation._id },
          { $setOnInsert: conversation },
          // These frozen timestamps are already in $setOnInsert. Automatic
          // updatedAt would conflict with that path and change the fork time.
          { upsert: true, new: true, session, timestamps: false },
        )
          .lean()
          .exec();
        if (!published) throw new Error('Fork publication failed');
        return published;
      })
      .catch(async (error: unknown) => {
        if (
          error instanceof ForkError &&
          error.code === 'FORK_SOURCE_UNAVAILABLE'
        ) {
          const cleanupLease = maintainForkLease(operationId, owner);
          lease = cleanupLease;
          await cleanupIncompleteFork(operation!, cleanupLease, deps);
        }
        throw error;
      });
    if (!ready) throw new Error('Fork publication failed');
    await ForkSnapshotModel.deleteMany({ operationId }).catch(() => {
      // Published history is complete; retaining temporary owned snapshots is
      // a cleanup limitation, not a reason to report creation as failed.
      baseLogger.warn({ operationId }, 'Fork snapshot cleanup is pending');
    });
    emitConversationUpsert({
      conversationId: ready._id,
      provider: ready.provider,
      model: ready.model,
      title: ready.title,
      agentName: ready.agentName,
      source: ready.source,
      lastMessageAt: ready.lastMessageAt,
      archived: false,
      flags: ready.flags,
    });
    return resultFor(ready);
  } finally {
    if (sourceLock) releaseConversationLock(source._id, sourceLock);
    try {
      if (native) {
        if (
          sourceProvider === 'codex' &&
          operation?.phase === 'injecting' &&
          lease
        )
          await closeInjectionWriter(native, lease);
        else await native.close();
      }
    } finally {
      await lease?.stop();
      if (claimed)
        await ForkOperationModel.updateOne(
          { _id: operationId, owner },
          { $unset: { owner: 1, leaseUntil: 1 } },
        );
    }
  }
}
