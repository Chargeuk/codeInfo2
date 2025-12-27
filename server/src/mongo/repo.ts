import mongoose from 'mongoose';
import {
  ConversationModel,
  Conversation,
  ConversationProvider,
  ConversationSource,
} from './conversation.js';
import {
  TurnModel,
  Turn,
  TurnCommandMetadata,
  TurnRole,
  TurnStatus,
  TurnSource,
} from './turn.js';

export interface CreateConversationInput {
  conversationId: string;
  provider: ConversationProvider;
  model: string;
  title: string;
  agentName?: string;
  source?: ConversationSource;
  flags?: Record<string, unknown>;
  lastMessageAt?: Date;
}

export interface UpdateConversationMetaInput {
  conversationId: string;
  title?: string;
  model?: string;
  flags?: Record<string, unknown>;
  lastMessageAt?: Date;
}

export interface AppendTurnInput {
  conversationId: string;
  role: TurnRole;
  content: string;
  model: string;
  provider: string;
  source?: TurnSource;
  toolCalls?: Record<string, unknown> | null;
  status: TurnStatus;
  command?: TurnCommandMetadata;
  createdAt?: Date;
}

export interface ListConversationsParams {
  limit: number;
  cursor?: string | Date;
  state?: 'active' | 'archived' | 'all';
  includeArchived?: boolean;
  agentName?: string;
}

export interface ListTurnsParams {
  conversationId: string;
  limit: number;
  cursor?: string | Date;
}

export async function createConversation(
  input: CreateConversationInput,
): Promise<Conversation> {
  const doc = new ConversationModel({
    _id: input.conversationId,
    provider: input.provider,
    model: input.model,
    title: input.title,
    agentName: input.agentName,
    source: input.source ?? 'REST',
    flags: input.flags ?? {},
    lastMessageAt: input.lastMessageAt ?? new Date(),
  });

  return doc.save();
}

export async function updateConversationMeta(
  input: UpdateConversationMetaInput,
): Promise<Conversation | null> {
  const update: Partial<Conversation> = {} as Partial<Conversation>;

  if (input.title !== undefined) update.title = input.title;
  if (input.model !== undefined) update.model = input.model;
  if (input.flags !== undefined) update.flags = input.flags;
  if (input.lastMessageAt !== undefined)
    update.lastMessageAt = input.lastMessageAt;

  return ConversationModel.findByIdAndUpdate(input.conversationId, update, {
    new: true,
  }).exec();
}

export async function updateConversationThreadId({
  conversationId,
  threadId,
}: {
  conversationId: string;
  threadId: string;
}): Promise<Conversation | null> {
  // Avoid Mongoose buffering timeouts when Mongo is unavailable (tests and degraded runtime).
  if (mongoose.connection.readyState !== 1) return null;

  return ConversationModel.findByIdAndUpdate(
    conversationId,
    { $set: { 'flags.threadId': threadId } },
    { new: true },
  ).exec();
}

export async function archiveConversation(
  conversationId: string,
): Promise<Conversation | null> {
  return ConversationModel.findByIdAndUpdate(
    conversationId,
    { archivedAt: new Date() },
    { new: true },
  ).exec();
}

export async function restoreConversation(
  conversationId: string,
): Promise<Conversation | null> {
  return ConversationModel.findByIdAndUpdate(
    conversationId,
    { archivedAt: null },
    { new: true },
  ).exec();
}

export async function appendTurn(input: AppendTurnInput): Promise<Turn> {
  const createdAt = input.createdAt ?? new Date();
  const turn = await TurnModel.create({
    conversationId: input.conversationId,
    role: input.role,
    content: input.content,
    model: input.model,
    provider: input.provider,
    source: input.source ?? 'REST',
    toolCalls: input.toolCalls ?? null,
    status: input.status,
    command: input.command,
    createdAt,
  });

  await ConversationModel.findByIdAndUpdate(input.conversationId, {
    lastMessageAt: createdAt,
  }).exec();

  return turn;
}

export interface ConversationSummary {
  conversationId: string;
  provider: ConversationProvider;
  model: string;
  title: string;
  agentName?: string;
  source: ConversationSource;
  lastMessageAt: Date;
  archived: boolean;
  flags: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export async function listConversations(
  params: ListConversationsParams,
): Promise<{ items: ConversationSummary[] }> {
  const state =
    params.state ??
    (params.includeArchived ? ('all' as const) : ('active' as const));

  const query: Record<string, unknown> = {};
  if (state === 'active') {
    query.archivedAt = null;
  } else if (state === 'archived') {
    query.archivedAt = { $ne: null };
  }

  if (params.agentName !== undefined) {
    if (params.agentName === '__none__') {
      query.$or = [
        { agentName: { $exists: false } },
        { agentName: null },
        { agentName: '' },
      ];
    } else {
      query.agentName = params.agentName;
    }
  }

  if (params.cursor) {
    query.lastMessageAt = { $lt: toDate(params.cursor) };
  }

  const docs = (await ConversationModel.find(query)
    .sort({ lastMessageAt: -1, _id: -1 })
    .limit(params.limit)
    .lean()) as Conversation[];

  const items: ConversationSummary[] = docs.map((doc) => ({
    conversationId: doc._id,
    provider: doc.provider,
    model: doc.model,
    title: doc.title,
    agentName: doc.agentName,
    source: (doc as Conversation).source ?? 'REST',
    lastMessageAt: doc.lastMessageAt,
    archived: doc.archivedAt != null,
    flags: doc.flags ?? {},
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }));

  return { items };
}

export interface TurnSummary {
  conversationId: string;
  role: TurnRole;
  content: string;
  model: string;
  provider: string;
  source: TurnSource;
  toolCalls: Record<string, unknown> | null;
  status: TurnStatus;
  command?: TurnCommandMetadata;
  createdAt: Date;
}

export async function listTurns(
  params: ListTurnsParams,
): Promise<{ items: TurnSummary[] }> {
  const query: Record<string, unknown> = {
    conversationId: params.conversationId,
  };

  if (params.cursor) {
    query.createdAt = { $lt: toDate(params.cursor) };
  }

  const docs = (await TurnModel.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(params.limit)
    .lean()) as Turn[];

  const items: TurnSummary[] = docs.map((doc) => ({
    conversationId: doc.conversationId,
    role: doc.role,
    content: doc.content,
    model: doc.model,
    provider: doc.provider,
    source: (doc as Turn).source ?? 'REST',
    toolCalls: doc.toolCalls ?? null,
    status: doc.status,
    command: doc.command,
    createdAt: doc.createdAt,
  }));

  return { items };
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
