import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { ConversationModel } from '../mongo/conversation.js';
import {
  archiveConversation as defaultArchiveConversation,
  appendTurn as defaultAppendTurn,
  createConversation as defaultCreateConversation,
  listConversations as defaultListConversations,
  listTurns as defaultListTurns,
  restoreConversation as defaultRestoreConversation,
  type AppendTurnInput,
} from '../mongo/repo.js';

const listConversationsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().datetime().optional(),
    archived: z
      .union([z.literal('true'), z.literal('false')])
      .optional()
      .transform((v) => v === 'true'),
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
    status: z.enum(['ok', 'stopped', 'failed']),
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
    findConversationById = (id: string) =>
      ConversationModel.findById(id).lean().exec(),
  } = deps;

  const router = Router();

  router.get('/conversations', async (req, res) => {
    const parsed = listConversationsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'validation_error',
        details: parsed.error.format(),
      });
    }

    const { limit, cursor, archived } = parsed.data;
    const includeArchived = archived === true;

    try {
      const { items } = await listConversations({
        limit,
        cursor,
        includeArchived,
      });

      const nextCursor =
        items.length === limit
          ? items[items.length - 1]?.lastMessageAt.toISOString()
          : undefined;

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
