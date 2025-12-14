import { Router } from 'express';
import { listAgents } from '../agents/service.js';
import { baseLogger } from '../logger.js';

type Deps = {
  listAgents: typeof listAgents;
};

export function createAgentsRouter(
  deps: Deps = {
    listAgents,
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

  return router;
}
