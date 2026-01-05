import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';

import { loadAgentCommandFile } from './commandsLoader.js';
import { runWithRetry } from './retry.js';
import {
  releaseConversationLock,
  tryAcquireConversationLock,
} from './runLock.js';
import { getErrorMessage, isTransientReconnect } from './transientReconnect.js';

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;

const commandAbortByConversationId = new Map<string, AbortController>();

export function abortAgentCommandRun(conversationId: string) {
  const controller = commandAbortByConversationId.get(conversationId);
  if (!controller) return;
  controller.abort();
}

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

export type RunAgentCommandRunnerParams = {
  agentName: string;
  agentHome: string;
  commandName: string;
  conversationId?: string;
  lockAlreadyHeld?: boolean;
  working_folder?: string;
  signal?: AbortSignal;
  source: 'REST' | 'MCP';
  logger?: LoggerLike;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  runAgentInstructionUnlocked: (params: {
    agentName: string;
    instruction: string;
    working_folder?: string;
    conversationId: string;
    mustExist?: boolean;
    command?: { name: string; stepIndex: number; totalSteps: number };
    signal?: AbortSignal;
    source: 'REST' | 'MCP';
  }) => Promise<{ modelId: string }>;
};

type CommandRunnerErrorCode =
  | 'COMMAND_INVALID'
  | 'COMMAND_NOT_FOUND'
  | 'RUN_IN_PROGRESS';

type CommandRunnerError = {
  code: CommandRunnerErrorCode;
  reason?: string;
};

const toCommandRunnerError = (
  code: CommandRunnerErrorCode,
  reason?: string,
): CommandRunnerError => ({ code, reason });

function isSafeCommandName(raw: string): boolean {
  const name = raw.trim();
  if (!name) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.includes('..')) return false;
  return true;
}

export async function runAgentCommandRunner(
  params: RunAgentCommandRunnerParams,
): Promise<{
  agentName: string;
  commandName: string;
  conversationId: string;
  modelId: string;
}> {
  if (!isSafeCommandName(params.commandName)) {
    throw toCommandRunnerError('COMMAND_INVALID');
  }

  const commandName = params.commandName.trim();
  const commandsDir = path.join(params.agentHome, 'commands');
  const filePath = path.join(commandsDir, `${commandName}.json`);

  const commandStat = await fs.stat(filePath).catch((error) => {
    if ((error as { code?: string }).code === 'ENOENT') return null;
    throw error;
  });

  if (!commandStat?.isFile()) {
    throw toCommandRunnerError('COMMAND_NOT_FOUND');
  }

  const parsed = await loadAgentCommandFile({ filePath });
  if (!parsed.ok) {
    throw toCommandRunnerError('COMMAND_INVALID');
  }

  const command = parsed.command;
  const totalSteps = command.items.length;
  const clientProvidedConversationId = Boolean(params.conversationId);
  const conversationId = params.conversationId ?? crypto.randomUUID();

  const lockAlreadyHeld = Boolean(params.lockAlreadyHeld);
  let lockAcquired = lockAlreadyHeld;

  if (!lockAlreadyHeld) {
    if (!tryAcquireConversationLock(conversationId)) {
      throw toCommandRunnerError(
        'RUN_IN_PROGRESS',
        'A run is already in progress for this conversation.',
      );
    }
    lockAcquired = true;
  }

  const mustExist = false;

  const commandAbortController = new AbortController();
  commandAbortByConversationId.set(conversationId, commandAbortController);

  const combinedSignal = params.signal
    ? AbortSignal.any([params.signal, commandAbortController.signal])
    : commandAbortController.signal;

  append({
    level: 'info',
    message: 'DEV-0000021[T1] agents.commands mustExist resolved',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      agentName: params.agentName,
      commandName,
      conversationId,
      clientProvidedConversationId,
      mustExist,
    },
  });

  let modelId = 'gpt-5.1-codex-max';
  const logger = params.logger ?? (baseLogger as LoggerLike);

  try {
    for (let i = 0; i < totalSteps; i++) {
      if (combinedSignal.aborted) break;

      const item = command.items[i];
      const instruction = item.content.join('\n');

      const stepMeta = {
        name: commandName,
        stepIndex: i + 1,
        totalSteps,
      };

      const res = await runWithRetry({
        runStep: async () =>
          params.runAgentInstructionUnlocked({
            agentName: params.agentName,
            instruction,
            working_folder: params.working_folder,
            conversationId,
            mustExist,
            command: stepMeta,
            signal: combinedSignal,
            source: params.source,
          }),
        isRetryableError: (err) =>
          isTransientReconnect(getErrorMessage(err) ?? null),
        maxAttempts: MAX_ATTEMPTS,
        baseDelayMs: BASE_DELAY_MS,
        signal: combinedSignal,
        sleep: params.sleep,
        onRetry: ({ attempt, maxAttempts, error, delayMs }) => {
          logger.warn(
            {
              agentName: params.agentName,
              commandName,
              conversationId,
              stepIndex: stepMeta.stepIndex,
              attempt,
              maxAttempts,
              delayMs,
              errorMessage: getErrorMessage(error) ?? null,
            },
            'transient reconnect; retrying command step',
          );
        },
        onSuccessAfterRetry: ({ attempts, maxAttempts }) => {
          logger.info(
            {
              agentName: params.agentName,
              commandName,
              conversationId,
              stepIndex: stepMeta.stepIndex,
              attempts,
              maxAttempts,
            },
            'command step succeeded after retry',
          );
        },
        onExhausted: ({ attempt, maxAttempts, error }) => {
          logger.error(
            {
              agentName: params.agentName,
              commandName,
              conversationId,
              stepIndex: stepMeta.stepIndex,
              attempt,
              maxAttempts,
              errorMessage: getErrorMessage(error) ?? null,
            },
            'command retries exhausted',
          );
        },
      });

      modelId = res.modelId;
    }

    return {
      agentName: params.agentName,
      commandName,
      conversationId,
      modelId,
    };
  } finally {
    commandAbortByConversationId.delete(conversationId);
    if (lockAcquired) {
      releaseConversationLock(conversationId);
    }
  }
}
