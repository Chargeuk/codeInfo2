import mongoose from 'mongoose';
import {
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
  queueState: 'waiting' | 'running';
  queuePosition: number | null;
  runId: string | null;
  reusedExisting: boolean;
  updatedExisting: boolean;
  queueRequest: IngestQueueRequest;
};

export type QueueRequestDocumentFilter = {
  canonicalTargetPath?: string;
  queueState?: IngestQueueState;
  runId?: string | null;
};

function createQueueUnavailableError(): EnqueueQueueUnavailableError {
  const error = new Error(
    'Mongo-backed ingest queue is unavailable while Mongo is disconnected',
  ) as EnqueueQueueUnavailableError;
  error.code = 'QUEUE_UNAVAILABLE';
  error.status = 503;
  error.retryable = true;
  return error;
}

function toRequestId(value: IngestQueueRequest['_id']): string {
  return value.toString();
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
    queueState:
      params.queueRequest.queueState === 'running' ? 'running' : 'waiting',
    queuePosition: params.queuePosition,
    runId: params.queueRequest.runId ?? null,
    reusedExisting: params.reusedExisting,
    updatedExisting: params.updatedExisting,
    queueRequest: params.queueRequest,
  };
}

export async function enqueueOrReuseIngestRequest(
  input: EnqueueIngestRequestInput,
): Promise<EnqueueIngestRequestResult> {
  if (mongoose.connection.readyState !== 1) {
    throw createQueueUnavailableError();
  }

  const waitingRequest = await IngestQueueRequestModel.findOneAndUpdate(
    {
      canonicalTargetPath: input.canonicalTargetPath,
      queueState: 'waiting',
    },
    {
      $set: {
        operation: input.operation,
        requestPayload: input.requestPayload,
      },
    },
    {
      new: true,
    },
  ).exec();

  if (waitingRequest) {
    return buildQueueResult({
      queueRequest: waitingRequest,
      queuePosition: await countOlderWaitingRequests(waitingRequest),
      reusedExisting: true,
      updatedExisting: true,
    });
  }

  const runningRequest = await IngestQueueRequestModel.findOne({
    canonicalTargetPath: input.canonicalTargetPath,
    queueState: 'running',
  }).exec();

  if (runningRequest) {
    return buildQueueResult({
      queueRequest: runningRequest,
      queuePosition: null,
      reusedExisting: true,
      updatedExisting: false,
    });
  }

  const queueRequest = await IngestQueueRequestModel.create({
    canonicalTargetPath: input.canonicalTargetPath,
    operation: input.operation,
    queueState: 'waiting',
    requestPayload: input.requestPayload,
    sourceSurface: input.sourceSurface,
    runId: null,
  });

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

export async function deleteQueueRequestById(requestId: string) {
  return IngestQueueRequestModel.findByIdAndDelete(requestId).exec();
}
