import { Router } from 'express';

import { discoverFlows } from '../flows/discovery.js';
import { listIngestedRepositories } from '../lmstudio/toolService.js';

export function createFlowsRouter(
  deps: {
    discoverFlows?: typeof discoverFlows;
    listIngestedRepositories?: typeof listIngestedRepositories;
  } = {},
) {
  const router = Router();
  const resolvedDiscoverFlows = deps.discoverFlows ?? discoverFlows;

  router.get('/flows', async (_req, res) => {
    const flows = await resolvedDiscoverFlows({
      listIngestedRepositories: deps.listIngestedRepositories,
    });
    res.json({ flows });
  });

  return router;
}
