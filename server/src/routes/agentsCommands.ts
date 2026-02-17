import { Router, json } from 'express';

import { listAgentCommands, startAgentCommand } from '../agents/service.js';
import { baseLogger, resolveLogConfig } from '../logger.js';

type Deps = {
  listAgentCommands: typeof listAgentCommands;
  startAgentCommand: typeof startAgentCommand;
};

type AgentCommandsBody = {
  commandName?: unknown;
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
  | { code: 'RUN_IN_PROGRESS'; reason?: string }
  | { code: 'CODEX_UNAVAILABLE'; reason?: string }
  | { code: 'WORKING_FOLDER_INVALID'; reason?: string }
  | { code: 'WORKING_FOLDER_NOT_FOUND'; reason?: string };

const isAgentCommandsError = (err: unknown): err is AgentCommandsError =>
  Boolean(err) &&
  typeof err === 'object' &&
  typeof (err as { code?: unknown }).code === 'string';

const validateRunBody = (
  body: unknown,
): {
  commandName: string;
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

  return { commandName, conversationId, working_folder, sourceId };
};

export function createAgentsCommandsRouter(
  deps: Deps = {
    listAgentCommands,
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
      conversationId?: string;
      working_folder?: string;
      sourceId?: string;
    };
    try {
      parsedBody = validateRunBody(req.body);
    } catch (err) {
      return res
        .status(400)
        .json({ error: 'invalid_request', message: (err as Error).message });
    }

    try {
      const result = await deps.startAgentCommand({
        agentName,
        commandName: parsedBody.commandName,
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
