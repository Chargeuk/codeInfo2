import { Router } from 'express';
import { z } from 'zod';

import { getWsHub } from '../ws/hub.js';
import { getInflightRegistry } from '../ws/inflightRegistry.js';

const bodySchema = z
  .object({
    conversationId: z.string().min(1),
    inflightId: z.string().min(1),
  })
  .strict();

export function createChatCancelRouter() {
  const router = Router();
  const inflight = getInflightRegistry();
  const wsHub = getWsHub();

  router.post('/cancel', (req, res) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'validation_error',
        details: parsed.error.format(),
      });
    }

    const { conversationId, inflightId } = parsed.data;
    const result = inflight.cancel(conversationId, inflightId);
    if (!result.ok) {
      return res.status(404).json({ error: 'not_found' });
    }

    if (result.finalizedNow) {
      wsHub.turnFinal({
        conversationId,
        inflightId,
        status: 'stopped',
      });
    }

    return res.json({ status: 'ok' });
  });

  return router;
}
