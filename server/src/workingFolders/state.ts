import fs from 'node:fs/promises';
import path from 'node:path';

import { mapHostWorkingFolderToWorkdir } from '../ingest/pathMap.js';
import { append } from '../logStore.js';

export const DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION =
  'DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION';

type WorkingFolderErrorCode =
  | 'WORKING_FOLDER_INVALID'
  | 'WORKING_FOLDER_NOT_FOUND';

export type WorkingFolderValidationError = {
  code: WorkingFolderErrorCode;
  reason: string;
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

const isDirectory = async (dirPath: string): Promise<boolean> => {
  const stat = await fs.stat(dirPath).catch(() => null);
  return Boolean(stat && stat.isDirectory());
};

const normalizeWorkingFolder = (value: string) => path.resolve(value.trim());

const getKnownRepositorySet = (paths?: string[]) => {
  if (!paths || paths.length === 0) return null;
  return new Set(paths.map((entry) => path.resolve(entry)));
};

const getLocalCodeInfo2Root = () => {
  const agentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  if (agentsHome) return path.resolve(agentsHome, '..');
  return path.resolve('codex_agents', '..');
};

const validateKnownRepository = (params: {
  workingFolder: string;
  knownRepositoryPaths?: string[];
}): WorkingFolderValidationError | null => {
  const knownRepositories = getKnownRepositorySet(params.knownRepositoryPaths);
  if (!knownRepositories) return null;

  if (knownRepositories.has(params.workingFolder)) return null;
  if (params.workingFolder === getLocalCodeInfo2Root()) return null;

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

  const hostIngestDir = process.env.HOST_INGEST_DIR;
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
  knownRepositoryPaths?: string[];
}): Promise<string | undefined> {
  const resolved = await resolveWorkingFolderWorkingDirectory(
    params.workingFolder,
  );
  if (!resolved) return undefined;
  const knownRepositoryError = validateKnownRepository({
    workingFolder: resolved,
    knownRepositoryPaths: params.knownRepositoryPaths,
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
  knownRepositoryPaths?: string[];
}): Promise<string | undefined> {
  const conversationId = getConversationId(params.conversation);
  const savedWorkingFolder = getConversationSavedWorkingFolder(
    params.conversation,
  );
  if (!conversationId || !savedWorkingFolder) return undefined;

  try {
    const resolved = await validateRequestedWorkingFolder({
      workingFolder: savedWorkingFolder,
      knownRepositoryPaths: params.knownRepositoryPaths,
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
  } catch {
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
