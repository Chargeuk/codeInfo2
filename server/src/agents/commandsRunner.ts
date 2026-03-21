import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  cleanupPendingConversationCancel,
  consumePendingConversationCancel,
  getInflight,
} from '../chat/inflightRegistry.js';
import { runReingestStepLifecycle } from '../chat/reingestStepLifecycle.js';
import { buildReingestToolResult } from '../chat/reingestToolResult.js';
import { getFlowAndCommandRetries } from '../config/flowAndCommandRetries.js';
import type { RepositoryCandidateLookupSummary } from '../flows/repositoryCandidateOrder.js';
import { formatReingestPrestartReason } from '../ingest/reingestError.js';
import { executeReingestRequest } from '../ingest/reingestExecution.js';
import type { ReingestResult } from '../ingest/reingestService.js';
import { runReingestRepository } from '../ingest/reingestService.js';
import { listIngestedRepositories } from '../lmstudio/toolService.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';
import type { TurnRuntimeMetadata } from '../mongo/turn.js';
import { formatRetryInstruction } from '../utils/retryContext.js';

import { executeCommandItem } from './commandItemExecutor.js';
import { loadAgentCommandFile } from './commandsLoader.js';
import { AbortError, runWithRetry } from './retry.js';
import {
  getActiveRunOwnership,
  releaseConversationLock,
  tryAcquireConversationLock,
} from './runLock.js';
import { getErrorMessage } from './transientReconnect.js';

const BASE_DELAY_MS = 500;

const commandAbortByConversationId = new Map<string, AbortController>();

