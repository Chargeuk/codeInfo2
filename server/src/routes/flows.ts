import { Router, type Request, type Response } from 'express';

import { getFlowDetails, listFlows } from '../flows/service.js';
import { listIngestedRepositories } from '../lmstudio/toolService.js';
import { bindCurrentTestEnvOverrides } from '../test/support/testEnvOverrideScope.js';

export function createFlowsRouter(
  deps: {
    listFlows?: typeof listFlows;
    getFlowDetails?: typeof getFlowDetails;
    listIngestedRepositories?: typeof listIngestedRepositories;
  } = {},
) {
  const router = Router();
  const resolvedListFlows = deps.listFlows ?? listFlows;
  const resolvedGetFlowDetails = deps.getFlowDetails ?? getFlowDetails;

  router.get(
    '/flows',
    bindCurrentTestEnvOverrides(async (_req: Request, res: Response) => {
      const payload = await resolvedListFlows({
        listIngestedRepositories: deps.listIngestedRepositories,
      });
      res.json({
        flows: payload.flows.map((flow) => ({
          name: flow.name,
          description: flow.description,
          disabled: flow.disabled,
          ...(flow.error ? { error: flow.error } : {}),
          ...(flow.warnings ? { warnings: flow.warnings } : {}),
          ...(flow.sourceId ? { sourceId: flow.sourceId } : {}),
          ...(flow.sourceLabel ? { sourceLabel: flow.sourceLabel } : {}),
        })),
      });
    }),
  );

  router.get(
    '/flows/:flowName',
    bindCurrentTestEnvOverrides(async (req: Request, res: Response) => {
      const flowName = req.params.flowName?.trim();
      const sourceId =
        typeof req.query.sourceId === 'string' && req.query.sourceId.trim()
          ? req.query.sourceId.trim()
          : undefined;

      if (!flowName) {
        return res.status(400).json({
          error: 'invalid_request',
          message: 'flowName path param is required',
        });
      }

      try {
        const flow = await resolvedGetFlowDetails({
          flowName,
          sourceId,
          listIngestedRepositories: deps.listIngestedRepositories,
        });
        res.json({
          flow: {
            name: flow.name,
            description: flow.description,
            disabled: flow.disabled,
            warnings: flow.warningDetails ?? [],
            ...(flow.disabledReason
              ? { disabledReason: flow.disabledReason }
              : {}),
            ...(flow.sourceId ? { sourceId: flow.sourceId } : {}),
            ...(flow.sourceLabel ? { sourceLabel: flow.sourceLabel } : {}),
          },
        });
      } catch (error) {
        if ((error as { code?: string }).code === 'FLOW_NOT_FOUND') {
          return res.status(404).json({ error: 'not_found' });
        }
        res.status(500).json({ error: 'flow_details_failed' });
      }
    }),
  );

  return router;
}
