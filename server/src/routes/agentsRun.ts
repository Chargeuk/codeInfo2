import { Router, json } from 'express';

import { startAgentInstruction } from '../agents/service.js';
import { baseLogger, resolveLogConfig } from '../logger.js';

type Deps = {
  startAgentInstruction: typeof startAgentInstruction;
};

type AgentRunBody = {
  instruction?: unknown;
  conversationId?: unknown;
  working_folder?: unknown;
};

type AgentRunError =
  | { code: 'AGENT_NOT_FOUND' }
  | { code: 'CONVERSATION_ARCHIVED' }
  | { code: 'AGENT_MISMATCH' }
  | { code: 'RUN_IN_PROGRESS'; reason?: string }
  | { code: 'CODEX_UNAVAILABLE'; reason?: string }
  | { code: 'WORKING_FOLDER_INVALID'; reason?: string }
  | { code: 'WORKING_FOLDER_NOT_FOUND'; reason?: string };

const isAgentRunError = (err: unknown): err is AgentRunError =>
  Boolean(err) &&
  typeof err === 'object' &&
  typeof (err as { code?: unknown }).code === 'string';

const validateBody = (
  body: unknown,
): {
  instruction: string;
  conversationId?: string;
  working_folder?: string;
} => {
  const candidate = (body ?? {}) as AgentRunBody;

  const rawInstruction = candidate.instruction;
  if (
    typeof rawInstruction !== 'string' ||
    rawInstruction.trim().length === 0
  ) {
    throw new Error('instruction is required');
  }

  const rawConversationId = candidate.conversationId;
  const conversationId =
    typeof rawConversationId === 'string' && rawConversationId.trim().length > 0
      ? rawConversationId
      : undefined;

  const rawWorkingFolder = candidate.working_folder;
  if (rawWorkingFolder !== undefined && rawWorkingFolder !== null) {
    if (typeof rawWorkingFolder !== 'string') {
      throw new Error('working_folder must be a string');
    }
  }
  const working_folder =
    typeof rawWorkingFolder === 'string' && rawWorkingFolder.trim().length > 0
      ? rawWorkingFolder.trim()
      : undefined;

  return { instruction: rawInstruction, conversationId, working_folder };
};

export function createAgentsRunRouter(
  deps: Deps = {
    startAgentInstruction,
  },
) {
  const router = Router();
  const { maxClientBytes } = resolveLogConfig();
  router.use(json({ limit: `${maxClientBytes}b`, strict: false }));

  router.post('/agents/:agentName/run', async (req, res) => {
    const requestId =
      (res.locals?.requestId as string | undefined) ?? undefined;
    const agentName = String(req.params.agentName ?? '').trim();
    if (!agentName) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    const rawSize = JSON.stringify(req.body ?? {}).length;
    if (rawSize > maxClientBytes) {
      return res.status(400).json({ error: 'payload too large' });
    }

    let parsedBody: {
      instruction: string;
      conversationId?: string;
      working_folder?: string;
    };
    try {
      parsedBody = validateBody(req.body);
    } catch (err) {
      return res
        .status(400)
        .json({ error: 'invalid_request', message: (err as Error).message });
    }

    try {
      const result = await deps.startAgentInstruction({
        agentName,
        instruction: parsedBody.instruction,
        working_folder: parsedBody.working_folder,
        conversationId: parsedBody.conversationId,
        source: 'REST',
      });

      baseLogger.info(
        {
          requestId,
          agentName,
          conversationId: result.conversationId,
          inflightId: result.inflightId,
        },
        'agents run started',
      );

      return res.status(202).json({
        status: 'started',
        agentName,
        conversationId: result.conversationId,
        inflightId: result.inflightId,
        modelId: result.modelId,
      });
    } catch (err) {
      if (isAgentRunError(err)) {
        if (err.code === 'AGENT_NOT_FOUND') {
          return res.status(404).json({ error: 'not_found' });
        }
        if (err.code === 'CONVERSATION_ARCHIVED') {
          return res.status(410).json({ error: 'archived' });
        }
        if (err.code === 'AGENT_MISMATCH') {
          return res.status(400).json({ error: 'agent_mismatch' });
        }
        if (err.code === 'RUN_IN_PROGRESS') {
          return res.status(409).json({
            error: 'conflict',
            code: 'RUN_IN_PROGRESS',
            message:
              err.reason ??
              'A run is already in progress for this conversation.',
          });
        }
        if (err.code === 'CODEX_UNAVAILABLE') {
          return res
            .status(503)
            .json({ error: 'codex_unavailable', reason: err.reason });
        }
        if (
          err.code === 'WORKING_FOLDER_INVALID' ||
          err.code === 'WORKING_FOLDER_NOT_FOUND'
        ) {
          return res.status(400).json({
            error: 'invalid_request',
            code: err.code,
            message: err.reason ?? 'working_folder validation failed',
          });
        }
      }

      baseLogger.error({ requestId, agentName, err }, 'agents run failed');
      return res.status(500).json({ error: 'agent_run_failed' });
    }
  });

  return router;
}
