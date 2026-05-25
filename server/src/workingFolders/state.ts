import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveAgentHomeEnv } from '../agents/roots.js';
import { mapIngestPath, resolveMountedIngestPath } from '../ingest/pathMap.js';
import { append } from '../logStore.js';
import {
  resolveWorkingFolderWorkingDirectory as resolveSharedWorkingFolderWorkingDirectory,
  setExecutionContextStatForTests,
} from './executionContext.js';

export const DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION =
  'DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION';

type WorkingFolderErrorCode =
  | 'WORKING_FOLDER_INVALID'
  | 'WORKING_FOLDER_NOT_FOUND'
  | 'WORKING_FOLDER_UNAVAILABLE'
  | 'WORKING_FOLDER_REPOSITORY_UNAVAILABLE';

export type WorkingFolderValidationError = {
  code: WorkingFolderErrorCode;
  reason: string;
  causeCode?: string;
};

export const isWorkingFolderOperationalError = (
  error: unknown,
): error is WorkingFolderValidationError =>
  Boolean(error) &&
  typeof error === 'object' &&
  ((error as WorkingFolderValidationError).code ===
    'WORKING_FOLDER_UNAVAILABLE' ||
    (error as WorkingFolderValidationError).code ===
      'WORKING_FOLDER_REPOSITORY_UNAVAILABLE');

export const getWorkingFolderClientMessage = (
  error:
    | {
        code?: string;
      }
    | undefined,
) => {
  if (error?.code === 'WORKING_FOLDER_REPOSITORY_UNAVAILABLE') {
    return 'working_folder repository validation is temporarily unavailable';
  }
  return 'working_folder is temporarily unavailable';
};

export type KnownRepositoryPathsState =
  | {
      status: 'available';
      knownRepositoryPaths: string[];
    }
  | {
      status: 'unavailable';
      reason: string;
      causeCode?: string;
    };

export type WorkingFolderRecordType = 'chat' | 'agent' | 'flow';

export type WorkingFolderDecisionAction =
  | 'save'
  | 'restore'
  | 'clear'
  | 'reject';

type ConversationLike = {
  _id?: string;
  conversationId?: string;
  agentName?: string;
  flowName?: string;
  flags?: Record<string, unknown>;
};

export const setWorkingFolderStatForTests = (
  next: Parameters<typeof setExecutionContextStatForTests>[0],
): void => {
  setExecutionContextStatForTests(next);
};

const getKnownRepositorySet = (paths: string[]) => {
  const knownPaths = new Set<string>();

  paths.forEach((entry) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) return;
    const normalized = entry.trim();
    const mapped = mapIngestPath(normalized);
    knownPaths.add(path.resolve(normalized));
    knownPaths.add(path.resolve(mapped.containerPath));
    knownPaths.add(path.resolve(mapped.hostPath));
    knownPaths.add(
      path.resolve(
        resolveMountedIngestPath({
          containerPath: mapped.containerPath,
          hostPath: mapped.hostPath,
        }),
      ),
    );
  });

  return knownPaths;
};

export const knownRepositoryPathsAvailable = (
  knownRepositoryPaths: string[],
): KnownRepositoryPathsState => ({
  status: 'available',
  knownRepositoryPaths,
});

export const knownRepositoryPathsUnavailable = (
  error?: unknown,
): KnownRepositoryPathsState => {
  const causeCode =
    typeof (error as NodeJS.ErrnoException | undefined)?.code === 'string'
      ? (error as NodeJS.ErrnoException).code
      : undefined;
  const rawReason =
    typeof (error as { reason?: unknown } | undefined)?.reason === 'string'
      ? (error as { reason: string }).reason
      : error instanceof Error && error.message.trim().length > 0
        ? error.message.trim()
        : undefined;

  return {
    status: 'unavailable',
    reason:
      rawReason ??
      'working_folder repository membership could not be validated',
    ...(causeCode ? { causeCode } : {}),
  };
};

export async function resolveKnownRepositoryPathsState(
  loadKnownRepositoryPaths: () => Promise<string[]>,
): Promise<KnownRepositoryPathsState> {
  try {
    return knownRepositoryPathsAvailable(await loadKnownRepositoryPaths());
  } catch (error) {
    return knownRepositoryPathsUnavailable(error);
  }
}

