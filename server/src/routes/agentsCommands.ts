import { Router, json } from 'express';

import {
  listAgentCommands,
  listAgentPrompts,
  startAgentCommand,
} from '../agents/service.js';
import { append } from '../logStore.js';
import { baseLogger, resolveLogConfig } from '../logger.js';
import { getWorkingFolderClientMessage } from '../workingFolders/state.js';

type Deps = {
  listAgentCommands: typeof listAgentCommands;
  listAgentPrompts: typeof listAgentPrompts;
  startAgentCommand: typeof startAgentCommand;
};

type AgentCommandsBody = {
  commandName?: unknown;
  startStep?: unknown;
  conversationId?: unknown;
  working_folder?: unknown;
  sourceId?: unknown;
};

type AgentCommandsError =
  | { code: 'AGENT_NOT_FOUND' }
  | { code: 'CONVERSATION_ARCHIVED' }
  | { code: 'AGENT_MISMATCH' }
  | { code: 'COMMAND_NOT_FOUND' }
  | { code: 'COMMAND_INVALID'; reason?: string }
  | { code: 'INVALID_START_STEP'; reason?: string }
  | { code: 'RUN_IN_PROGRESS'; reason?: string }
  | { code: 'CODEX_UNAVAILABLE'; reason?: string }
  | { code: 'WORKING_FOLDER_INVALID'; reason?: string }
  | { code: 'WORKING_FOLDER_NOT_FOUND'; reason?: string }
  | {
      code:
        | 'WORKING_FOLDER_UNAVAILABLE'
        | 'WORKING_FOLDER_REPOSITORY_UNAVAILABLE';
      reason?: string;
      causeCode?: string;
    };

const isAgentCommandsError = (err: unknown): err is AgentCommandsError =>
  Boolean(err) &&
  typeof err === 'object' &&
  typeof (err as { code?: unknown }).code === 'string';

type PromptsQuery = { working_folder: string };

const validatePromptsQuery = (query: unknown): PromptsQuery => {
  const candidate = (query ?? {}) as { working_folder?: unknown };
  const rawWorkingFolder = candidate.working_folder;

  if (rawWorkingFolder === undefined || rawWorkingFolder === null) {
    throw new Error('working_folder is required');
  }
  if (typeof rawWorkingFolder !== 'string') {
    throw new Error('working_folder must be a string');
  }
  if (rawWorkingFolder.trim().length === 0) {
    throw new Error('working_folder is required');
  }

  return { working_folder: rawWorkingFolder.trim() };
};

const validateRunBody = (
  body: unknown,
): {
  commandName: string;
  startStep?: number;
  conversationId?: string;
  working_folder?: string;
  sourceId?: string;
} => {
  const candidate = (body ?? {}) as AgentCommandsBody;

  const rawCommandName = candidate.commandName;
  if (
    typeof rawCommandName !== 'string' ||
    rawCommandName.trim().length === 0
  ) {
    throw new Error('commandName is required');
  }
  const commandName = rawCommandName.trim();

  const rawStartStep = candidate.startStep;
  let startStep: number | undefined;
  if (rawStartStep !== undefined) {
    if (typeof rawStartStep !== 'number' || !Number.isInteger(rawStartStep)) {
      throw {
        code: 'INVALID_START_STEP',
        message: 'startStep must be between 1 and N',
      } as const;
    }
    startStep = rawStartStep;
  }

  const rawConversationId = candidate.conversationId;
  const conversationId =
    typeof rawConversationId === 'string' && rawConversationId.trim().length > 0
      ? rawConversationId
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

  return { commandName, startStep, conversationId, working_folder, sourceId };
};

