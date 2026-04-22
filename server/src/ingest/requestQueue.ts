import mongoose from 'mongoose';
import {
  ingestLiveQueueTargetStates,
  IngestQueueRequestModel,
  type IngestQueueOperation,
  type IngestQueueState,
  type IngestQueueRequest,
} from '../mongo/ingestQueueRequest.js';

export type EnqueueQueueUnavailableError = Error & {
  code: 'QUEUE_UNAVAILABLE';
  status: 503;
  retryable: true;
};

export type EnqueueIngestRequestInput = {
  canonicalTargetPath: string;
  operation: IngestQueueOperation;
  requestPayload: Record<string, unknown>;
  sourceSurface: string;
};

export type EnqueueIngestRequestResult = {
  requestId: string;
  canonicalTargetPath: string;
  queueState: IngestQueueState;
  queuePosition: number | null;
  runId: string | null;
  reusedExisting: boolean;
  updatedExisting: boolean;
  queueRequest: IngestQueueRequest;
};

export type CurrentQueueRequestPositionResult = {
  requestId: string;
  queueState: IngestQueueState | null;
  queuePosition: number | null;
  runId: string | null;
};

export type QueueRequestDocumentFilter = {
  canonicalTargetPath?: string;
  queueState?: IngestQueueState;
  runId?: string | null;
};

type IngestQueueAvailability = {
  available: boolean;
  message: string | null;
};

export const QUEUE_REQUEST_UPDATED_IN_PLACE_LOG_MESSAGE =
  'QUEUE_REQUEST_UPDATED_IN_PLACE';

let ingestQueueAvailability: IngestQueueAvailability = {
  available: true,
  message: null,
};

function createQueueUnavailableError(
  message = 'Mongo-backed ingest queue is unavailable while Mongo is disconnected',
): EnqueueQueueUnavailableError {
  const error = new Error(message) as EnqueueQueueUnavailableError;
  error.code = 'QUEUE_UNAVAILABLE';
  error.status = 503;
  error.retryable = true;
  return error;
}

export function clearIngestQueueUnavailable() {
  ingestQueueAvailability = {
    available: true,
    message: null,
  };
}

export function markIngestQueueUnavailable(message: string) {
  ingestQueueAvailability = {
    available: false,
    message,
  };
}

export function getIngestQueueAvailability(): IngestQueueAvailability {
  return { ...ingestQueueAvailability };
}

export function __resetIngestQueueAvailabilityForTest() {
  clearIngestQueueUnavailable();
}

function toRequestId(value: IngestQueueRequest['_id']): string {
  return value.toString();
}

function isDuplicateLiveQueueTargetError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

export function getQueueRequestId(queueRequest: IngestQueueRequest): string {
  return toRequestId(queueRequest._id);
}

async function countOlderWaitingRequests(
  queueRequest: IngestQueueRequest,
): Promise<number> {
  const olderCount = await IngestQueueRequestModel.countDocuments({
    queueState: 'waiting',
    $or: [
      { createdAt: { $lt: queueRequest.createdAt } },
      {
        createdAt: queueRequest.createdAt,
        _id: { $lt: queueRequest._id },
      },
    ],
  }).exec();

  return olderCount + 1;
}

function buildQueueResult(params: {
  queueRequest: IngestQueueRequest;
  queuePosition: number | null;
  reusedExisting: boolean;
  updatedExisting: boolean;
}): EnqueueIngestRequestResult {
  return {
    requestId: toRequestId(params.queueRequest._id),
    canonicalTargetPath: params.queueRequest.canonicalTargetPath,
    queueState: params.queueRequest.queueState,
    queuePosition: params.queuePosition,
    runId: params.queueRequest.runId ?? null,
    reusedExisting: params.reusedExisting,
    updatedExisting: params.updatedExisting,
    queueRequest: params.queueRequest,
  };
}

async function buildReusedWaitingQueueResult(
  queueRequest: IngestQueueRequest,
): Promise<EnqueueIngestRequestResult> {
  return buildQueueResult({
    queueRequest,
    queuePosition: await countOlderWaitingRequests(queueRequest),
    reusedExisting: true,
    updatedExisting: false,
  });
}

async function buildUpdatedWaitingQueueResult(
  queueRequest: IngestQueueRequest,
): Promise<EnqueueIngestRequestResult> {
  return buildQueueResult({
    queueRequest,
    queuePosition: await countOlderWaitingRequests(queueRequest),
    reusedExisting: true,
    updatedExisting: true,
  });
}

