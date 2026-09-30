import mongoose from 'mongoose';
import type { Conversation } from './conversation.js';
import type { TurnSummary } from './repo.js';

export interface ForkOperation {
  _id: string;
  inputKey: string;
  conversationId: string;
  sourceId: string;
  sourceNativeSessionId: string;
  targetAgentName: string;
  phase:
    | 'snapshotting'
    | 'prepared'
    | 'native_creating'
    | 'native_ready'
    | 'injecting'
    | 'copied'
    | 'ready'
    | 'failed';
  owner?: string;
  leaseUntil?: Date;
  nativeSessionId?: string;
  snapshotCount: number;
  snapshotLastTurnId: string;
  conversation: Conversation;
  handoverAt: Date;
  runtimeConfig: Record<string, unknown>;
  workingDirectory?: string;
  error?: string;
}

const schema = new mongoose.Schema<ForkOperation>(
  {
    _id: { type: String, required: true },
    inputKey: { type: String, required: true },
    conversationId: { type: String, required: true },
    sourceId: { type: String, required: true },
    sourceNativeSessionId: { type: String, required: true },
    targetAgentName: { type: String, required: true },
    phase: { type: String, required: true },
    owner: String,
    leaseUntil: Date,
    nativeSessionId: String,
    snapshotCount: { type: Number, required: true },
    snapshotLastTurnId: { type: String, required: true },
    conversation: { type: mongoose.Schema.Types.Mixed, required: true },
    handoverAt: { type: Date, required: true },
    runtimeConfig: { type: mongoose.Schema.Types.Mixed, required: true },
    workingDirectory: String,
    error: String,
  },
  { timestamps: true },
);

export const ForkOperationModel =
  (mongoose.models.ForkOperation as
    | mongoose.Model<ForkOperation>
    | undefined) ?? mongoose.model<ForkOperation>('ForkOperation', schema);

// Tool output can make a valid conversation larger than Mongo's document limit.
// Freeze each existing turn separately; operation metadata must stay small.
export interface ForkSnapshot {
  _id: string;
  operationId: string;
  index: number;
  turn: TurnSummary;
}
const snapshotSchema = new mongoose.Schema<ForkSnapshot>({
  _id: { type: String, required: true },
  operationId: { type: String, required: true, index: true },
  index: { type: Number, required: true },
  turn: { type: mongoose.Schema.Types.Mixed, required: true },
});
export const ForkSnapshotModel =
  (mongoose.models.ForkSnapshot as mongoose.Model<ForkSnapshot> | undefined) ??
  mongoose.model<ForkSnapshot>('ForkSnapshot', snapshotSchema);
