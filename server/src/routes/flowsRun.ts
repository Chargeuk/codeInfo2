import { Router, json } from 'express';

import { startFlowRun } from '../flows/service.js';
import type { FlowRunError } from '../flows/types.js';
import { baseLogger, resolveLogConfig } from '../logger.js';

type Deps = {
  startFlowRun: typeof startFlowRun;
};

type FlowRunBody = {
  conversationId?: unknown;
  sourceId?: unknown;
  working_folder?: unknown;
  resumeStepPath?: unknown;
  customTitle?: unknown;
};

const isFlowRunError = (err: unknown): err is FlowRunError =>
  Boolean(err) &&
  typeof err === 'object' &&
  typeof (err as { code?: unknown }).code === 'string';

const validateBody = (
  body: unknown,
): {
  conversationId?: string;
  sourceId?: string;
  working_folder?: string;
  resumeStepPath?: number[];
  customTitle?: string;
} => {
  const candidate = (body ?? {}) as FlowRunBody;

  const rawConversationId = candidate.conversationId;
  if (rawConversationId !== undefined && rawConversationId !== null) {
    if (typeof rawConversationId !== 'string') {
      throw new Error('conversationId must be a string');
    }
  }
  const conversationId =
    typeof rawConversationId === 'string' && rawConversationId.trim().length > 0
      ? rawConversationId
      : undefined;

  const rawSourceId = candidate.sourceId;
  if (rawSourceId !== undefined && rawSourceId !== null) {
    if (typeof rawSourceId !== 'string') {
      throw new Error('sourceId must be a string');
    }
  }
  const sourceId =
    typeof rawSourceId === 'string' && rawSourceId.trim().length > 0
      ? rawSourceId.trim()
      : undefined;

  const rawWorkingFolder = candidate.working_folder;
  if (rawWorkingFolder !== undefined && rawWorkingFolder !== null) {
    if (typeof rawWorkingFolder !== 'string') {
      throw new Error('working_folder must be a string');
    }
  }
  const working_folder =
    typeof rawWorkingFolder === 'string' && rawWorkingFolder.trim().length > 0
      ? rawWorkingFolder.trim()
      : undefined;

  const rawResumeStepPath = candidate.resumeStepPath;
  if (rawResumeStepPath !== undefined && rawResumeStepPath !== null) {
    if (!Array.isArray(rawResumeStepPath)) {
      throw new Error('resumeStepPath must be an array of numbers');
    }
    rawResumeStepPath.forEach((value) => {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new Error('resumeStepPath must be an array of integers');
      }
      if (value < 0) {
        throw new Error('resumeStepPath must contain non-negative integers');
      }
    });
  }
  const resumeStepPath = Array.isArray(rawResumeStepPath)
    ? rawResumeStepPath
    : undefined;

  const rawCustomTitle = candidate.customTitle;
  if (rawCustomTitle !== undefined && rawCustomTitle !== null) {
    if (typeof rawCustomTitle !== 'string') {
      throw new Error('customTitle must be a string');
    }
  }
  const customTitle =
    typeof rawCustomTitle === 'string' && rawCustomTitle.trim().length > 0
      ? rawCustomTitle.trim()
      : undefined;

  return {
    conversationId,
    sourceId,
    working_folder,
    resumeStepPath,
    customTitle,
  };
};

export function createFlowsRunRouter(
  deps: Deps = {
    startFlowRun,
  },
) {
  const router = Router();
  const { maxClientBytes } = resolveLogConfig();
  router.use(json({ limit: `${maxClientBytes}b`, strict: false }));

  router.post('/flows/:flowName/run', async (req, res) => {
    const requestId =
      (res.locals?.requestId as string | undefined) ?? undefined;
    const flowName = String(req.params.flowName ?? '').trim();
    if (!flowName) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    const rawSize = JSON.stringify(req.body ?? {}).length;
    if (rawSize > maxClientBytes) {
      return res.status(400).json({ error: 'payload too large' });
    }

    let parsedBody: {
      conversationId?: string;
      sourceId?: string;
      working_folder?: string;
      resumeStepPath?: number[];
      customTitle?: string;
    };
    try {
      parsedBody = validateBody(req.body);
    } catch (err) {
      return res
        .status(400)
        .json({ error: 'invalid_request', message: (err as Error).message });
    }

    baseLogger.info(
      {
        requestId,
        flowName,
        customTitleProvided: Boolean(parsedBody.customTitle),
        customTitleLength: parsedBody.customTitle?.length ?? 0,
      },
      'flows.run.custom_title.validated',
    );

    try {
      const result = await deps.startFlowRun({
        flowName,
        conversationId: parsedBody.conversationId,
        sourceId: parsedBody.sourceId,
        working_folder: parsedBody.working_folder,
        resumeStepPath: parsedBody.resumeStepPath,
        customTitle: parsedBody.customTitle,
        source: 'REST',
      });

      baseLogger.info(
        {
          requestId,
          flowName,
          conversationId: result.conversationId,
          inflightId: result.inflightId,
        },
        'flows run started',
      );

      return res.status(202).json({
        status: 'started',
        flowName,
        conversationId: result.conversationId,
        inflightId: result.inflightId,
        modelId: result.modelId,
      });
    } catch (err) {
      if (isFlowRunError(err)) {
        if (err.code === 'FLOW_NOT_FOUND') {
          return res.status(404).json({ error: 'not_found' });
        }
        if (err.code === 'CONVERSATION_ARCHIVED') {
          return res.status(410).json({ error: 'archived' });
        }
        if (err.code === 'RUN_IN_PROGRESS') {
          return res.status(409).json({
            error: 'conflict',
            code: 'RUN_IN_PROGRESS',
            message:
              err.reason ??
              'A run is already in progress for this conversation.',
          });
        }
        if (err.code === 'CODEX_UNAVAILABLE') {
          return res
            .status(503)
            .json({ error: 'codex_unavailable', reason: err.reason });
        }
        if (err.code === 'AGENT_MISMATCH') {
          return res.status(400).json({
            error: 'agent_mismatch',
            message: err.reason ?? 'resume agent mismatch',
          });
        }
        if (
          err.code === 'WORKING_FOLDER_INVALID' ||
          err.code === 'WORKING_FOLDER_NOT_FOUND'
        ) {
          return res.status(400).json({
            error: 'invalid_request',
            code: err.code,
            message: err.reason ?? 'working_folder validation failed',
          });
        }
        if (err.code === 'INVALID_REQUEST') {
          return res.status(400).json({
            error: 'invalid_request',
            message: err.reason ?? 'flow run validation failed',
          });
        }
        return res.status(400).json({
          error: 'invalid_request',
          message: err.reason ?? 'flow run validation failed',
        });
      }

      baseLogger.error({ requestId, flowName, err }, 'flows run failed');
      return res.status(500).json({ error: 'flow_run_failed' });
    }
  });

  return router;
}
