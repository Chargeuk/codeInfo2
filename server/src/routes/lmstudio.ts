import type { LmStudioStatusResponse } from '@codeinfo2/common';
import type { LMStudioClient } from '@lmstudio/sdk';
import { Router } from 'express';

type ClientFactory = (baseUrl: string) => LMStudioClient;

export function createLmStudioRouter({
  clientFactory,
}: {
  clientFactory: ClientFactory;
}) {
  const router = Router();
  void clientFactory;
  router.get('/lmstudio/status', async (_req, res) => {
    // logic added in Task 3
    res.json({
      status: 'error',
      baseUrl: '',
      error: 'not implemented',
    } satisfies LmStudioStatusResponse);
  });
  return router;
}
