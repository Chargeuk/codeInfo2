import mongoose from 'mongoose';
import { append } from '../logStore.js';
import {
  ConversationModel,
  Conversation,
  ConversationProvider,
  ConversationSource,
} from './conversation.js';
import {
  emitConversationDelete,
  emitConversationUpsert,
  type ConversationEventSummary,
} from './events.js';
import { IngestFileModel } from './ingestFile.js';
import {
  TurnModel,
  Turn,
  TurnCommandMetadata,
  TurnRole,
  TurnStatus,
  TurnSource,
} from './turn.js';

append({
  level: 'info',
  message: '0000020 ingest_files repo helpers ready',
  timestamp: new Date().toISOString(),
  source: 'server',
  context: { module: 'server/src/mongo/repo.ts' },
});

function toConversationEvent(doc: Conversation): ConversationEventSummary {
  return {
    conversationId: doc._id,
    provider: doc.provider,
    model: doc.model,
    title: doc.title,
    agentName: doc.agentName,
    source: (doc as Conversation).source ?? 'REST',
    lastMessageAt: doc.lastMessageAt,
    archived: doc.archivedAt != null,
    flags: doc.flags ?? {},
  };
}

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

  const saved = await doc.save();
  emitConversationUpsert(toConversationEvent(saved));
  return saved;
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

  const updated = await ConversationModel.findByIdAndUpdate(
    input.conversationId,
    update,
    {
      new: true,
    },
  ).exec();
  if (updated) emitConversationUpsert(toConversationEvent(updated));
  return updated;
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

  const updated = await ConversationModel.findByIdAndUpdate(
    conversationId,
    { $set: { 'flags.threadId': threadId } },
    { new: true },
  ).exec();
  if (updated) emitConversationUpsert(toConversationEvent(updated));
  return updated;
}

export async function archiveConversation(
  conversationId: string,
): Promise<Conversation | null> {
  const updated = await ConversationModel.findByIdAndUpdate(
    conversationId,
    { archivedAt: new Date() },
    { new: true },
  ).exec();
  if (updated) emitConversationUpsert(toConversationEvent(updated));
  return updated;
}

