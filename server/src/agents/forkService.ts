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
  last,
  lastIndex,
  orderForkDisplayHistory,
  resolveForkBoundary,
  selectForkSnapshot,
} from './forkHistory.js';
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
) {
  const { turnId, runtime, ...history } = turn;
  return {
    ...history,
    conversationId,
    displayOrder,
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

async function executeFork(
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
          $or: [
            { owner: { $exists: false } },
            { leaseUntil: { $lt: new Date() } },
          ],
        },
        {
          $set: {
            owner: cleanupOwner,
            leaseUntil: new Date(Date.now() + 300_000),
          },
        },
        { new: true },
      )
        .lean()
        .exec();
      if (owned) {
        try {
          if (
            owned.nativeSessionId &&
            owned.nativeSessionId === owned.sourceNativeSessionId
          )
            throw new ForkError(
              'FORK_CLEANUP_UNAVAILABLE',
              'Cannot establish independent fork ownership.',
            );
          if (owned.nativeSessionId)
            await (deps.removeOwnedNative ?? removeOwnedNativeFork)(
              owned.conversation.provider as 'codex' | 'copilot',
              owned.nativeSessionId,
            );
          await TurnModel.deleteMany({ conversationId: owned.conversationId });
          await ForkSnapshotModel.deleteMany({ operationId });
          await ForkOperationModel.updateOne(
            { _id: operationId, owner: cleanupOwner },
            {
              $set: {
                phase: 'failed',
                error: 'The source was deleted during fork creation.',
              },
            },
          );
        } finally {
          await ForkOperationModel.updateOne(
            { _id: operationId, owner: cleanupOwner },
            { $unset: { owner: 1, leaseUntil: 1 } },
          );
        }
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
  try {
    native = await deps.openNative(
      sourceProvider as 'codex' | 'copilot',
      nativeId,
    );
    let snapshot =
      operation && operation.phase !== 'snapshotting'
        ? await readForkSnapshot(operation)
        : selectForkSnapshot(
            (await deps.listTurns(source._id)).items.reverse(),
            operation?.snapshotLastTurnId ?? input.sourceTurnId,
          );
    let boundary = resolveForkBoundary(snapshot, native.turns);

    if (!operation) {
      const conversationId = crypto.randomUUID();
      const now = new Date(
        Math.max(
          Date.now(),
          ...snapshot.map((turn) => turn.createdAt.getTime()),
        ) + 1,
      );
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
    const claimedOperation = await ForkOperationModel.findOneAndUpdate(
      {
        _id: operationId,
        $or: [
          { owner: { $exists: false } },
          { leaseUntil: { $lt: new Date() } },
        ],
      },
      { $set: { owner, leaseUntil: new Date(Date.now() + 300_000) } },
      { new: true },
    )
      .lean()
      .exec();
    if (!claimedOperation)
      throw new ForkError(
        'FORK_CREATING',
        'This fork is being created. Retry with the same request identity.',
      );
    operation = claimedOperation;
    claimed = true;
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
      await ForkSnapshotModel.bulkWrite(
        snapshot.map((turn, index) => ({
          updateOne: {
            filter: {
              _id: `${operationId}:${index}`,
              'turn.turnId': turn.turnId,
            },
            update: {
              $setOnInsert: {
                _id: `${operationId}:${index}`,
                operationId,
                index,
                turn,
              },
            },
            upsert: true,
          },
        })),
      );
      snapshot = await readForkSnapshot(operation);
      await ForkOperationModel.updateOne(
        { _id: operationId, owner },
        { $set: { phase: 'prepared' } },
      );
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
      await ForkOperationModel.updateOne(
        { _id: operationId, owner },
        { $set: { phase: 'native_creating' } },
      );
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
      await ForkOperationModel.updateOne(
        { _id: operationId, owner },
        { $set: { nativeSessionId: child, phase: 'native_ready' } },
      );
    }
    const childId = operation.nativeSessionId;
    const conversation = operation.conversation;
    conversation.fork!.nativeSessionId = childId;
    if (sourceProvider === 'codex') conversation.flags.threadId = childId;
    if (
      ['injecting', 'native_ready'].includes(operation.phase) &&
      sourceProvider === 'codex'
    ) {
      await ForkOperationModel.updateOne(
        { _id: operationId, owner },
        { $set: { phase: 'injecting' } },
      );
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
        )
          await native.inject(childId, turn.content);
      }
      if (!(await native.hasInjected(childId, conversation.fork!.handover)))
        await native.inject(childId, conversation.fork!.handover);
      const writer = native;
      native = undefined;
      // Injection acknowledgement is not a durability boundary. Release this
      // owned child writer, then read persisted items before any publication.
      await writer.close();
      for (const text of conversation.fork!.pendingHandovers ?? [
        conversation.fork!.handover,
      ]) {
        if (!(await writer.hasInjected(childId, text)))
          throw new ForkError(
            'FORK_HANDOVER_UNAVAILABLE',
            'The native handover was not persisted. Retry this fork request.',
          );
      }
      conversation.fork!.handoverDelivered = true;
      await ForkOperationModel.updateOne(
        { _id: operationId, owner },
        { $set: { phase: 'copied', conversation } },
      );
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
      runtime: undefined,
      native: undefined,
      fork: { handover: true },
    });
    await TurnModel.bulkWrite(
      rows.map((row) => ({
        updateOne: {
          filter: { _id: row._id },
          update: { $setOnInsert: row },
          upsert: true,
        },
      })),
    );
    if (
      !(await ConversationModel.exists({
        _id: source._id,
        agentName: source.agentName,
        createdAt: source.createdAt,
      }))
    ) {
      await TurnModel.deleteMany({ conversationId: conversation._id });
      if (childId === operation.sourceNativeSessionId)
        throw new ForkError(
          'FORK_CLEANUP_UNAVAILABLE',
          'Cannot establish independent fork ownership.',
        );
      await (deps.removeOwnedNative ?? removeOwnedNativeFork)(
        sourceProvider as 'codex' | 'copilot',
        childId,
      );
      await ForkSnapshotModel.deleteMany({ operationId });
      await ForkOperationModel.updateOne(
        { _id: operationId, owner },
        {
          $set: {
            phase: 'failed',
            error: 'The source was deleted during fork creation.',
          },
        },
      );
      throw new ForkError(
        'FORK_SOURCE_UNAVAILABLE',
        'The source was deleted during fork creation.',
        404,
      );
    }
    // Publication is the final single-document write. Staged turns have no
    // visible conversation, and deterministic IDs make partial copy retryable.
    const ready = await ConversationModel.findOneAndUpdate(
      { _id: conversation._id },
      { $setOnInsert: conversation },
      { upsert: true, new: true },
    )
      .lean()
      .exec();
    if (!ready) throw new Error('Fork publication failed');
    await ForkOperationModel.updateOne(
      { _id: operationId, owner },
      { $set: { phase: 'ready', conversation } },
    );
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
      if (native) await native.close();
    } finally {
      if (claimed)
        await ForkOperationModel.updateOne(
          { _id: operationId, owner },
          { $unset: { owner: 1, leaseUntil: 1 } },
        );
    }
  }
}
