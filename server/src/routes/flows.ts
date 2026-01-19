import { Router } from 'express';

import { discoverFlows } from '../flows/discovery.js';

export function createFlowsRouter() {
  const router = Router();

  router.get('/flows', async (_req, res) => {
    const flows = await discoverFlows();
    res.json({ flows });
  });

  return router;
}