const getLocalCodeInfo2Root = () => resolveAgentHomeEnv().codeInfoRoot;

const getLocalCodeInfo2IdentityPaths = async () => {
  const codeInfoRoot = getLocalCodeInfo2Root();
  const resolved = await resolveSharedWorkingFolderWorkingDirectory(
    codeInfoRoot,
    { allowMissingHostPath: true },
  );
  return new Set(
    [codeInfoRoot, resolved].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    ),
  );
};

const validateKnownRepository = async (params: {
  workingFolder: string;
  knownRepositoryPathsState?: KnownRepositoryPathsState;
}): Promise<WorkingFolderValidationError | null> => {
  if (params.workingFolder === getLocalCodeInfo2Root()) return null;
  if ((await getLocalCodeInfo2IdentityPaths()).has(params.workingFolder)) {
    return null;
  }

  const knownRepositoriesState = params.knownRepositoryPathsState;
  if (
    !knownRepositoriesState ||
    knownRepositoriesState.status === 'unavailable'
  ) {
    return {
      code: 'WORKING_FOLDER_REPOSITORY_UNAVAILABLE',
      reason:
        knownRepositoriesState?.reason ??
        'working_folder repository membership could not be validated',
      ...(knownRepositoriesState?.causeCode
        ? { causeCode: knownRepositoriesState.causeCode }
        : {}),
    };
  }

  const knownRepositories = getKnownRepositorySet(
    knownRepositoriesState.knownRepositoryPaths,
  );
  if (knownRepositories.has(params.workingFolder)) return null;

  return {
    code: 'WORKING_FOLDER_NOT_FOUND',
    reason: 'working_folder not found',
  };
};

export function getConversationRecordType(
  conversation?: ConversationLike | null,
): WorkingFolderRecordType {
  if (conversation?.flowName) return 'flow';
  if (conversation?.agentName) return 'agent';
  return 'chat';
}

export function getConversationSavedWorkingFolder(
  conversation?: ConversationLike | null,
): string | undefined {
  const value = conversation?.flags?.workingFolder;
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  return value.trim();
}

export function getConversationId(
  conversation?: ConversationLike | null,
): string | undefined {
  return conversation?._id ?? conversation?.conversationId;
}

export function appendWorkingFolderDecisionLog(params: {
  conversationId: string;
  recordType: WorkingFolderRecordType;
  surface: string;
  action: WorkingFolderDecisionAction;
  decisionReason: string;
  workingFolder?: string;
  stalePath?: string;
  level?: 'info' | 'warn';
  errorCode?: WorkingFolderErrorCode;
  errorReason?: string;
  causeCode?: string;
}): void {
  append({
    level: params.level ?? (params.action === 'clear' ? 'warn' : 'info'),
    message: DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION,
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      conversationId: params.conversationId,
      recordType: params.recordType,
      surface: params.surface,
      action: params.action,
      decisionReason: params.decisionReason,
      ...(params.workingFolder ? { workingFolder: params.workingFolder } : {}),
      ...(params.stalePath ? { stalePath: params.stalePath } : {}),
      ...(params.errorCode ? { errorCode: params.errorCode } : {}),
      ...(params.errorReason ? { errorReason: params.errorReason } : {}),
      ...(params.causeCode ? { causeCode: params.causeCode } : {}),
    },
  });
}

export async function resolveWorkingFolderWorkingDirectory(
  working_folder: string | undefined,
): Promise<string | undefined> {
  return await resolveSharedWorkingFolderWorkingDirectory(working_folder);
}

export async function validateRequestedWorkingFolder(params: {
  workingFolder?: string;
  knownRepositoryPathsState?: KnownRepositoryPathsState;
}): Promise<string | undefined> {
  const resolved = await resolveWorkingFolderWorkingDirectory(
    params.workingFolder,
  );
  if (!resolved) return undefined;
  const knownRepositoryError = await validateKnownRepository({
    workingFolder: resolved,
    knownRepositoryPathsState: params.knownRepositoryPathsState,
  });
  if (knownRepositoryError) {
    throw knownRepositoryError;
  }
  return resolved;
}

