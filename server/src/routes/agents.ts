import { Router } from 'express';
import { getAgentDetails, listAgents } from '../agents/service.js';
import { baseLogger } from '../logger.js';

type Deps = {
  listAgents: typeof listAgents;
  getAgentDetails: typeof getAgentDetails;
};

export function createAgentsRouter(
  deps: Deps = {
    listAgents,
    getAgentDetails,
  },
) {
  const router = Router();

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