export function createAgentsCommandsRouter(
  deps: Deps = {
    listAgentCommands,
    listAgentPrompts,
    startAgentCommand,
  },
) {
  const router = Router();
  const { maxClientBytes } = resolveLogConfig();
  router.use(json({ limit: `${maxClientBytes}b`, strict: false }));

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

  router.get('/:agentName/prompts', async (req, res) => {
    const requestId =
      (res.locals?.requestId as string | undefined) ?? undefined;
    const agentName = String(req.params.agentName ?? '').trim();
    if (!agentName) {
      baseLogger.warn(
        {
          requestId,
          status: 400,
          code: 'none',
        },
        '[agents.prompts.route.error] agentName=<blank> status=400 code=none',
      );
      return res.status(400).json({ error: 'invalid_request' });
    }

    let query: PromptsQuery;
    try {
      query = validatePromptsQuery(req.query);
    } catch (err) {
      const message = (err as Error).message;
      baseLogger.warn(
        {
          requestId,
          agentName,
          status: 400,
          code: 'none',
          message,
        },
        `[agents.prompts.route.error] agentName=${agentName} status=400 code=none`,
      );
      return res.status(400).json({ error: 'invalid_request', message });
    }

    baseLogger.info(
      {
        requestId,
        agentName,
        workingFolder: query.working_folder,
      },
      `[agents.prompts.route.request] agentName=${agentName} workingFolder=${query.working_folder}`,
    );

    try {
      const payload = await deps.listAgentPrompts({
        agentName,
        working_folder: query.working_folder,
      });
      baseLogger.info(
        {
          requestId,
          agentName,
          promptsCount: payload.prompts.length,
        },
        `[agents.prompts.route.success] agentName=${agentName} promptsCount=${payload.prompts.length}`,
      );
      return res.status(200).json(payload);
    } catch (err) {
      if (isAgentCommandsError(err)) {
        if (err.code === 'AGENT_NOT_FOUND') {
          baseLogger.warn(
            {
              requestId,
              agentName,
              status: 404,
              code: err.code,
            },
            `[agents.prompts.route.error] agentName=${agentName} status=404 code=${err.code}`,
          );
          return res.status(404).json({ error: 'not_found' });
        }
        if (
          err.code === 'WORKING_FOLDER_INVALID' ||
          err.code === 'WORKING_FOLDER_NOT_FOUND'
        ) {
          baseLogger.warn(
            {
              requestId,
              agentName,
              status: 400,
              code: err.code,
            },
            `[agents.prompts.route.error] agentName=${agentName} status=400 code=${err.code}`,
          );
          return res.status(400).json({
            error: 'invalid_request',
            code: err.code,
            message: err.reason ?? 'working_folder validation failed',
          });
        }
        if (
          err.code === 'WORKING_FOLDER_UNAVAILABLE' ||
          err.code === 'WORKING_FOLDER_REPOSITORY_UNAVAILABLE'
        ) {
          baseLogger.warn(
            {
              requestId,
              agentName,
              status: 503,
              code: err.code,
            },
            `[agents.prompts.route.error] agentName=${agentName} status=503 code=${err.code}`,
          );
          return res.status(503).json({
            error: 'working_folder_unavailable',
            code: err.code,
            message: getWorkingFolderClientMessage(err),
          });
        }
      }

      baseLogger.error(
        {
          requestId,
          agentName,
          err,
          status: 500,
          code: 'none',
        },
        `[agents.prompts.route.error] agentName=${agentName} status=500 code=none`,
      );
      return res.status(500).json({ error: 'agent_prompts_failed' });
    }
  });

  router.post('/:agentName/commands/run', async (req, res) => {
    const requestId =
      (res.locals?.requestId as string | undefined) ?? undefined;
    const agentName = String(req.params.agentName ?? '').trim();
    if (!agentName) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    const rawSize = JSON.stringify(req.body ?? {}).length;
    if (rawSize > maxClientBytes) {
      return res.status(400).json({ error: 'payload too large' });
    }

    let parsedBody: {
      commandName: string;
      startStep?: number;
      conversationId?: string;
      working_folder?: string;
      sourceId?: string;
    };
    try {
      parsedBody = validateRunBody(req.body);
      append({
        level: 'info',
        message: 'DEV_0000040_T02_START_STEP_VALIDATION',
        timestamp: new Date().toISOString(),
        source: 'server',
        context: {
          stage: 'route_validated',
          agentName,
          commandName: parsedBody.commandName,
          startStep: parsedBody.startStep ?? null,
          invalidCode: null,
        },
      });
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        (err as { code?: unknown }).code === 'INVALID_START_STEP'
      ) {
        const message =
          (err as { message?: string }).message ??
          'startStep must be between 1 and N';
        append({
          level: 'warn',
          message: 'DEV_0000040_T02_START_STEP_VALIDATION',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            stage: 'route_rejected',
            agentName,
            commandName: null,
            startStep: (req.body as { startStep?: unknown })?.startStep ?? null,
            invalidCode: 'INVALID_START_STEP',
            invalidMessage: message,
          },
        });
        return res.status(400).json({
          error: 'invalid_request',
          code: 'INVALID_START_STEP',
          message,
        });
      }
      return res
        .status(400)
        .json({ error: 'invalid_request', message: (err as Error).message });
    }

    try {
      const result = await deps.startAgentCommand({
        agentName,
        commandName: parsedBody.commandName,
        startStep: parsedBody.startStep,
        conversationId: parsedBody.conversationId,
        working_folder: parsedBody.working_folder,
        sourceId: parsedBody.sourceId,
        source: 'REST',
      });

      baseLogger.info(
        {
          requestId,
          agentName,
          commandName: result.commandName,
          conversationId: result.conversationId,
        },
        'agents command run started',
      );

      return res.status(202).json({
        status: 'started',
        agentName,
        commandName: result.commandName,
        conversationId: result.conversationId,
        modelId: result.modelId,
      });
    } catch (err) {
      if (isAgentCommandsError(err)) {
        if (
          err.code === 'AGENT_NOT_FOUND' ||
          err.code === 'COMMAND_NOT_FOUND'
        ) {
          return res.status(404).json({ error: 'not_found' });
        }
        if (err.code === 'CONVERSATION_ARCHIVED') {
          return res.status(410).json({ error: 'archived' });
        }
        if (err.code === 'AGENT_MISMATCH') {
          return res.status(400).json({ error: 'agent_mismatch' });
        }
        if (err.code === 'COMMAND_INVALID') {
          return res.status(400).json({
            error: 'invalid_request',
            code: 'COMMAND_INVALID',
            message: err.reason ?? 'command file validation failed',
          });
        }
        if (err.code === 'INVALID_START_STEP') {
          const message = err.reason ?? 'startStep must be between 1 and N';
          append({
            level: 'warn',
            message: 'DEV_0000040_T02_START_STEP_VALIDATION',
            timestamp: new Date().toISOString(),
            source: 'server',
            context: {
              stage: 'service_rejected',
              agentName,
              commandName: parsedBody.commandName,
              startStep: parsedBody.startStep ?? null,
              invalidCode: 'INVALID_START_STEP',
              invalidMessage: message,
            },
          });
          return res.status(400).json({
            error: 'invalid_request',
            code: 'INVALID_START_STEP',
            message,
          });
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
        if (
          err.code === 'WORKING_FOLDER_UNAVAILABLE' ||
          err.code === 'WORKING_FOLDER_REPOSITORY_UNAVAILABLE'
        ) {
          return res.status(503).json({
            error: 'working_folder_unavailable',
            code: err.code,
            message: getWorkingFolderClientMessage(err),
          });
        }
      }

      baseLogger.error(
        { requestId, agentName, commandName: parsedBody.commandName, err },
        'agents command run failed',
      );
      return res.status(500).json({ error: 'agent_commands_run_failed' });
    }
  });

  return router;
}
