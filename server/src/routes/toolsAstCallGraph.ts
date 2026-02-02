import { Router } from 'express';
import {
  AstIndexRequiredError,
  astCallGraph,
  type AstCallGraphParams,
  validateAstCallGraph,
} from '../ast/toolService.js';
import { IngestRequiredError } from '../ingest/chromaClient.js';
import { ValidationError, RepoNotFoundError } from '../lmstudio/toolService.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';

type Deps = {
  astCallGraph: typeof astCallGraph;
  validateAstCallGraph: typeof validateAstCallGraph;
};

export function createToolsAstCallGraphRouter(
  deps: Deps = {
    astCallGraph,
    validateAstCallGraph,
  },
) {
  const router = Router();

  router.post('/tools/ast-call-graph', async (req, res) => {
    const requestId =
      (res.locals?.requestId as string | undefined) ?? undefined;
    const context = {
      event: 'DEV-0000032:T8:ast-rest-request',
      route: '/tools/ast-call-graph',
      requestId,
      repository: (req.body as { repository?: string } | undefined)?.repository,
    };
    append({
      level: 'info',
      message: 'DEV-0000032:T8:ast-rest-request',
      timestamp: new Date().toISOString(),
      source: 'server',
      context,
    });
    baseLogger.info(context, 'AST REST request');

    try {
      const validated = deps.validateAstCallGraph(
        req.body as AstCallGraphParams,
      );
      const payload = await deps.astCallGraph(validated);
      return res.json(payload);
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.status(400).json({ error: err.code, details: err.details });
      }
      if (err instanceof RepoNotFoundError) {
        return res.status(404).json({ error: err.code });
      }
      if (err instanceof IngestRequiredError) {
        return res.status(409).json({ error: err.code, message: err.message });
      }
      if (err instanceof AstIndexRequiredError) {
        return res.status(409).json({
          error: err.code,
          message: err.message,
          repository: err.repository,
        });
      }
      return res
        .status(502)
        .json({ error: 'AST_TOOL_FAILED', message: `${err}` });
    }
  });

  return router;
}
