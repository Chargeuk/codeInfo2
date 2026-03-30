import mongoose from 'mongoose';
import {
  IngestQueueRequestModel,
  type IngestQueueOperation,
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
