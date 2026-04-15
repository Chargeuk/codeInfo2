import mongoose, {
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

const { Schema, model, models } = mongoose;

export const ingestQueueStates = [
  'waiting',
  'running',
  'cleanup-blocked',
] as const;

export const ingestQueueOperations = ['start', 'reembed'] as const;

export type IngestQueueState = (typeof ingestQueueStates)[number];
export type IngestQueueOperation = (typeof ingestQueueOperations)[number];

const ingestQueueRequestSchema = new Schema(
  {
    canonicalTargetPath: { type: String, required: true, trim: true },
    operation: {
      type: String,
      enum: ingestQueueOperations,
      required: true,
    },
    queueState: {
      type: String,
      enum: ingestQueueStates,
      required: true,
    },
    requestPayload: { type: Schema.Types.Mixed, required: true },
    sourceSurface: { type: String, required: true, trim: true },
    runId: { type: String, default: null },
    nonReplayableAt: { type: Date, default: null },
    terminalPublishedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'ingest_queue_requests',
  },
);

ingestQueueRequestSchema.index(
  { canonicalTargetPath: 1, queueState: 1 },
  { name: 'ingest_queue_target_state_idx' },
);
ingestQueueRequestSchema.index(
  { canonicalTargetPath: 1 },
  {
    name: 'ingest_queue_live_target_unique_idx',
    unique: true,
    partialFilterExpression: {
      queueState: { $in: ['waiting', 'running', 'cleanup-blocked'] },
    },
  },
);
ingestQueueRequestSchema.index(
  { queueState: 1, createdAt: 1, _id: 1 },
  { name: 'ingest_queue_waiting_fifo_idx' },
);

export type IngestQueueRequest = {
  _id: Types.ObjectId;
  canonicalTargetPath: string;
  operation: IngestQueueOperation;
  queueState: IngestQueueState;
  requestPayload: Record<string, unknown>;
  sourceSurface: string;
  runId: string | null;
  nonReplayableAt: Date | null;
  terminalPublishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type IngestQueueRequestDocument = HydratedDocument<IngestQueueRequest>;

export const IngestQueueRequestModel: Model<IngestQueueRequest> =
  models.IngestQueueRequest ||
  model<IngestQueueRequest>('IngestQueueRequest', ingestQueueRequestSchema);
