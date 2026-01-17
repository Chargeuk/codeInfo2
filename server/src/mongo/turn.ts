import mongoose, { type HydratedDocument, type Model } from 'mongoose';

const { Schema, model, models } = mongoose;

export type TurnRole = 'user' | 'assistant' | 'system';
export type TurnStatus = 'ok' | 'stopped' | 'failed';
export type TurnSource = 'REST' | 'MCP';

export type TurnCommandMetadata =
  | {
      name: string;
      stepIndex: number;
      totalSteps: number;
    }
  | {
      name: 'flow';
      stepIndex: number;
      totalSteps: number;
      loopDepth: number;
      agentType: string;
      identifier: string;
      label: string;
    };

export interface TurnUsageMetadata {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
}

export interface TurnTimingMetadata {
  totalTimeSec?: number;
  tokensPerSecond?: number;
}

export interface Turn {
  conversationId: string;
  role: TurnRole;
  content: string;
  model: string;
  provider: string;
  toolCalls: Record<string, unknown> | null;
  status: TurnStatus;
  source: TurnSource;
  command?: TurnCommandMetadata;
  usage?: TurnUsageMetadata;
  timing?: TurnTimingMetadata;
  createdAt: Date;
}

export type TurnDocument = HydratedDocument<Turn>;

const turnCommandSchema = new Schema<TurnCommandMetadata>(
  {
    name: { type: String, required: true },
    stepIndex: { type: Number, required: true },
    totalSteps: { type: Number, required: true },
    loopDepth: { type: Number, required: false },
    agentType: { type: String, required: false },
    identifier: { type: String, required: false },
    label: { type: String, required: false },
  },
  { _id: false },
);

const turnUsageSchema = new Schema<TurnUsageMetadata>(
  {
    inputTokens: { type: Number, required: false },
    outputTokens: { type: Number, required: false },
    totalTokens: { type: Number, required: false },
    cachedInputTokens: { type: Number, required: false },
  },
  { _id: false },
);

const turnTimingSchema = new Schema<TurnTimingMetadata>(
  {
    totalTimeSec: { type: Number, required: false },
    tokensPerSecond: { type: Number, required: false },
  },
  { _id: false },
);

const turnSchema = new Schema<Turn>(
  {
    conversationId: { type: String, required: true, index: true },
    role: {
      type: String,
      enum: ['user', 'assistant', 'system'],
      required: true,
    },
    content: { type: String, required: true },
    model: { type: String, required: true },
    provider: { type: String, required: true },
    toolCalls: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: ['ok', 'stopped', 'failed'], required: true },
    source: { type: String, enum: ['REST', 'MCP'], default: 'REST' },
    command: { type: turnCommandSchema, required: false },
    usage: { type: turnUsageSchema, required: false },
    timing: { type: turnTimingSchema, required: false },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

turnSchema.index({ conversationId: 1, createdAt: -1 });

export const TurnModel: Model<Turn> =
  models.Turn || model<Turn>('Turn', turnSchema);
