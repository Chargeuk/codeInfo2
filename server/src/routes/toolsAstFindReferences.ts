import { Router } from 'express';
import {
  AstIndexRequiredError,
  astFindReferences,
  type AstFindReferencesParams,
  validateAstFindReferences,
} from '../ast/toolService.js';
import { IngestRequiredError } from '../ingest/chromaClient.js';
import { ValidationError, RepoNotFoundError } from '../lmstudio/toolService.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';

type Deps = {
  astFindReferences: typeof astFindReferences;
  validateAstFindReferences: typeof validateAstFindReferences;
};

export function createToolsAstFindReferencesRouter(
  deps: Deps = {
    astFindReferences,
    validateAstFindReferences,
  },
) {
  const router = Router();

  router.post('/tools/ast-find-references', async (req, res) => {
    const requestId =
      (res.locals?.requestId as string | undefined) ?? undefined;
    const context = {
      event: 'DEV-0000032:T8:ast-rest-request',
      route: '/tools/ast-find-references',
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
      const validated = deps.validateAstFindReferences(
        req.body as AstFindReferencesParams,
      );
      const payload = await deps.astFindReferences(validated);
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
