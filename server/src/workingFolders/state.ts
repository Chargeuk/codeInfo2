import fs from 'node:fs/promises';
import path from 'node:path';

import { mapHostWorkingFolderToWorkdir } from '../ingest/pathMap.js';
import { append } from '../logStore.js';

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
  (((error as WorkingFolderValidationError).code ===
    'WORKING_FOLDER_UNAVAILABLE') ||
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

const isMissingPathError = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

const defaultStatPath = async (dirPath: string) =>
  await fs.stat(dirPath, { bigint: false });
let statPath = defaultStatPath;

export const setWorkingFolderStatForTests = (
  next:
    | ((dirPath: string) => ReturnType<typeof defaultStatPath>)
    | undefined,
): void => {
  statPath = next ?? defaultStatPath;
};

const toUnavailableWorkingFolderError = (
  dirPath: string,
  error: unknown,
): WorkingFolderValidationError => {
  const causeCode =
    typeof (error as NodeJS.ErrnoException | undefined)?.code === 'string'
      ? (error as NodeJS.ErrnoException).code
      : undefined;
  return {
    code: 'WORKING_FOLDER_UNAVAILABLE',
    reason: causeCode
      ? `working_folder could not be validated (${causeCode})`
      : `working_folder could not be validated for ${dirPath}`,
    ...(causeCode ? { causeCode } : {}),
  };
};

const isDirectory = async (dirPath: string): Promise<boolean> => {
  try {
    const stat = await statPath(dirPath);
    return stat.isDirectory();
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw toUnavailableWorkingFolderError(dirPath, error);
  }
};

const normalizeWorkingFolder = (value: string) => path.resolve(value.trim());

const getKnownRepositorySet = (paths: string[]) =>
  new Set(paths.map((entry) => path.resolve(entry)));

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
};

const getLocalCodeInfo2Root = () => {
  const agentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  if (agentsHome) return path.resolve(agentsHome, '..');
  return path.resolve('codex_agents', '..');
};

const validateKnownRepository = (params: {
  workingFolder: string;
  knownRepositoryPathsState?: KnownRepositoryPathsState;
}): WorkingFolderValidationError | null => {
  if (params.workingFolder === getLocalCodeInfo2Root()) return null;

  const knownRepositoriesState = params.knownRepositoryPathsState;
  if (!knownRepositoriesState || knownRepositoriesState.status === 'unavailable') {
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
  if (!working_folder || !working_folder.trim()) return undefined;

  const workingFolder = working_folder.trim();
  const normalized = workingFolder.replace(/\\/g, '/');
  if (
    !(path.posix.isAbsolute(normalized) || path.win32.isAbsolute(workingFolder))
  ) {
    throw {
      code: 'WORKING_FOLDER_INVALID',
      reason: 'working_folder must be an absolute path',
    } as const satisfies WorkingFolderValidationError;
  }

  const hostIngestDir = process.env.CODEINFO_HOST_INGEST_DIR;
  const codexWorkdir =
    process.env.CODEX_WORKDIR ?? process.env.CODEINFO_CODEX_WORKDIR ?? '/data';

  if (hostIngestDir && hostIngestDir.length > 0) {
    const normalizedHostIngestDir = hostIngestDir.replace(/\\/g, '/');
    if (
      path.posix.isAbsolute(normalizedHostIngestDir) &&
      path.posix.isAbsolute(normalized)
    ) {
      const mapped = mapHostWorkingFolderToWorkdir({
        hostIngestDir,
        codexWorkdir,
        hostWorkingFolder: workingFolder,
      });

      if ('mappedPath' in mapped) {
        if (await isDirectory(mapped.mappedPath)) return mapped.mappedPath;
      }
    }
  }

  if (await isDirectory(workingFolder))
    return normalizeWorkingFolder(workingFolder);

  throw {
    code: 'WORKING_FOLDER_NOT_FOUND',
    reason: 'working_folder not found',
  } as const satisfies WorkingFolderValidationError;
}

export async function validateRequestedWorkingFolder(params: {
  workingFolder?: string;
  knownRepositoryPathsState?: KnownRepositoryPathsState;
}): Promise<string | undefined> {
  const resolved = await resolveWorkingFolderWorkingDirectory(
    params.workingFolder,
  );
  if (!resolved) return undefined;
  const knownRepositoryError = validateKnownRepository({
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
  clearPersistedWorkingFolder: (conversationId: string) => Promise<void>;
  knownRepositoryPathsState?: KnownRepositoryPathsState;
}): Promise<string | undefined> {
  const conversationId = getConversationId(params.conversation);
  const savedWorkingFolder = getConversationSavedWorkingFolder(
    params.conversation,
  );
  if (!conversationId || !savedWorkingFolder) return undefined;

  try {
    const resolved = await validateRequestedWorkingFolder({
      workingFolder: savedWorkingFolder,
      knownRepositoryPathsState: params.knownRepositoryPathsState,
    });
    if (!resolved) return undefined;
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

    await params.clearPersistedWorkingFolder(conversationId);
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