export function abortAgentCommandRun(conversationId: string) {
  const controller = commandAbortByConversationId.get(conversationId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function abortAgentCommandRunForInflight(params: {
  conversationId: string;
  inflightId: string;
}) {
  const controller = commandAbortByConversationId.get(params.conversationId);
  if (!controller) return false;
  const inflight = getInflight(params.conversationId);
  if (!inflight) return false;
  if (inflight.inflightId !== params.inflightId) return false;
  if (!inflight.command) return false;
  controller.abort();
  return true;
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
  startStep?: number;
  conversationId?: string;
  commandsRoot?: string;
  commandFilePath?: string;
  sourceId?: string;
  listIngestedRepositories?: typeof listIngestedRepositories;
  lockAlreadyHeld?: boolean;
  working_folder?: string;
  signal?: AbortSignal;
  source: 'REST' | 'MCP';
  initialModelId?: string;
  lookupSummary?: RepositoryCandidateLookupSummary;
  logger?: LoggerLike;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  releaseConversationLockFn?: typeof releaseConversationLock;
  runToken?: string;
  onPrestartFailure?: (params: {
    command: { name: string; stepIndex: number; totalSteps: number };
    instruction: string;
    message: string;
    errorCode?: string;
  }) => Promise<void>;
  runAgentInstructionUnlocked: (params: {
    agentName: string;
    instruction: string;
    working_folder?: string;
    conversationId: string;
    mustExist?: boolean;
    command?: { name: string; stepIndex: number; totalSteps: number };
    runtime?: TurnRuntimeMetadata;
    signal?: AbortSignal;
    source: 'REST' | 'MCP';
  }) => Promise<{ modelId: string }>;
};

type CommandRunnerDeps = {
  runReingestRepository: (args: {
    sourceId?: string;
  }) => Promise<ReingestResult>;
  buildReingestToolResult: typeof buildReingestToolResult;
  runReingestStepLifecycle: typeof runReingestStepLifecycle;
  createCallId: () => string;
};

const defaultCommandRunnerDeps: CommandRunnerDeps = {
  runReingestRepository,
  buildReingestToolResult,
  runReingestStepLifecycle,
  createCallId: () => crypto.randomUUID(),
};

const commandRunnerDeps: CommandRunnerDeps = {
  ...defaultCommandRunnerDeps,
};

export function __setAgentCommandRunnerDepsForTests(
  overrides: Partial<CommandRunnerDeps>,
): void {
  Object.assign(commandRunnerDeps, overrides);
}

export function __resetAgentCommandRunnerDepsForTests(): void {
  Object.assign(commandRunnerDeps, defaultCommandRunnerDeps);
}

type CommandRunnerErrorCode =
  | 'COMMAND_INVALID'
  | 'COMMAND_NOT_FOUND'
  | 'RUN_IN_PROGRESS'
  | 'INVALID_START_STEP';

type CommandRunnerError = {
  code: CommandRunnerErrorCode;
  reason?: string;
};

const toCommandRunnerError = (
  code: CommandRunnerErrorCode,
  reason?: string,
): CommandRunnerError => ({ code, reason });

const getReingestRequestLogContext = (
  item: { type: 'reingest' } & (
    | { sourceId: string }
    | { target: 'current' | 'all' }
  ),
  schemaSource: 'command',
) => ({
  surface: 'command',
  targetMode: 'sourceId' in item ? 'sourceId' : item.target,
  requestedSelector: 'sourceId' in item ? item.sourceId : null,
  schemaSource,
});

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
  const commandsDir =
    params.commandsRoot ?? path.join(params.agentHome, 'commands');
  const filePath =
    params.commandFilePath ?? path.join(commandsDir, `${commandName}.json`);

  const commandStat = await fs.stat(filePath).catch((error) => {
    if ((error as { code?: string }).code === 'ENOENT') return null;
    throw error;
  });

  if (!commandStat?.isFile()) {
    throw toCommandRunnerError('COMMAND_NOT_FOUND');
  }

  const parsed = await loadAgentCommandFile({
    filePath,
    emitSchemaParseLogs: true,
  });
  if (!parsed.ok) {
    throw toCommandRunnerError('COMMAND_INVALID');
  }

  const command = parsed.command;
  const totalSteps = command.items.length;
  const startStep = params.startStep ?? 1;
  if (!Number.isInteger(startStep) || startStep < 1 || startStep > totalSteps) {
    throw toCommandRunnerError(
      'INVALID_START_STEP',
      `startStep must be between 1 and ${totalSteps}`,
    );
  }
  const startIndex = startStep - 1;
  const clientProvidedConversationId = Boolean(params.conversationId);
  const conversationId = params.conversationId ?? crypto.randomUUID();

  const lockAlreadyHeld = Boolean(params.lockAlreadyHeld);
  let lockAcquired = lockAlreadyHeld;
  let runToken = params.runToken;

  if (!lockAlreadyHeld) {
    if (!tryAcquireConversationLock(conversationId)) {
      throw toCommandRunnerError(
        'RUN_IN_PROGRESS',
        'A run is already in progress for this conversation.',
      );
    }
    const ownership = getActiveRunOwnership(conversationId);
    if (!ownership) {
      releaseConversationLock(conversationId);
      throw new Error('Conversation run ownership could not be resolved.');
    }
    runToken = ownership.runToken;
    lockAcquired = true;
  } else if (!runToken) {
    const ownership = getActiveRunOwnership(conversationId);
    if (!ownership) {
      throw new Error('Conversation run ownership could not be resolved.');
    }
    runToken = ownership.runToken;
  }

  const mustExist = false;

  const commandAbortController = new AbortController();
  commandAbortByConversationId.set(conversationId, commandAbortController);

  const combinedSignal = params.signal
    ? AbortSignal.any([params.signal, commandAbortController.signal])
    : commandAbortController.signal;
  const consumePendingCommandStop = () => {
    if (!runToken) return false;
    const pendingCancel = consumePendingConversationCancel({
      conversationId,
      runToken,
    });
    if (!pendingCancel) return false;
    commandAbortController.abort();
    return true;
  };

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
  append({
    level: 'info',
    message: 'DEV_0000040_T03_RUNNER_START_STEP',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      stage: 'runner_start',
      agentName: params.agentName,
      commandName,
      conversationId,
      startStep,
      totalSteps,
      startIndex,
      source: params.source,
    },
  });

  let modelId = params.initialModelId ?? 'gpt-5.1-codex-max';
  const logger = params.logger ?? (baseLogger as LoggerLike);
  const maxAttempts = getFlowAndCommandRetries();

  try {
    consumePendingCommandStop();

    for (let i = startIndex; i < totalSteps; i++) {
      consumePendingCommandStop();
      if (combinedSignal.aborted) break;

      const item = command.items[i];
      const stepMeta = {
        name: commandName,
        stepIndex: i + 1,
        totalSteps,
      };

      if (item.type === 'reingest') {
        append({
          level: 'info',
          message: 'DEV-0000050:T01:reingest_request_shape_accepted',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: getReingestRequestLogContext(item, 'command'),
        });

        const result = await executeReingestRequest({
          request: item,
          surface: 'command',
          currentOwnerSourceId: params.sourceId,
          deps: {
            listIngestedRepositories:
              params.listIngestedRepositories ?? listIngestedRepositories,
            runReingestRepository: commandRunnerDeps.runReingestRepository,
            appendLog: append,
          },
        });

        if (!result.ok) {
          const requestedLabel =
            'sourceId' in item ? item.sourceId : `target: ${item.target}`;
          await params.onPrestartFailure?.({
            command: stepMeta,
            instruction: `Re-ingest repository ${requestedLabel}`,
            message: formatReingestPrestartReason(result.error),
            errorCode: 'COMMAND_INVALID',
          });
          throw toCommandRunnerError(
            'COMMAND_INVALID',
            formatReingestPrestartReason(result.error),
          );
        }

        const callId = commandRunnerDeps.createCallId();
        const toolResult = commandRunnerDeps.buildReingestToolResult({
          callId,
          execution: result.value,
        });

        await commandRunnerDeps.runReingestStepLifecycle({
          conversationId,
          modelId,
          source: params.source,
          command: stepMeta,
          toolResult,
        });

        consumePendingCommandStop();
        const continuedToNextItem =
          i < totalSteps - 1 && !combinedSignal.aborted;
        append({
          level: 'info',
          message: 'DEV-0000045:T9:direct_command_reingest_recorded',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            commandName,
            itemIndex: i,
            targetMode: result.value.targetMode,
            requestedSelector: result.value.requestedSelector,
            sourceId:
              result.value.kind === 'single'
                ? result.value.outcome.sourceId
                : null,
            status:
              result.value.kind === 'single'
                ? result.value.outcome.status
                : null,
            repositoryCount:
              result.value.kind === 'batch'
                ? result.value.repositories.length
                : 1,
            repositories:
              result.value.kind === 'batch' ? result.value.repositories : null,
            callId,
            continuedToNextItem,
          },
        });
        continue;
      }

      const preparedInstruction = await executeCommandItem({
        item,
        itemIndex: i,
        commandName,
        workingRepositoryPath: params.working_folder,
        sourceId: params.sourceId,
        executeInstruction: async (instruction) => instruction,
      });
      if (preparedInstruction.itemType === 'skip') {
        continue;
      }
      const originalInstruction = preparedInstruction.instruction;

      if (preparedInstruction.markdownFile) {
        append({
          level: 'info',
          message: 'DEV-0000045:T4:direct_command_markdown_message_loaded',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            commandName,
            itemIndex: i,
            markdownFile: preparedInstruction.markdownFile,
            resolvedSourceId: preparedInstruction.resolvedSourceId,
            instructionLength: originalInstruction.length,
          },
        });
      }

      let previousError: unknown = null;
      let sanitizedErrorLength = 0;
      let currentAttempt = 0;
      const runtimeLookupSummary =
        preparedInstruction.lookupSummary ?? params.lookupSummary;
      const runtime: TurnRuntimeMetadata | undefined =
        runtimeLookupSummary || params.working_folder
          ? {
              ...(params.working_folder
                ? { workingFolder: params.working_folder }
                : {}),
              ...(runtimeLookupSummary
                ? { lookupSummary: runtimeLookupSummary }
                : {}),
            }
          : undefined;

      const res = await runWithRetry({
        runStep: async () => {
          consumePendingCommandStop();
          if (combinedSignal.aborted) {
            throw new AbortError();
          }
          currentAttempt += 1;
          const retryInstruction =
            currentAttempt > 1
              ? formatRetryInstruction({
                  originalInstruction,
                  previousError,
                })
              : null;
          if (retryInstruction) {
            sanitizedErrorLength = retryInstruction.sanitizedErrorLength;
          }
          return params.runAgentInstructionUnlocked({
            agentName: params.agentName,
            instruction: retryInstruction?.instruction ?? originalInstruction,
            working_folder: params.working_folder,
            conversationId,
            mustExist,
            command: stepMeta,
            runtime,
            signal: combinedSignal,
            source: params.source,
          });
        },
        isRetryableError: (err) => !(err instanceof AbortError),
        maxAttempts,
        baseDelayMs: BASE_DELAY_MS,
        signal: combinedSignal,
        sleep: async (ms, signal) => {
          consumePendingCommandStop();
          const sleep = params.sleep;
          if (sleep) {
            return sleep(ms, signal);
          }
          if (signal?.aborted) {
            throw new AbortError();
          }
          return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, ms);
            signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new AbortError());
              },
              { once: true },
            );
          });
        },
        onRetry: ({
          attempt,
          maxAttempts: allowedAttempts,
          error,
          delayMs,
        }) => {
          previousError = error;
          const retryInstruction = formatRetryInstruction({
            originalInstruction,
            previousError: error,
          });
          sanitizedErrorLength = retryInstruction.sanitizedErrorLength;
          const retryPromptInjected = attempt >= 1;
          logger.warn(
            {
              agentName: params.agentName,
              commandName,
              conversationId,
              stepIndex: stepMeta.stepIndex,
              attempt,
              maxAttempts: allowedAttempts,
              delayMs,
              reason: getErrorMessage(error) ?? null,
              retryPromptInjected,
              sanitizedErrorLength,
            },
            'DEV-0000036:T5:step_retry_attempt',
          );
          append({
            level: 'warn',
            message: 'DEV-0000036:T5:step_retry_attempt',
            timestamp: new Date().toISOString(),
            source: 'server',
            context: {
              surface: 'command',
              stepIndex: stepMeta.stepIndex,
              attempt,
              maxAttempts: allowedAttempts,
              reason: getErrorMessage(error) ?? null,
              retryPromptInjected,
              sanitizedErrorLength,
            },
          });
        },
        onSuccessAfterRetry: ({ attempts, maxAttempts: allowedAttempts }) => {
          logger.info(
            {
              agentName: params.agentName,
              commandName,
              conversationId,
              stepIndex: stepMeta.stepIndex,
              attempts,
              maxAttempts: allowedAttempts,
            },
            'command step succeeded after retry',
          );
        },
        onExhausted: ({ attempt, maxAttempts: allowedAttempts, error }) => {
          logger.error(
            {
              agentName: params.agentName,
              commandName,
              conversationId,
              stepIndex: stepMeta.stepIndex,
              attempt,
              maxAttempts: allowedAttempts,
              reason: getErrorMessage(error) ?? null,
              retryPromptInjected: attempt > 1,
              sanitizedErrorLength,
            },
            'DEV-0000036:T5:step_retry_exhausted',
          );
          append({
            level: 'error',
            message: 'DEV-0000036:T5:step_retry_exhausted',
            timestamp: new Date().toISOString(),
            source: 'server',
            context: {
              surface: 'command',
              stepIndex: stepMeta.stepIndex,
              attempt,
              maxAttempts: allowedAttempts,
              reason: getErrorMessage(error) ?? null,
              retryPromptInjected: attempt > 1,
              sanitizedErrorLength,
            },
          });
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
    try {
      if (lockAcquired) {
        const releaseLock =
          params.releaseConversationLockFn ?? releaseConversationLock;
        releaseLock(conversationId, runToken);
      }
    } finally {
      cleanupPendingConversationCancel({ conversationId, runToken });
    }
  }
}