async function buildCurrentQueueReuseResult(
  queueRequest: IngestQueueRequest,
): Promise<EnqueueIngestRequestResult> {
  const refreshedQueueRequest =
    (await findQueueRequestById(toRequestId(queueRequest._id))) ?? queueRequest;

  if (refreshedQueueRequest.queueState === 'waiting') {
    return buildReusedWaitingQueueResult(refreshedQueueRequest);
  }

  return buildQueueResult({
    queueRequest: refreshedQueueRequest,
    queuePosition: null,
    reusedExisting: true,
    updatedExisting: false,
  });
}

async function findLiveQueueRequestForTarget(
  canonicalTargetPath: string,
): Promise<IngestQueueRequest | null> {
  return IngestQueueRequestModel.findOne({
    canonicalTargetPath,
    queueState: { $in: ingestLiveQueueTargetStates },
  })
    .sort({ queueState: 1, createdAt: 1, _id: 1 })
    .exec();
}

async function findWaitingQueueRequestForTarget(
  canonicalTargetPath: string,
): Promise<IngestQueueRequest | null> {
  return IngestQueueRequestModel.findOne({
    canonicalTargetPath,
    queueState: 'waiting',
  })
    .sort({ createdAt: 1, _id: 1 })
    .exec();
}

function shouldRewriteWaitingRequest(
  waitingRequest: IngestQueueRequest,
): boolean {
  return waitingRequest.queueState === 'waiting';
}

function buildRewriteableWaitingRequestFilter(
  input: EnqueueIngestRequestInput,
): Record<string, unknown> {
  return {
    canonicalTargetPath: input.canonicalTargetPath,
    queueState: 'waiting',
  };
}

function buildWaitingRequestUpdate(input: EnqueueIngestRequestInput) {
  return {
    $set: {
      operation: input.operation,
      requestPayload: input.requestPayload,
    },
  };
}

async function rewriteWaitingQueueRequestIfAllowed(
  input: EnqueueIngestRequestInput,
): Promise<IngestQueueRequest | null> {
  const filter = buildRewriteableWaitingRequestFilter(input);
  const update = buildWaitingRequestUpdate(input);
  return IngestQueueRequestModel.findOneAndUpdate(filter, update, {
    new: true,
  }).exec();
}

export async function enqueueOrReuseIngestRequest(
  input: EnqueueIngestRequestInput,
): Promise<EnqueueIngestRequestResult> {
  if (!ingestQueueAvailability.available) {
    throw createQueueUnavailableError(
      ingestQueueAvailability.message ??
        'Mongo-backed ingest queue is unavailable',
    );
  }

  if (mongoose.connection.readyState !== 1) {
    throw createQueueUnavailableError();
  }

  const existingWaitingRequest = await findWaitingQueueRequestForTarget(
    input.canonicalTargetPath,
  );

  if (
    existingWaitingRequest &&
    !shouldRewriteWaitingRequest(existingWaitingRequest)
  ) {
    return buildCurrentQueueReuseResult(existingWaitingRequest);
  }

  const waitingRequest = await rewriteWaitingQueueRequestIfAllowed(input);

  if (waitingRequest) {
    return buildUpdatedWaitingQueueResult(waitingRequest);
  }

  const liveRequest = await findLiveQueueRequestForTarget(
    input.canonicalTargetPath,
  );

  if (liveRequest) {
    return buildQueueResult({
      queueRequest: liveRequest,
      queuePosition:
        liveRequest.queueState === 'waiting'
          ? await countOlderWaitingRequests(liveRequest)
          : null,
      reusedExisting: true,
      updatedExisting: false,
    });
  }

  let queueRequest: IngestQueueRequest;
  try {
    queueRequest = await IngestQueueRequestModel.create({
      canonicalTargetPath: input.canonicalTargetPath,
      operation: input.operation,
      queueState: 'waiting',
      requestPayload: input.requestPayload,
      sourceSurface: input.sourceSurface,
      runId: null,
    });
  } catch (error) {
    if (!isDuplicateLiveQueueTargetError(error)) {
      throw error;
    }

    const racedExistingWaitingRequest = await findWaitingQueueRequestForTarget(
      input.canonicalTargetPath,
    );

    if (
      racedExistingWaitingRequest &&
      !shouldRewriteWaitingRequest(racedExistingWaitingRequest)
    ) {
      return buildCurrentQueueReuseResult(racedExistingWaitingRequest);
    }

    const racedWaitingRequest =
      await rewriteWaitingQueueRequestIfAllowed(input);

    if (racedWaitingRequest) {
      return buildUpdatedWaitingQueueResult(racedWaitingRequest);
    }

    const racedLiveRequest = await findLiveQueueRequestForTarget(
      input.canonicalTargetPath,
    );

    if (racedLiveRequest) {
      return buildQueueResult({
        queueRequest: racedLiveRequest,
        queuePosition:
          racedLiveRequest.queueState === 'waiting'
            ? await countOlderWaitingRequests(racedLiveRequest)
            : null,
        reusedExisting: true,
        updatedExisting: false,
      });
    }

    throw error;
  }

  return buildQueueResult({
    queueRequest,
    queuePosition: await countOlderWaitingRequests(queueRequest),
    reusedExisting: false,
    updatedExisting: false,
  });
}

