import mongoose, { type HydratedDocument, type Model } from 'mongoose';

const { Schema, model, models } = mongoose;

export type TurnRole = 'user' | 'assistant' | 'system';
export type TurnStatus = 'ok' | 'stopped' | 'failed';

export interface Turn {
  conversationId: string;
  role: TurnRole;
  content: string;
  model: string;
  provider: string;
  toolCalls: Record<string, unknown> | null;
  status: TurnStatus;
  createdAt: Date;
}

export type TurnDocument = HydratedDocument<Turn>;

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
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

turnSchema.index({ conversationId: 1, createdAt: -1 });

export const TurnModel: Model<Turn> =
  models.Turn || model<Turn>('Turn', turnSchema);
