import { Router } from 'express';
import { ForkError } from '../agents/forkHistory.js';
import {
  forkAgentConversation,
  getForkOptions,
} from '../agents/forkService.js';
import { getAgentDetails, listAgents } from '../agents/service.js';
import { baseLogger } from '../logger.js';

type Deps = {
  listAgents: typeof listAgents;
  getAgentDetails: typeof getAgentDetails;
  forkAgentConversation?: typeof forkAgentConversation;
  getForkOptions?: typeof getForkOptions;
};

const getKnownTargetPreparationError = (
  error: unknown,
):
  | {
      code:
        | 'INVALID_PROVIDER'
        | 'PROVIDER_UNAVAILABLE'
        | 'WORKING_FOLDER_INVALID'
        | 'WORKING_FOLDER_NOT_FOUND'
        | 'WORKING_FOLDER_UNAVAILABLE';
      reason?: string;
    }
  | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  try {
    if (Object.getPrototypeOf(error) !== Object.prototype) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(error);
    const code = descriptors.code;
    const reason = descriptors.reason;
    if (
      !code ||
      !('value' in code) ||
      ![
        'INVALID_PROVIDER',
        'PROVIDER_UNAVAILABLE',
        'WORKING_FOLDER_INVALID',
        'WORKING_FOLDER_NOT_FOUND',
        'WORKING_FOLDER_UNAVAILABLE',
      ].includes(code.value) ||
      (reason && (!('value' in reason) || typeof reason.value !== 'string'))
    ) {
      return undefined;
    }
    return {
      code: code.value,
      ...(reason ? { reason: reason.value as string } : {}),
    };
  } catch {
    return undefined;
  }
};

export function createAgentsRouter(
  deps: Deps = {
    listAgents,
    getAgentDetails,
  },
) {
  const router = Router();

  const forkFailure = (res: import('express').Response, error: unknown) => {
    if (error instanceof ForkError)
      return res
        .status(error.status)
        .json({ code: error.code, message: error.message });
    // Only known plain target-preparation errors have a client-facing contract.
    const targetError = getKnownTargetPreparationError(error);
    if (targetError) {
      const message = targetError.reason ?? 'Target agent preparation failed.';
      const status =
        targetError.code === 'INVALID_PROVIDER'
          ? 409
          : targetError.code === 'WORKING_FOLDER_INVALID' ||
              targetError.code === 'WORKING_FOLDER_NOT_FOUND'
            ? 400
            : 503;
      return res.status(status).json({ code: targetError.code, message });
    }
    return res.status(503).json({
      code: 'FORK_UNAVAILABLE',
      message:
        error instanceof Error
          ? error.message
          : 'Conversation fork is unavailable.',
    });
  };

  router.get(
    '/agents/conversations/:conversationId/fork-options',
    async (req, res) => {
      try {
        const sourceTurnId =
          typeof req.query.sourceTurnId === 'string'
            ? req.query.sourceTurnId
            : undefined;
        res.json(
          await (deps.getForkOptions ?? getForkOptions)(
            req.params.conversationId,
            sourceTurnId,
          ),
        );
      } catch (error) {
        forkFailure(res, error);
      }
    },
  );

  router.post(
    '/agents/conversations/:conversationId/fork',
    async (req, res) => {
      const { requestId, targetAgentName, sourceTurnId } = req.body ?? {};
      if (
        typeof requestId !== 'string' ||
        !/^[a-zA-Z0-9_-]{8,128}$/.test(requestId) ||
        typeof targetAgentName !== 'string' ||
        !targetAgentName.trim() ||
        (sourceTurnId !== undefined && typeof sourceTurnId !== 'string')
      ) {
        return res.status(400).json({
          code: 'FORK_INVALID_REQUEST',
          message: 'A stable requestId and target agent are required.',
        });
      }
      try {
        res.json(
          await (deps.forkAgentConversation ?? forkAgentConversation)({
            sourceConversationId: req.params.conversationId,
            targetAgentName,
            sourceTurnId,
            requestId,
          }),
        );
      } catch (error) {
        forkFailure(res, error);
      }
    },
  );

  router.get('/agents', async (_req, res) => {
    const requestId =
      (res.locals?.requestId as string | undefined) ?? undefined;

    try {
      const payload = await deps.listAgents();
      baseLogger.info(
        { requestId, agents: payload.agents.length },
        'agents list',
      );
      res.json(payload);
    } catch (err) {
      baseLogger.error({ requestId, err }, 'agents list failed');
      res.status(500).json({ error: 'agents_unavailable' });
    }
  });

  router.get('/agents/:agentName', async (req, res) => {
    const requestId =
      (res.locals?.requestId as string | undefined) ?? undefined;
    const agentName = req.params.agentName?.trim();

    if (!agentName) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'agentName path param is required',
      });
    }

    try {
      const agent = await deps.getAgentDetails(agentName);
      res.json({ agent });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'AGENT_NOT_FOUND') {
        return res.status(404).json({ error: 'not_found' });
      }
      baseLogger.error({ requestId, err, agentName }, 'agent details failed');
      res.status(500).json({ error: 'agent_details_failed' });
    }
  });

  return router;
}
