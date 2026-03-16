import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { getActiveRunOwnership } from '../agents/runLock.js';
import {
  getInflight,
  mergeInflightTurns,
  snapshotInflight,
  snapshotInflightTurns,
} from '../chat/inflightRegistry.js';
import {
  memoryConversations,
  shouldUseMemoryPersistence,
  updateMemoryConversationWorkingFolder,
} from '../chat/memoryPersistence.js';
import { listIngestedRepositories } from '../lmstudio/toolService.js';
import { append } from '../logStore.js';
import { ConversationModel, type Conversation } from '../mongo/conversation.js';
import { emitConversationUpsert } from '../mongo/events.js';
import {
  archiveConversation as defaultArchiveConversation,
  appendTurn as defaultAppendTurn,
  bulkArchiveConversations as defaultBulkArchiveConversations,
  bulkDeleteConversations as defaultBulkDeleteConversations,
  bulkRestoreConversations as defaultBulkRestoreConversations,
  createConversation as defaultCreateConversation,
  listConversations as defaultListConversations,
  listAllTurns as defaultListAllTurns,
  restoreConversation as defaultRestoreConversation,
  updateConversationWorkingFolder as defaultUpdateConversationWorkingFolder,
  type BulkConversationDeleteResult,
  type BulkConversationUpdateResult,
  type AppendTurnInput,
  type ConversationSummary,
} from '../mongo/repo.js';
import {
  appendWorkingFolderDecisionLog,
  getConversationRecordType,
  restoreSavedWorkingFolder,
  validateRequestedWorkingFolder,
} from '../workingFolders/state.js';

const listConversationsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().datetime().optional(),
    state: z.string().optional(),
    archived: z.union([z.literal('true'), z.literal('false')]).optional(),
    agentName: z.string().min(1).optional(),
    flowName: z.string().min(1).optional(),
  })
  .strict();

const createConversationSchema = z
  .object({
    provider: z.enum(['lmstudio', 'codex']),
    model: z.string().min(1),
    title: z.string().min(1).optional(),
    flags: z.record(z.unknown()).optional(),
    source: z.enum(['REST', 'MCP']).optional(),
  })
  .strict();

const archiveActionParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

const updateWorkingFolderSchema = z
  .object({
    workingFolder: z.string().min(1).optional().nullable(),
  })
  .strict();

const usageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    cachedInputTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

const timingSchema = z
  .object({
    totalTimeSec: z.number().nonnegative().optional(),
    tokensPerSecond: z.number().nonnegative().optional(),
  })
  .strict();

const appendTurnSchema = z
  .object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().min(1),
    model: z.string().min(1),
    provider: z.string().min(1),
    source: z.enum(['REST', 'MCP']).optional(),
    toolCalls: z.record(z.unknown()).nullable().optional(),
    command: z
      .object({
        name: z.string().min(1),
        stepIndex: z.number().int().min(1),
        totalSteps: z.number().int().min(1),
        loopDepth: z.number().int().min(0).optional(),
        agentType: z.string().min(1).optional(),
        identifier: z.string().min(1).optional(),
        label: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    usage: usageSchema.optional(),
    timing: timingSchema.optional(),
    status: z.enum(['ok', 'stopped', 'failed']),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.role === 'assistant') return;
    if (data.usage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'usage metadata is only allowed on assistant turns',
        path: ['usage'],
      });
    }
    if (data.timing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'timing metadata is only allowed on assistant turns',
        path: ['timing'],
      });
    }
  });

