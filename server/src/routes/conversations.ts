import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { append } from '../logStore.js';
import { ConversationModel } from '../mongo/conversation.js';
import {
  archiveConversation as defaultArchiveConversation,
  appendTurn as defaultAppendTurn,
  bulkArchiveConversations as defaultBulkArchiveConversations,
  bulkDeleteConversations as defaultBulkDeleteConversations,
  bulkRestoreConversations as defaultBulkRestoreConversations,
  createConversation as defaultCreateConversation,
  listConversations as defaultListConversations,
  listTurns as defaultListTurns,
  restoreConversation as defaultRestoreConversation,
  type BulkConversationDeleteResult,
  type BulkConversationUpdateResult,
  type AppendTurnInput,
} from '../mongo/repo.js';

const listConversationsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().datetime().optional(),
    state: z.string().optional(),
    archived: z.union([z.literal('true'), z.literal('false')]).optional(),
    agentName: z.string().min(1).optional(),
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

const listTurnsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().datetime().optional(),
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
      })
      .strict()
      .optional(),
    status: z.enum(['ok', 'stopped', 'failed']),
  })
  .strict();

const bulkConversationIdsSchema = z
  .object({
    conversationIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

type ConversationLite = { _id: string; archivedAt: Date | null };

type Deps = {
  listConversations: typeof defaultListConversations;
  createConversation: typeof defaultCreateConversation;
  archiveConversation: typeof defaultArchiveConversation;
  restoreConversation: typeof defaultRestoreConversation;
  listTurns: typeof defaultListTurns;
  appendTurn: typeof defaultAppendTurn;
  bulkArchiveConversations: typeof defaultBulkArchiveConversations;
  bulkRestoreConversations: typeof defaultBulkRestoreConversations;
  bulkDeleteConversations: typeof defaultBulkDeleteConversations;
  findConversationById: (id: string) => Promise<ConversationLite | null>;
};

export function createConversationsRouter(deps: Partial<Deps> = {}) {
  const {
    listConversations = defaultListConversations,
    createConversation = defaultCreateConversation,
    archiveConversation = defaultArchiveConversation,
    restoreConversation = defaultRestoreConversation,
    listTurns = defaultListTurns,
    appendTurn = defaultAppendTurn,
    bulkArchiveConversations = defaultBulkArchiveConversations,
    bulkRestoreConversations = defaultBulkRestoreConversations,
    bulkDeleteConversations = defaultBulkDeleteConversations,
    findConversationById = (id: string) =>
      ConversationModel.findById(id).lean().exec(),
  } = deps;

  const router = Router();

  router.get('/conversations', async (req, res) => {
    const requestId = res.locals.requestId as string | undefined;
    const parsed = listConversationsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'validation_error',
        details: parsed.error.format(),
      });
    }

    const { limit, cursor, archived, agentName } = parsed.data;
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
        },
      });
      return res
        .status(400)
        .json({ status: 'error', code: 'VALIDATION_FAILED' });
    }

    const state =
      (stateRaw as 'active' | 'archived' | 'all' | undefined) ??
      (archived === 'true' ? 'all' : 'active');

    try {
      const { items } = await listConversations({
        limit,
        cursor,
        state,
        agentName,
      });

      const nextCursor =
        items.length === limit
          ? items[items.length - 1]?.lastMessageAt.toISOString()
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
          returnedCount: items.length,
        },
      });

      res.json({ items, nextCursor });
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

  router.get('/conversations/:id/turns', async (req, res) => {
    const parsedParams = archiveActionParamsSchema.safeParse(req.params);
    const parsedQuery = listTurnsQuerySchema.safeParse(req.query);
    if (!parsedParams.success || !parsedQuery.success) {
      return res.status(400).json({
        error: 'validation_error',
        details: {
          params: parsedParams.success
            ? undefined
            : parsedParams.error.format(),
          query: parsedQuery.success ? undefined : parsedQuery.error.format(),
        },
      });
    }

    const conversation = await findConversationById(parsedParams.data.id);
    if (!conversation) return res.status(404).json({ error: 'not_found' });

    const { limit, cursor } = parsedQuery.data;
    try {
      const { items } = await listTurns({
        conversationId: parsedParams.data.id,
        limit,
        cursor,
      });
      const nextCursor =
        items.length === limit
          ? items[items.length - 1]?.createdAt.toISOString()
          : undefined;
      res.json({ items, nextCursor });
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
      await appendTurn(payload);
      res.status(201).json({ status: 'ok' });
    } catch (err) {
      res.status(500).json({ error: 'server_error', message: `${err}` });
    }
  });

  return router;
}