async function findOldestQueueRequestByState(
  queueState: IngestQueueState,
): Promise<IngestQueueRequest | null> {
  return IngestQueueRequestModel.findOne({ queueState })
    .sort({ createdAt: 1, _id: 1 })
    .exec();
}

export async function findOldestWaitingQueueRequest() {
  return findOldestQueueRequestByState('waiting');
}

export async function findOldestRunningQueueRequest() {
  return findOldestQueueRequestByState('running');
}

export async function findOldestCleanupBlockedQueueRequest() {
  return findOldestQueueRequestByState('cleanup-blocked');
}

export async function findQueueRequestById(requestId: string) {
  return IngestQueueRequestModel.findById(requestId).exec();
}

export async function getCurrentQueueRequestPosition(
  requestId: string,
): Promise<CurrentQueueRequestPositionResult> {
  const queueRequest = await findQueueRequestById(requestId);

  if (!queueRequest) {
    return {
      requestId,
      queueState: null,
      queuePosition: null,
      runId: null,
    };
  }

  return {
    requestId,
    queueState: queueRequest.queueState,
    queuePosition:
      queueRequest.queueState === 'waiting'
        ? await countOlderWaitingRequests(queueRequest)
        : null,
    runId: queueRequest.runId ?? null,
  };
}

export async function findQueueRequestByRunId(runId: string) {
  return IngestQueueRequestModel.findOne({ runId }).exec();
}

export async function promoteOldestWaitingQueueRequest(runId: string) {
  return IngestQueueRequestModel.findOneAndUpdate(
    { queueState: 'waiting', runId: null },
    {
      $set: {
        queueState: 'running',
        runId,
        nonReplayableAt: null,
        terminalPublishedAt: null,
      },
    },
    {
      new: true,
      sort: { createdAt: 1, _id: 1 },
    },
  ).exec();
}

export async function ensureQueueRequestRunId(
  requestId: string,
  runId: string,
): Promise<IngestQueueRequest | null> {
  return IngestQueueRequestModel.findByIdAndUpdate(
    requestId,
    {
      $set: {
        runId,
      },
    },
    {
      new: true,
    },
  ).exec();
}

export async function markQueueRequestCleanupBlocked(params: {
  requestId: string;
  runId: string | null;
}) {
  return IngestQueueRequestModel.findByIdAndUpdate(
    params.requestId,
    {
      $set: {
        queueState: 'cleanup-blocked',
        runId: params.runId,
      },
    },
    {
      new: true,
    },
  ).exec();
}

export async function markQueueRequestTerminalPublished(params: {
  requestId: string;
  runId: string | null;
}) {
  return IngestQueueRequestModel.findByIdAndUpdate(
    params.requestId,
    {
      $set: {
        runId: params.runId,
        terminalPublishedAt: new Date(),
      },
    },
    {
      new: true,
    },
  ).exec();
}

export async function markQueueRequestNonReplayable(params: {
  requestId: string;
  runId: string | null;
}) {
  return IngestQueueRequestModel.findByIdAndUpdate(
    params.requestId,
    {
      $set: {
        runId: params.runId,
        nonReplayableAt: new Date(),
      },
    },
    {
      new: true,
    },
  ).exec();
}

export async function deleteQueueRequestById(requestId: string) {
  return IngestQueueRequestModel.findByIdAndDelete(requestId).exec();
}

export async function deleteWaitingQueueRequestsByTargetPath(
  canonicalTargetPath: string,
) {
  const result = await IngestQueueRequestModel.deleteMany({
    canonicalTargetPath,
    queueState: 'waiting',
    runId: null,
  }).exec();

  return result.deletedCount ?? 0;
}