const bulkConversationIdsSchema = z
  .object({
    conversationIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

type ConversationLite = Pick<
  Conversation,
  | '_id'
  | 'provider'
  | 'model'
  | 'title'
  | 'agentName'
  | 'flowName'
  | 'source'
  | 'lastMessageAt'
  | 'archivedAt'
  | 'flags'
>;

type ConversationLookup = Pick<Conversation, '_id' | 'archivedAt'> &
  Partial<Pick<Conversation, 'flags' | 'agentName' | 'flowName'>>;

type Deps = {
  listConversations: typeof defaultListConversations;
  resolveListConversations: () => typeof defaultListConversations;
  createConversation: typeof defaultCreateConversation;
  archiveConversation: typeof defaultArchiveConversation;
  restoreConversation: typeof defaultRestoreConversation;
  listAllTurns: typeof defaultListAllTurns;
  appendTurn: typeof defaultAppendTurn;
  updateConversationWorkingFolder: typeof defaultUpdateConversationWorkingFolder;
  bulkArchiveConversations: typeof defaultBulkArchiveConversations;
  bulkRestoreConversations: typeof defaultBulkRestoreConversations;
  bulkDeleteConversations: typeof defaultBulkDeleteConversations;
  findConversationById: (id: string) => Promise<ConversationLookup | null>;
};

const listMemoryConversations = async (params: {
  limit: number;
  cursor?: string;
  state?: 'active' | 'archived' | 'all';
  agentName?: string;
  flowName?: string;
}): Promise<{ items: ConversationSummary[] }> => {
  const state = params.state ?? 'active';
  const items = [...memoryConversations.values()]
    .filter((conversation) => {
      const archived = conversation.archivedAt != null;
      if (state === 'active' && archived) return false;
      if (state === 'archived' && !archived) return false;
      if (params.agentName !== undefined) {
        if (params.agentName === '__none__') {
          if (conversation.agentName) return false;
        } else if (conversation.agentName !== params.agentName) {
          return false;
        }
      }
      if (params.flowName !== undefined) {
        if (params.flowName === '__none__') {
          if (conversation.flowName) return false;
        } else if (conversation.flowName !== params.flowName) {
          return false;
        }
      }
      if (params.cursor) {
        const cursorDate = new Date(params.cursor);
        if (!(conversation.lastMessageAt < cursorDate)) return false;
      }
      return true;
    })
    .sort((left, right) => {
      const delta =
        right.lastMessageAt.getTime() - left.lastMessageAt.getTime();
      if (delta !== 0) return delta;
      return right._id.localeCompare(left._id);
    })
    .slice(0, params.limit)
    .map((conversation) => ({
      conversationId: conversation._id,
      provider: conversation.provider,
      model: conversation.model,
      title: conversation.title,
      ...(conversation.agentName ? { agentName: conversation.agentName } : {}),
      ...(conversation.flowName ? { flowName: conversation.flowName } : {}),
      source: conversation.source ?? 'REST',
      lastMessageAt: conversation.lastMessageAt,
      archived: conversation.archivedAt != null,
      flags: conversation.flags ?? {},
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    }));

  return { items };
};

export function createConversationsRouter(deps: Partial<Deps> = {}) {
  const {
    listConversations,
    resolveListConversations = () =>
      listConversations ??
      (shouldUseMemoryPersistence()
        ? listMemoryConversations
        : defaultListConversations),
    createConversation = defaultCreateConversation,
    archiveConversation = defaultArchiveConversation,
    restoreConversation = defaultRestoreConversation,
    listAllTurns = defaultListAllTurns,
    appendTurn = defaultAppendTurn,
    updateConversationWorkingFolder = defaultUpdateConversationWorkingFolder,
    bulkArchiveConversations = defaultBulkArchiveConversations,
    bulkRestoreConversations = defaultBulkRestoreConversations,
    bulkDeleteConversations = defaultBulkDeleteConversations,
    findConversationById = (id: string) =>
      shouldUseMemoryPersistence()
        ? Promise.resolve(memoryConversations.get(id) ?? null)
        : ConversationModel.findById(id).lean().exec(),
  } = deps;

  const router = Router();

  const toConversationResponse = (conversation: ConversationLite) => ({
    conversationId: conversation._id,
    title: conversation.title,
    provider: conversation.provider,
    model: conversation.model,
    source: conversation.source,
    lastMessageAt: conversation.lastMessageAt,
    archived: conversation.archivedAt != null,
    ...(conversation.agentName ? { agentName: conversation.agentName } : {}),
    ...(conversation.flowName ? { flowName: conversation.flowName } : {}),
    flags: conversation.flags ?? {},
  });

  const toConversationEventSummary = (
    conversation: ConversationLookup | ConversationLite,
  ) => ({
    conversationId: conversation._id,
    title:
      'title' in conversation && typeof conversation.title === 'string'
        ? conversation.title
        : '',
    provider:
      'provider' in conversation && typeof conversation.provider === 'string'
        ? conversation.provider
        : 'codex',
    model:
      'model' in conversation && typeof conversation.model === 'string'
        ? conversation.model
        : '',
    source:
      'source' in conversation && typeof conversation.source === 'string'
        ? conversation.source
        : 'REST',
    lastMessageAt:
      'lastMessageAt' in conversation &&
      conversation.lastMessageAt instanceof Date
        ? conversation.lastMessageAt
        : new Date(),
    archived: conversation.archivedAt != null,
    ...('agentName' in conversation && conversation.agentName
      ? { agentName: conversation.agentName }
      : {}),
    ...('flowName' in conversation && conversation.flowName
      ? { flowName: conversation.flowName }
      : {}),
    flags: conversation.flags ?? {},
  });

  const persistConversationWorkingFolder = async (params: {
    conversationId: string;
    workingFolder?: string | null;
  }) => {
    if (deps.updateConversationWorkingFolder) {
      return await updateConversationWorkingFolder(params);
    }

    if (shouldUseMemoryPersistence()) {
      updateMemoryConversationWorkingFolder(params);
      const updated = memoryConversations.get(params.conversationId) ?? null;
      if (updated) {
        emitConversationUpsert(toConversationEventSummary(updated));
      }
      return updated;
    }

    return await updateConversationWorkingFolder(params);
  };

  const knownRepositoryPaths = async () =>
    await listIngestedRepositories()
      .then((result) => result.repos.map((repo) => repo.containerPath))
      .catch(() => undefined);

  router.get('/conversations', async (req, res) => {
    const requestId = res.locals.requestId as string | undefined;
    const parsed = listConversationsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'validation_error',
        details: parsed.error.format(),
      });
    }

    const { limit, cursor, archived, agentName, flowName } = parsed.data;
    const stateRaw = parsed.data.state?.toLowerCase();

    const archivedQuery = archived;
    const cursorProvided = cursor !== undefined;
    const stateCandidate =
      (stateRaw as 'active' | 'archived' | 'all' | undefined) ??
      (archivedQuery === 'true' ? 'all' : 'active');

    append({
      level: 'info',
      message: 'conversations.list.request',
      timestamp: new Date().toISOString(),
      source: 'server',
      requestId,
      context: {
        state: stateCandidate,
        ...(archivedQuery !== undefined ? { archivedQuery } : {}),
        limit,
        cursorProvided,
        ...(agentName !== undefined ? { agentName } : {}),
        ...(flowName !== undefined ? { flowName } : {}),
      },
    });

    if (
      stateRaw !== undefined &&
      stateRaw !== 'active' &&
      stateRaw !== 'archived' &&
      stateRaw !== 'all'
    ) {
      append({
        level: 'warn',
        message: 'conversations.list.validation_failed',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: {
          state: stateRaw,
          ...(archivedQuery !== undefined ? { archivedQuery } : {}),
          limit,
          cursorProvided,
          ...(agentName !== undefined ? { agentName } : {}),
          ...(flowName !== undefined ? { flowName } : {}),
        },
      });
      return res
        .status(400)
        .json({ status: 'error', code: 'VALIDATION_FAILED' });
    }

    const state =
      (stateRaw as 'active' | 'archived' | 'all' | undefined) ??
      (archived === 'true' ? 'all' : 'active');

    if (flowName !== undefined) {
      append({
        level: 'info',
        message: 'conversations.flowName.filter_applied',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: {
          flowNameFilter: flowName,
        },
      });
    }

    try {
      const { items } = await resolveListConversations()({
        limit,
        cursor,
        state,
        agentName,
        flowName,
      });
      const repoPaths = await knownRepositoryPaths();
      const normalizedItems: typeof items = [];
      for (const item of items) {
        const restoredWorkingFolder = await restoreSavedWorkingFolder({
          conversation: {
            conversationId: item.conversationId,
            agentName: item.agentName,
            flowName: item.flowName,
            flags: item.flags,
          },
          surface: 'conversations_list',
          clearPersistedWorkingFolder: async (conversationId) => {
            await persistConversationWorkingFolder({
              conversationId,
              workingFolder: null,
            });
          },
          knownRepositoryPaths: repoPaths,
        });

        if (restoredWorkingFolder === undefined) {
          const nextFlags = { ...(item.flags ?? {}) };
          delete nextFlags.workingFolder;
          normalizedItems.push({
            ...item,
            flags: nextFlags,
          });
          continue;
        }

        if (
          (item.flags?.workingFolder as string | undefined) !==
          restoredWorkingFolder
        ) {
          normalizedItems.push({
            ...item,
            flags: {
              ...(item.flags ?? {}),
              workingFolder: restoredWorkingFolder,
            },
          });
          continue;
        }

        normalizedItems.push(item);
      }

      const nextCursor =
        normalizedItems.length === limit
          ? normalizedItems[
              normalizedItems.length - 1
            ]?.lastMessageAt.toISOString()
          : undefined;

      append({
        level: 'info',
        message: 'conversations.list.response',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: {
          state,
          ...(archivedQuery !== undefined ? { archivedQuery } : {}),
          limit,
          cursorProvided,
          ...(agentName !== undefined ? { agentName } : {}),
          ...(flowName !== undefined ? { flowName } : {}),
          returnedCount: normalizedItems.length,
        },
      });

      res.json({ items: normalizedItems, nextCursor });
    } catch (err) {
      res.status(500).json({ error: 'server_error', message: `${err}` });
    }
  });

  router.post('/conversations', async (req, res) => {
    const parsed = createConversationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'validation_error',
        details: parsed.error.format(),
      });
    }

    const { provider, model, title, flags, source } = parsed.data;
    const conversationId = crypto.randomUUID();

    try {
      await createConversation({
        conversationId,
        provider,
        model,
        title: title ?? 'Untitled conversation',
        source: source ?? 'REST',
        flags,
        lastMessageAt: new Date(),
      });
      res.status(201).json({ conversationId });
    } catch (err) {
      res.status(500).json({ error: 'server_error', message: `${err}` });
    }
  });

  const bulkValidationFailed = (res: Response) =>
    res.status(400).json({
      status: 'error',
      code: 'VALIDATION_FAILED',
      message: 'conversationIds must be a non-empty array of strings.',
    });

  const isBulkConflict = (
    result: BulkConversationUpdateResult | BulkConversationDeleteResult,
  ): result is {
    status: 'conflict';
    invalidIds: string[];
    invalidStateIds: string[];
  } => result.status === 'conflict';

  router.post('/conversations/bulk/archive', async (req, res) => {
    const requestId = res.locals.requestId as string | undefined;
    const parsedBody = bulkConversationIdsSchema.safeParse(req.body);
    if (!parsedBody.success) return bulkValidationFailed(res);

    const requestedCount = parsedBody.data.conversationIds.length;
    const uniqueConversationIds = Array.from(
      new Set(parsedBody.data.conversationIds),
    );

    append({
      level: 'info',
      message: 'conversations.bulk.request',
      timestamp: new Date().toISOString(),
      source: 'server',
      requestId,
      context: {
        action: 'archive',
        requestedCount,
        uniqueCount: uniqueConversationIds.length,
      },
    });

    try {
      const result = await bulkArchiveConversations(uniqueConversationIds);
      if (isBulkConflict(result)) {
        append({
          level: 'warn',
          message: 'conversations.bulk.conflict',
          timestamp: new Date().toISOString(),
          source: 'server',
          requestId,
          context: {
            action: 'archive',
            requestedCount,
            uniqueCount: uniqueConversationIds.length,
            invalidIdsCount: result.invalidIds.length,
            invalidStateIdsCount: result.invalidStateIds.length,
          },
        });
        return res.status(409).json({
          status: 'error',
          code: 'BATCH_CONFLICT',
          message: 'Bulk operation rejected.',
          details: {
            invalidIds: result.invalidIds,
            invalidStateIds: result.invalidStateIds,
          },
        });
      }

      append({
        level: 'info',
        message: 'conversations.bulk.success',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: {
          action: 'archive',
          requestedCount,
          uniqueCount: uniqueConversationIds.length,
          updatedCount: result.updatedCount,
        },
      });

      res.json({ status: 'ok', updatedCount: result.updatedCount });
    } catch (err) {
      res.status(500).json({ error: 'server_error', message: `${err}` });
    }
  });

  router.post('/conversations/bulk/restore', async (req, res) => {
    const requestId = res.locals.requestId as string | undefined;
    const parsedBody = bulkConversationIdsSchema.safeParse(req.body);
    if (!parsedBody.success) return bulkValidationFailed(res);

    const requestedCount = parsedBody.data.conversationIds.length;
    const uniqueConversationIds = Array.from(
      new Set(parsedBody.data.conversationIds),
    );

    append({
      level: 'info',
      message: 'conversations.bulk.request',
      timestamp: new Date().toISOString(),
      source: 'server',
      requestId,
      context: {
        action: 'restore',
        requestedCount,
        uniqueCount: uniqueConversationIds.length,
      },
    });

    try {
      const result = await bulkRestoreConversations(uniqueConversationIds);
      if (isBulkConflict(result)) {
        append({
          level: 'warn',
          message: 'conversations.bulk.conflict',
          timestamp: new Date().toISOString(),
          source: 'server',
          requestId,
          context: {
            action: 'restore',
            requestedCount,
            uniqueCount: uniqueConversationIds.length,
            invalidIdsCount: result.invalidIds.length,
            invalidStateIdsCount: result.invalidStateIds.length,
          },
        });
        return res.status(409).json({
          status: 'error',
          code: 'BATCH_CONFLICT',
          message: 'Bulk operation rejected.',
          details: {
            invalidIds: result.invalidIds,
            invalidStateIds: result.invalidStateIds,
          },
        });
      }

      append({
        level: 'info',
        message: 'conversations.bulk.success',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: {
          action: 'restore',
          requestedCount,
          uniqueCount: uniqueConversationIds.length,
          updatedCount: result.updatedCount,
        },
      });

      res.json({ status: 'ok', updatedCount: result.updatedCount });
    } catch (err) {
      res.status(500).json({ error: 'server_error', message: `${err}` });
    }
  });

  router.post('/conversations/bulk/delete', async (req, res) => {
    const requestId = res.locals.requestId as string | undefined;
    const parsedBody = bulkConversationIdsSchema.safeParse(req.body);
    if (!parsedBody.success) return bulkValidationFailed(res);

    const requestedCount = parsedBody.data.conversationIds.length;
    const uniqueConversationIds = Array.from(
      new Set(parsedBody.data.conversationIds),
    );

    append({
      level: 'info',
      message: 'conversations.bulk.request',
      timestamp: new Date().toISOString(),
      source: 'server',
      requestId,
      context: {
        action: 'delete',
        requestedCount,
        uniqueCount: uniqueConversationIds.length,
      },
    });

    try {
      const result = await bulkDeleteConversations(uniqueConversationIds);
      if (isBulkConflict(result)) {
        append({
          level: 'warn',
          message: 'conversations.bulk.conflict',
          timestamp: new Date().toISOString(),
          source: 'server',
          requestId,
          context: {
            action: 'delete',
            requestedCount,
            uniqueCount: uniqueConversationIds.length,
            invalidIdsCount: result.invalidIds.length,
            invalidStateIdsCount: result.invalidStateIds.length,
          },
        });
        return res.status(409).json({
          status: 'error',
          code: 'BATCH_CONFLICT',
          message: 'Bulk operation rejected.',
          details: {
            invalidIds: result.invalidIds,
            invalidStateIds: result.invalidStateIds,
          },
        });
      }

      append({
        level: 'info',
        message: 'conversations.bulk.success',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: {
          action: 'delete',
          requestedCount,
          uniqueCount: uniqueConversationIds.length,
          deletedCount: result.deletedCount,
        },
      });

      res.json({ status: 'ok', deletedCount: result.deletedCount });
    } catch (err) {
      res.status(500).json({ error: 'server_error', message: `${err}` });
    }
  });

  router.post('/conversations/:id/archive', async (req, res) => {
    const parsedParams = archiveActionParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({
        error: 'validation_error',
        details: parsedParams.error.format(),
      });
    }

    try {
      const updated = await archiveConversation(parsedParams.data.id);
      if (!updated) return res.status(404).json({ error: 'not_found' });
      res.json({ status: 'ok' });
    } catch (err) {
      res.status(500).json({ error: 'server_error', message: `${err}` });
    }
  });

  router.post('/conversations/:id/restore', async (req, res) => {
    const parsedParams = archiveActionParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({
        error: 'validation_error',
        details: parsedParams.error.format(),
      });
    }

    try {
      const updated = await restoreConversation(parsedParams.data.id);
      if (!updated) return res.status(404).json({ error: 'not_found' });
      res.json({ status: 'ok' });
    } catch (err) {
      res.status(500).json({ error: 'server_error', message: `${err}` });
    }
  });

  router.post('/conversations/:id/working-folder', async (req, res) => {
    const parsedParams = archiveActionParamsSchema.safeParse(req.params);
    const parsedBody = updateWorkingFolderSchema.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      return res.status(400).json({
        error: 'validation_error',
        details: {
          params: parsedParams.success
            ? undefined
            : parsedParams.error.format(),
          body: parsedBody.success ? undefined : parsedBody.error.format(),
        },
      });
    }

    const conversation = await findConversationById(parsedParams.data.id);
    if (!conversation) return res.status(404).json({ error: 'not_found' });
    if (conversation.archivedAt) {
      return res.status(410).json({ error: 'archived' });
    }
    if (
      getActiveRunOwnership(parsedParams.data.id) ||
      getInflight(parsedParams.data.id)
    ) {
      appendWorkingFolderDecisionLog({
        conversationId: parsedParams.data.id,
        recordType: getConversationRecordType(conversation),
        surface: 'conversation_edit',
        action: 'reject',
        decisionReason: 'run_in_progress',
      });
      return res.status(409).json({
        error: 'conflict',
        code: 'RUN_IN_PROGRESS',
        message: 'A run is already in progress for this conversation.',
      });
    }

    const rawWorkingFolder = parsedBody.data.workingFolder;
    const workingFolder =
      typeof rawWorkingFolder === 'string' && rawWorkingFolder.trim().length > 0
        ? rawWorkingFolder.trim()
        : undefined;

    let validatedWorkingFolder: string | undefined;
    try {
      validatedWorkingFolder = await validateRequestedWorkingFolder({
        workingFolder,
        knownRepositoryPaths: await knownRepositoryPaths(),
      });
    } catch (error) {
      const err = error as { code?: string; reason?: string };
      appendWorkingFolderDecisionLog({
        conversationId: parsedParams.data.id,
        recordType: getConversationRecordType(conversation),
        surface: 'conversation_edit',
        action: 'reject',
        decisionReason:
          err.code === 'WORKING_FOLDER_NOT_FOUND'
            ? 'requested_value_missing'
            : 'requested_value_invalid',
        ...(workingFolder ? { workingFolder } : {}),
      });
      return res.status(400).json({
        error: 'invalid_request',
        code: err.code ?? 'WORKING_FOLDER_INVALID',
        message:
          typeof err.reason === 'string'
            ? err.reason
            : 'working_folder validation failed',
      });
    }

    try {
      const updated = await persistConversationWorkingFolder({
        conversationId: parsedParams.data.id,
        workingFolder: validatedWorkingFolder ?? null,
      });
      if (!updated) return res.status(404).json({ error: 'not_found' });
      appendWorkingFolderDecisionLog({
        conversationId: parsedParams.data.id,
        recordType: getConversationRecordType(conversation),
        surface: 'conversation_edit',
        action: validatedWorkingFolder ? 'save' : 'clear',
        decisionReason: validatedWorkingFolder
          ? 'request_value_persisted'
          : 'request_value_cleared',
        ...(validatedWorkingFolder
          ? { workingFolder: validatedWorkingFolder }
          : {}),
      });
      return res.json({
        status: 'ok',
        conversation: toConversationResponse(updated as ConversationLite),
      });
    } catch (err) {
      return res.status(500).json({ error: 'server_error', message: `${err}` });
    }
  });

  router.get('/conversations/:id/turns', async (req, res) => {
    const parsedParams = archiveActionParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({
        error: 'validation_error',
        details: {
          params: parsedParams.error.format(),
        },
      });
    }

    const conversation = await findConversationById(parsedParams.data.id);
    if (!conversation) return res.status(404).json({ error: 'not_found' });

    try {
      const { items: persistedItems } = await listAllTurns(
        parsedParams.data.id,
      );

      const inflightTurns = snapshotInflightTurns(parsedParams.data.id);
      const merged = mergeInflightTurns(persistedItems, inflightTurns);

      const rolePriority = (role: string) => {
        // Turns are returned newest-first. With same timestamps, keep assistant
        // before its corresponding user so client-side `.reverse()` produces a
        // chronological transcript with user → assistant ordering.
        if (role === 'assistant') return 0;
        if (role === 'user') return 1;
        return 2;
      };

      const stableKey = (turn: unknown) => {
        const rec = (turn ?? {}) as Record<string, unknown>;
        const content = typeof rec.content === 'string' ? rec.content : '';
        const provider = typeof rec.provider === 'string' ? rec.provider : '';
        const model = typeof rec.model === 'string' ? rec.model : '';
        return crypto
          .createHash('sha1')
          .update(`${rec.role ?? ''}|${provider}|${model}|${content}`)
          .digest('hex');
      };

      const items = merged.slice().sort((a, b) => {
        const timeDelta = b.createdAt.getTime() - a.createdAt.getTime();
        if (timeDelta !== 0) return timeDelta;

        const roleDelta = rolePriority(a.role) - rolePriority(b.role);
        if (roleDelta !== 0) return roleDelta;

        const aTurnId =
          typeof (a as unknown as { turnId?: unknown }).turnId === 'string'
            ? ((a as unknown as { turnId: string }).turnId as string)
            : '';
        const bTurnId =
          typeof (b as unknown as { turnId?: unknown }).turnId === 'string'
            ? ((b as unknown as { turnId: string }).turnId as string)
            : '';

        if (aTurnId && bTurnId && aTurnId !== bTurnId) {
          return bTurnId.localeCompare(aTurnId);
        }
        if (aTurnId && !bTurnId) return -1;
        if (!aTurnId && bTurnId) return 1;

        const aStable = stableKey(a);
        const bStable = stableKey(b);
        return bStable.localeCompare(aStable);
      });

      const hasUsage = items.some(
        (item) => (item as { usage?: unknown }).usage !== undefined,
      );
      const hasTiming = items.some(
        (item) => (item as { timing?: unknown }).timing !== undefined,
      );

      if (hasUsage || hasTiming) {
        append({
          level: 'info',
          message: 'DEV-0000024:T1:turns_snapshot_usage',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            conversationId: parsedParams.data.id,
            hasUsage,
            hasTiming,
          },
        });
      }

      const response: Record<string, unknown> = { items };
      const inflight = snapshotInflight(parsedParams.data.id);
      if (inflight) {
        response.inflight = inflight;
      }

      res.json(response);
    } catch (err) {
      res.status(500).json({ error: 'server_error', message: `${err}` });
    }
  });

  router.post('/conversations/:id/turns', async (req, res) => {
    const parsedParams = archiveActionParamsSchema.safeParse(req.params);
    const parsedBody = appendTurnSchema.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      return res.status(400).json({
        error: 'validation_error',
        details: {
          params: parsedParams.success
            ? undefined
            : parsedParams.error.format(),
          body: parsedBody.success ? undefined : parsedBody.error.format(),
        },
      });
    }

    const conversation = await findConversationById(parsedParams.data.id);
    if (!conversation) return res.status(404).json({ error: 'not_found' });
    if (conversation.archivedAt) {
      return res.status(410).json({ error: 'archived' });
    }

    const payload: AppendTurnInput = {
      conversationId: parsedParams.data.id,
      ...parsedBody.data,
      source: parsedBody.data.source ?? 'REST',
      toolCalls: parsedBody.data.toolCalls ?? null,
    } satisfies AppendTurnInput;

    try {
      if (
        payload.role === 'assistant' &&
        (payload.usage !== undefined || payload.timing !== undefined)
      ) {
        append({
          level: 'info',
          message: 'DEV-0000024:T1:assistant_usage_accepted',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            conversationId: parsedParams.data.id,
            hasUsage: payload.usage !== undefined,
            hasTiming: payload.timing !== undefined,
          },
        });
      }
      await appendTurn(payload);
      res.status(201).json({ status: 'ok' });
    } catch (err) {
      res.status(500).json({ error: 'server_error', message: `${err}` });
    }
  });

  return router;
}
