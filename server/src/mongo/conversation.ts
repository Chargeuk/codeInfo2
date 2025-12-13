import mongoose, { type HydratedDocument, type Model } from 'mongoose';

const { Schema, model, models } = mongoose;

export type ConversationProvider = 'lmstudio' | 'codex';
export type ConversationSource = 'REST' | 'MCP';

export interface Conversation {
  _id: string; // conversation id (Codex thread id for Codex provider)
  provider: ConversationProvider;
  model: string;
  title: string;
  agentName?: string;
  source: ConversationSource;
  flags: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
  archivedAt: Date | null;
}

export type ConversationDocument = HydratedDocument<Conversation>;

const conversationSchema = new Schema<Conversation>(
  {
    _id: { type: String, required: true },
    provider: { type: String, enum: ['lmstudio', 'codex'], required: true },
    model: { type: String, required: true },
    title: { type: String, required: true },
    agentName: { type: String },
    source: { type: String, enum: ['REST', 'MCP'], default: 'REST' },
    flags: { type: Schema.Types.Mixed, default: {} },
    lastMessageAt: { type: Date, required: true, default: () => new Date() },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

conversationSchema.index({ archivedAt: 1, lastMessageAt: -1 });
conversationSchema.index({ agentName: 1, archivedAt: 1, lastMessageAt: -1 });

export const ConversationModel: Model<Conversation> =
  models.Conversation ||
  model<Conversation>('Conversation', conversationSchema);
