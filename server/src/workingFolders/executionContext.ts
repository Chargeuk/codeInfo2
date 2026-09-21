import fs from 'node:fs/promises';
import path from 'node:path';

import { mapHostWorkingFolderToWorkdir } from '../ingest/pathMap.js';
import type { TurnRuntimeMetadata } from '../mongo/turn.js';
import { getScopedEnvValue } from '../test/support/testEnvOverrideScope.js';

type WorkingFolderValidationError = {
  code:
    | 'WORKING_FOLDER_INVALID'
    | 'WORKING_FOLDER_NOT_FOUND'
    | 'WORKING_FOLDER_UNAVAILABLE';
  reason: string;
  causeCode?: string;
};

const isMissingPathError = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

const defaultStatPath = async (dirPath: string) =>
  await fs.stat(dirPath, { bigint: false });
let statPath = defaultStatPath;

export const setExecutionContextStatForTests = (
  next: ((dirPath: string) => ReturnType<typeof defaultStatPath>) | undefined,
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
const normalizeOptionalRoot = (value: string | undefined) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return path.resolve(trimmed);
};

const pathExistsAsDirectory = async (dirPath: string): Promise<boolean> => {
  try {
    const stat = await fs.stat(dirPath, { bigint: false });
    return stat.isDirectory();
  } catch {
    return false;
  }
};

export type RepositoryExecutionContextMetadata = {
  selectedRepositoryPath: string;
  defaultExecutionRoot: string;
  workingDirectoryOverride: string;
  fallbackUsed: boolean;
  workingRepositoryAvailable: boolean;
};

export type SharedExecutionContext = {
  selectedRepositoryPath: string;
  defaultExecutionRoot: string;
  repositoryMetadata: RepositoryExecutionContextMetadata;
  runtime: TurnRuntimeMetadata;
  workingDirectoryOverride: string;
};

export const resolveDefaultExecutionRoot = (
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const preferred = getScopedEnvValue('CODEX_WORKDIR', env)?.trim();
  if (preferred) return preferred;

  const legacy = getScopedEnvValue('CODEINFO_CODEX_WORKDIR', env)?.trim();
  if (legacy) return legacy;

  return '/data';
};

export async function resolveWorkingFolderWorkingDirectory(
  working_folder: string | undefined,
  options?: { allowMissingHostPath?: boolean },
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

  const hostIngestDir = getScopedEnvValue('CODEINFO_HOST_INGEST_DIR');
  const defaultExecutionRoot = resolveDefaultExecutionRoot();

  if (hostIngestDir && hostIngestDir.length > 0) {
    const normalizedHostIngestDir = hostIngestDir.replace(/\\/g, '/');
    if (
      path.posix.isAbsolute(normalizedHostIngestDir) &&
      path.posix.isAbsolute(normalized)
    ) {
      const mapped = mapHostWorkingFolderToWorkdir({
        hostIngestDir,
        codexWorkdir: defaultExecutionRoot,
        hostWorkingFolder: workingFolder,
      });

      if ('mappedPath' in mapped) {
        if (await isDirectory(mapped.mappedPath)) return mapped.mappedPath;
      }
    }
  }

  if (await isDirectory(workingFolder))
    return normalizeWorkingFolder(workingFolder);

  // The requested host working folder was not present on the local filesystem.
  // If caller allows restoring host path even when the mount isn't present,
  // return normalized host path (do not throw). Otherwise throw NOT_FOUND.
  if (options?.allowMissingHostPath) {
    return normalizeWorkingFolder(workingFolder);
  }

  throw {
    code: 'WORKING_FOLDER_NOT_FOUND',
    reason: 'working_folder not found',
  } as const satisfies WorkingFolderValidationError;
}

export async function resolveSharedExecutionContext(params: {
  workingFolder?: string;
  defaultRepositoryRoot?: string;
  allowMissingWorkingFolder?: boolean;
}): Promise<SharedExecutionContext> {
  const requestedDefaultRepositoryRoot = normalizeOptionalRoot(
    params.defaultRepositoryRoot,
  );
  const defaultExecutionRoot =
    requestedDefaultRepositoryRoot &&
    (await pathExistsAsDirectory(requestedDefaultRepositoryRoot))
      ? requestedDefaultRepositoryRoot
      : resolveDefaultExecutionRoot();
  const resolvedWorkingFolder = await resolveWorkingFolderWorkingDirectory(
    params.workingFolder,
    {
      allowMissingHostPath: params.allowMissingWorkingFolder,
    },
  );
  const selectedRepositoryPath = resolvedWorkingFolder ?? defaultExecutionRoot;
  const fallbackUsed = resolvedWorkingFolder === undefined;
  const workingRepositoryAvailable = resolvedWorkingFolder !== undefined;

  return {
    selectedRepositoryPath,
    defaultExecutionRoot,
    workingDirectoryOverride: selectedRepositoryPath,
    repositoryMetadata: {
      selectedRepositoryPath,
      defaultExecutionRoot,
      workingDirectoryOverride: selectedRepositoryPath,
      fallbackUsed,
      workingRepositoryAvailable,
    },
    runtime: {
      ...(resolvedWorkingFolder
        ? { workingFolder: resolvedWorkingFolder }
        : {}),
      lookupSummary: {
        selectedRepositoryPath,
        fallbackUsed,
        workingRepositoryAvailable,
      },
    },
  };
}