export async function restoreSavedWorkingFolder(params: {
  conversation: ConversationLike;
  surface: string;
  clearPersistedWorkingFolder: (
    conversationId: string,
    expectedWorkingFolder?: string,
  ) => Promise<string | undefined>;
  knownRepositoryPathsState?: KnownRepositoryPathsState;
}): Promise<string | undefined> {
  const conversationId = getConversationId(params.conversation);
  const savedWorkingFolder = getConversationSavedWorkingFolder(
    params.conversation,
  );
  if (!conversationId || !savedWorkingFolder) return undefined;

  try {
    // Allow resolving the saved host working folder even when the local mount
    // is not present so downstream repository membership validation can make
    // the final decision based on ingested repository identities.
    const resolved = await resolveSharedWorkingFolderWorkingDirectory(
      savedWorkingFolder,
      { allowMissingHostPath: true },
    );
    if (!resolved) return undefined;

    // If no repository membership state was provided and the resolved path
    // does not exist locally, treat the saved path as invalid and clear it.
    let existsLocally = true;
    try {
      const st = await fs.stat(resolved);
      existsLocally =
        typeof st?.isDirectory === 'function' ? st.isDirectory() : true;
    } catch {
      existsLocally = false;
    }
    if (!existsLocally && params.knownRepositoryPathsState === undefined) {
      const clearedWorkingFolder = await params.clearPersistedWorkingFolder(
        conversationId,
        savedWorkingFolder,
      );
      if (clearedWorkingFolder) {
        appendWorkingFolderDecisionLog({
          conversationId,
          recordType: getConversationRecordType(params.conversation),
          surface: params.surface,
          action: 'restore',
          decisionReason: 'saved_value_valid',
          workingFolder: clearedWorkingFolder,
        });
        return clearedWorkingFolder;
      }
      appendWorkingFolderDecisionLog({
        conversationId,
        recordType: getConversationRecordType(params.conversation),
        surface: params.surface,
        action: 'clear',
        decisionReason: 'saved_value_invalid',
        stalePath: savedWorkingFolder,
        level: 'warn',
      });
      return undefined;
    }

    const knownRepositoryError = await validateKnownRepository({
      workingFolder: resolved,
      knownRepositoryPathsState: params.knownRepositoryPathsState,
    });
    if (knownRepositoryError) {
      throw knownRepositoryError;
    }

    appendWorkingFolderDecisionLog({
      conversationId,
      recordType: getConversationRecordType(params.conversation),
      surface: params.surface,
      action: 'restore',
      decisionReason: 'saved_value_valid',
      workingFolder: resolved,
    });
    return resolved;
  } catch (error) {
    const err = error as WorkingFolderValidationError | undefined;
    if (
      err?.code !== 'WORKING_FOLDER_INVALID' &&
      err?.code !== 'WORKING_FOLDER_NOT_FOUND'
    ) {
      appendWorkingFolderDecisionLog({
        conversationId,
        recordType: getConversationRecordType(params.conversation),
        surface: params.surface,
        action: 'reject',
        decisionReason: 'saved_value_unavailable',
        workingFolder: savedWorkingFolder,
        level: 'warn',
        ...(err?.code ? { errorCode: err.code } : {}),
        ...(err?.reason ? { errorReason: err.reason } : {}),
        ...(err?.causeCode ? { causeCode: err.causeCode } : {}),
      });
      throw error;
    }

    const clearedWorkingFolder = await params.clearPersistedWorkingFolder(
      conversationId,
      savedWorkingFolder,
    );
    if (clearedWorkingFolder) {
      appendWorkingFolderDecisionLog({
        conversationId,
        recordType: getConversationRecordType(params.conversation),
        surface: params.surface,
        action: 'restore',
        decisionReason: 'saved_value_valid',
        workingFolder: clearedWorkingFolder,
      });
      return clearedWorkingFolder;
    }
    appendWorkingFolderDecisionLog({
      conversationId,
      recordType: getConversationRecordType(params.conversation),
      surface: params.surface,
      action: 'clear',
      decisionReason: 'saved_value_invalid',
      stalePath: savedWorkingFolder,
      level: 'warn',
    });
    return undefined;
  }
}