export async function restoreConversation(
  conversationId: string,
): Promise<Conversation | null> {
  const updated = await ConversationModel.findByIdAndUpdate(
    conversationId,
    { archivedAt: null },
    { new: true },
  ).exec();
  if (updated) emitConversationUpsert(toConversationEvent(updated));
  return updated;
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

  const updated = await ConversationModel.findByIdAndUpdate(
    input.conversationId,
    {
      lastMessageAt: createdAt,
    },
    { new: true },
  ).exec();
  if (updated) emitConversationUpsert(toConversationEvent(updated));

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
  turnId: string;
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
    .lean()) as Array<Turn & { _id?: unknown }>;

  const items: TurnSummary[] = docs.map((doc) => ({
    turnId: String(doc._id ?? ''),
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

type ConversationLite = { _id: string; archivedAt?: Date | null };

export type BulkConversationConflict = {
  status: 'conflict';
  invalidIds: string[];
  invalidStateIds: string[];
};

export type BulkConversationUpdateResult =
  | { status: 'ok'; updatedCount: number }
  | BulkConversationConflict;

export type BulkConversationDeleteResult =
  | { status: 'ok'; deletedCount: number }
  | BulkConversationConflict;

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

async function validateConversationIds(conversationIds: string[]): Promise<{
  uniqueIds: string[];
  docs: ConversationLite[];
  invalidIds: string[];
}> {
  const uniqueIds = uniqueStrings(conversationIds);
  const docs = (await ConversationModel.find({
    _id: { $in: uniqueIds },
  })
    .select({ _id: 1, archivedAt: 1 })
    .lean()
    .exec()) as ConversationLite[];
  const foundIds = new Set(docs.map((d) => d._id));
  const invalidIds = uniqueIds.filter((id) => !foundIds.has(id));

  return { uniqueIds, docs, invalidIds };
}

export async function bulkArchiveConversations(
  conversationIds: string[],
): Promise<BulkConversationUpdateResult> {
  const { uniqueIds, invalidIds } =
    await validateConversationIds(conversationIds);

  if (invalidIds.length > 0) {
    return { status: 'conflict', invalidIds, invalidStateIds: [] };
  }

  const result = await ConversationModel.updateMany(
    { _id: { $in: uniqueIds } },
    { $set: { archivedAt: new Date() } },
  ).exec();

  const docs = (await ConversationModel.find({
    _id: { $in: uniqueIds },
  })
    .lean()
    .exec()) as Conversation[];
  docs.forEach((doc) => emitConversationUpsert(toConversationEvent(doc)));

  return { status: 'ok', updatedCount: result.matchedCount ?? 0 };
}

export async function bulkRestoreConversations(
  conversationIds: string[],
): Promise<BulkConversationUpdateResult> {
  const { uniqueIds, invalidIds } =
    await validateConversationIds(conversationIds);

  if (invalidIds.length > 0) {
    return { status: 'conflict', invalidIds, invalidStateIds: [] };
  }

  const result = await ConversationModel.updateMany(
    { _id: { $in: uniqueIds } },
    { $set: { archivedAt: null } },
  ).exec();

  const docs = (await ConversationModel.find({
    _id: { $in: uniqueIds },
  })
    .lean()
    .exec()) as Conversation[];
  docs.forEach((doc) => emitConversationUpsert(toConversationEvent(doc)));

  return { status: 'ok', updatedCount: result.matchedCount ?? 0 };
}

export async function bulkDeleteConversations(
  conversationIds: string[],
): Promise<BulkConversationDeleteResult> {
  const { uniqueIds, docs, invalidIds } =
    await validateConversationIds(conversationIds);

  const invalidStateIds = docs
    .filter((d) => d.archivedAt == null)
    .map((d) => d._id);

  if (invalidIds.length > 0 || invalidStateIds.length > 0) {
    return { status: 'conflict', invalidIds, invalidStateIds };
  }

  await TurnModel.deleteMany({ conversationId: { $in: uniqueIds } }).exec();
  const deleted = await ConversationModel.deleteMany({
    _id: { $in: uniqueIds },
  }).exec();

  uniqueIds.forEach((conversationId) => emitConversationDelete(conversationId));

  return { status: 'ok', deletedCount: deleted.deletedCount ?? 0 };
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export type IngestFileIndexRow = { relPath: string; fileHash: string };

export async function listIngestFilesByRoot(
  root: string,
): Promise<IngestFileIndexRow[] | null> {
  // Avoid Mongoose buffering timeouts when Mongo is unavailable (tests and degraded runtime).
  if (mongoose.connection.readyState !== 1) return null;

  const docs = (await IngestFileModel.find({ root })
    .select({ _id: 0, relPath: 1, fileHash: 1 })
    .lean()
    .exec()) as IngestFileIndexRow[];

  return docs;
}

export async function upsertIngestFiles(params: {
  root: string;
  files: IngestFileIndexRow[];
}): Promise<{ ok: true } | null> {
  // Avoid Mongoose buffering timeouts when Mongo is unavailable (tests and degraded runtime).
  if (mongoose.connection.readyState !== 1) return null;

  const { root, files } = params;
  if (files.length === 0) return { ok: true };

  await IngestFileModel.bulkWrite(
    files.map((file) => ({
      updateOne: {
        filter: { root, relPath: file.relPath },
        update: { $set: { fileHash: file.fileHash } },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  return { ok: true };
}

export async function deleteIngestFilesByRelPaths(params: {
  root: string;
  relPaths: string[];
}): Promise<{ ok: true } | null> {
  // Avoid Mongoose buffering timeouts when Mongo is unavailable (tests and degraded runtime).
  if (mongoose.connection.readyState !== 1) return null;

  const { root, relPaths } = params;
  if (relPaths.length === 0) return { ok: true };

  await IngestFileModel.deleteMany({ root, relPath: { $in: relPaths } }).exec();
  return { ok: true };
}

export async function clearIngestFilesByRoot(
  root: string,
): Promise<{ ok: true } | null> {
  // Avoid Mongoose buffering timeouts when Mongo is unavailable (tests and degraded runtime).
  if (mongoose.connection.readyState !== 1) return null;

  await IngestFileModel.deleteMany({ root }).exec();
  return { ok: true };
}
