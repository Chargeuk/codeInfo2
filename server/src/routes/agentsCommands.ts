import { Router } from 'express';

import { listAgentCommands } from '../agents/service.js';
import { baseLogger } from '../logger.js';

type Deps = {
  listAgentCommands: typeof listAgentCommands;
};

type AgentCommandsError = { code: 'AGENT_NOT_FOUND' };

const isAgentCommandsError = (err: unknown): err is AgentCommandsError =>
  Boolean(err) &&
  typeof err === 'object' &&
  typeof (err as { code?: unknown }).code === 'string';

export function createAgentsCommandsRouter(
  deps: Deps = {
    listAgentCommands,
  },
) {
  const router = Router();

  router.get('/:agentName/commands', async (req, res) => {
    const requestId =
      (res.locals?.requestId as string | undefined) ?? undefined;
    const agentName = String(req.params.agentName ?? '').trim();
    if (!agentName) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    try {
      const payload = await deps.listAgentCommands({ agentName });
      baseLogger.info(
        { requestId, agentName, commands: payload.commands.length },
        'agent commands list',
      );
      return res.json(payload);
    } catch (err) {
      if (isAgentCommandsError(err) && err.code === 'AGENT_NOT_FOUND') {
        return res.status(404).json({ error: 'not_found' });
      }

      baseLogger.error({ requestId, agentName, err }, 'agent commands failed');
      return res.status(500).json({ error: 'agent_commands_failed' });
    }
  });

  return router;
}
