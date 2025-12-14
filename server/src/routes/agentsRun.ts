import { Router, json } from 'express';
import {
  runAgentInstruction,
  type RunAgentInstructionResult,
} from '../agents/service.js';
import { baseLogger, resolveLogConfig } from '../logger.js';

type Deps = {
  runAgentInstruction: typeof runAgentInstruction;
};

type AgentRunBody = {
  instruction?: unknown;
  conversationId?: unknown;
};

type AgentRunError =
  | { code: 'AGENT_NOT_FOUND' }
  | { code: 'CONVERSATION_ARCHIVED' }
  | { code: 'AGENT_MISMATCH' }
  | { code: 'CODEX_UNAVAILABLE'; reason?: string };

const isAgentRunError = (err: unknown): err is AgentRunError =>
  Boolean(err) &&
  typeof err === 'object' &&
  typeof (err as { code?: unknown }).code === 'string';

const validateBody = (
  body: unknown,
): {
  instruction: string;
  conversationId?: string;
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

  return { instruction: rawInstruction, conversationId };
};

export function createAgentsRunRouter(
  deps: Deps = {
    runAgentInstruction,
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

    let parsedBody: { instruction: string; conversationId?: string };
    try {
      parsedBody = validateBody(req.body);
    } catch (err) {
      return res
        .status(400)
        .json({ error: 'invalid_request', message: (err as Error).message });
    }

    const controller = new AbortController();
    const handleDisconnect = () => {
      if (controller.signal.aborted) return;
      controller.abort();
    };
    req.on('aborted', handleDisconnect);
    res.on('close', () => {
      if (res.writableEnded) return;
      handleDisconnect();
    });

    try {
      const result: RunAgentInstructionResult = await deps.runAgentInstruction({
        agentName,
        instruction: parsedBody.instruction,
        conversationId: parsedBody.conversationId,
        signal: controller.signal,
        source: 'REST',
      });
      baseLogger.info(
        { requestId, agentName, conversationId: result.conversationId },
        'agents run',
      );
      return res.json(result);
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
        if (err.code === 'CODEX_UNAVAILABLE') {
          return res
            .status(503)
            .json({ error: 'codex_unavailable', reason: err.reason });
        }
      }

      baseLogger.error({ requestId, agentName, err }, 'agents run failed');
      return res.status(500).json({ error: 'agent_run_failed' });
    }
  });

  return router;
}
