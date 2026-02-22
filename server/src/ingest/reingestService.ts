import path from 'path';
import type { LMStudioClient } from '@lmstudio/sdk';
import { getClient } from '../lmstudio/clientPool.js';
import {
  listIngestedRepositories,
  type ListReposResult,
} from '../lmstudio/toolService.js';
import { append } from '../logStore.js';
import { toWebSocketUrl } from '../routes/lmstudioUrl.js';
import { isBusy, reembed } from './ingestJob.js';

const TOOL_NAME = 'reingest_repository';
const RETRY_MESSAGE =
  'The AI can retry using one of the provided re-ingestable repository ids/sourceIds.';

type ValidationReason =
  | 'missing'
  | 'non_string'
  | 'empty'
  | 'non_absolute'
  | 'non_normalized'
  | 'ambiguous_path'
  | 'unknown_root'
  | 'busy';

type ValidationFieldError = {
  field: 'sourceId';
  reason: ValidationReason;
  message: string;
};

type ReingestRetryLists = {
  reingestableRepositoryIds: string[];
  reingestableSourceIds: string[];
};

type InvalidParamsData = ReingestRetryLists & {
  tool: typeof TOOL_NAME;
  code: 'INVALID_SOURCE_ID';
  retryable: true;
  retryMessage: string;
  fieldErrors: ValidationFieldError[];
};

type NotFoundData = ReingestRetryLists & {
  tool: typeof TOOL_NAME;
  code: 'NOT_FOUND';
  retryable: true;
  retryMessage: string;
  fieldErrors: ValidationFieldError[];
};

type BusyData = ReingestRetryLists & {
  tool: typeof TOOL_NAME;
  code: 'BUSY';
  retryable: true;
  retryMessage: string;
  fieldErrors: ValidationFieldError[];
};

export type ReingestError =
  | {
      code: -32602;
      message: 'INVALID_PARAMS';
      data: InvalidParamsData;
    }
  | {
      code: 404;
      message: 'NOT_FOUND';
      data: NotFoundData;
    }
  | {
      code: 429;
      message: 'BUSY';
      data: BusyData;
    };

export type ReingestSuccess = {
  status: 'started';
  operation: 'reembed';
  runId: string;
  sourceId: string;
};

export type ReingestResult =
  | { ok: true; value: ReingestSuccess }
  | { ok: false; error: ReingestError };

export type ReingestServiceDeps = {
  listIngestedRepositories?: () => Promise<ListReposResult>;
  isBusy?: () => boolean;
  reembed?: (
    rootPath: string,
    deps: {
      lmClientFactory: (baseUrl: string) => LMStudioClient;
      baseUrl: string;
    },
  ) => Promise<string>;
  lmClientFactory?: (baseUrl: string) => LMStudioClient;
  lmBaseUrl?: string;
  appendLog?: (entry: Parameters<typeof append>[0]) => unknown;
};

function normalizePosixPath(rawPath: string) {
  return path.posix.normalize(rawPath.replace(/\\/g, '/'));
}

function buildRetryLists(repos: ListReposResult): ReingestRetryLists {
  const repositoryIds = new Set<string>();
  const sourceIds = new Set<string>();

  repos.repos.forEach((repo) => {
    if (repo.id) repositoryIds.add(repo.id);
    if (repo.containerPath) {
      sourceIds.add(normalizePosixPath(repo.containerPath));
    }
  });

  return {
    reingestableRepositoryIds: Array.from(repositoryIds).sort((a, b) =>
      a.localeCompare(b),
    ),
    reingestableSourceIds: Array.from(sourceIds).sort((a, b) =>
      a.localeCompare(b),
    ),
  };
}

function invalidParamsError(
  reason: ValidationReason,
  message: string,
  retryLists: ReingestRetryLists,
): ReingestError {
  return {
    code: -32602,
    message: 'INVALID_PARAMS',
    data: {
      tool: TOOL_NAME,
      code: 'INVALID_SOURCE_ID',
      retryable: true,
      retryMessage: RETRY_MESSAGE,
      fieldErrors: [
        {
          field: 'sourceId',
          reason,
          message,
        },
      ],
      ...retryLists,
    },
  };
}

function notFoundError(retryLists: ReingestRetryLists): ReingestError {
  return {
    code: 404,
    message: 'NOT_FOUND',
    data: {
      tool: TOOL_NAME,
      code: 'NOT_FOUND',
      retryable: true,
      retryMessage: RETRY_MESSAGE,
      fieldErrors: [
        {
          field: 'sourceId',
          reason: 'unknown_root',
          message:
            'sourceId must match an existing ingested repository root exactly',
        },
      ],
      ...retryLists,
    },
  };
}

function busyError(retryLists: ReingestRetryLists): ReingestError {
  return {
    code: 429,
    message: 'BUSY',
    data: {
      tool: TOOL_NAME,
      code: 'BUSY',
      retryable: true,
      retryMessage: RETRY_MESSAGE,
      fieldErrors: [
        {
          field: 'sourceId',
          reason: 'busy',
          message: 'reingest is currently locked by another ingest operation',
        },
      ],
      ...retryLists,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createValidationError(
  sourceId: unknown,
  retryLists: ReingestRetryLists,
): ReingestError | null {
  if (sourceId === undefined) {
    return invalidParamsError('missing', 'sourceId is required', retryLists);
  }

  if (typeof sourceId !== 'string') {
    return invalidParamsError(
      'non_string',
      'sourceId must be a string',
      retryLists,
    );
  }

  if (!sourceId.trim()) {
    return invalidParamsError(
      'empty',
      'sourceId must be a non-empty string',
      retryLists,
    );
  }

  const hasForwardSlash = sourceId.includes('/');
  const hasBackslash = sourceId.includes('\\');
  if (hasForwardSlash && hasBackslash) {
    return invalidParamsError(
      'ambiguous_path',
      'sourceId must not mix slash styles',
      retryLists,
    );
  }

  if (sourceId.length > 1 && sourceId.endsWith('/')) {
    return invalidParamsError(
      'ambiguous_path',
      'sourceId must not include a trailing slash variant',
      retryLists,
    );
  }

  if (/\/(\.\.?)(\/|$)/.test(sourceId)) {
    return invalidParamsError(
      'ambiguous_path',
      'sourceId must not include dot-segment path traversal forms',
      retryLists,
    );
  }

  if (!path.posix.isAbsolute(sourceId)) {
    return invalidParamsError(
      'non_absolute',
      'sourceId must be an absolute normalized container path',
      retryLists,
    );
  }

  if (hasBackslash) {
    return invalidParamsError(
      'non_normalized',
      'sourceId must be an absolute normalized container path',
      retryLists,
    );
  }

  const normalized = normalizePosixPath(sourceId);
  if (normalized !== sourceId) {
    return invalidParamsError(
      'non_normalized',
      'sourceId must be an absolute normalized container path',
      retryLists,
    );
  }

  return null;
}

function logValidationEvaluated(
  appendLog: (entry: Parameters<typeof append>[0]) => unknown,
  sourceId: unknown,
) {
  appendLog({
    level: 'info',
    source: 'server',
    timestamp: new Date().toISOString(),
    message: 'DEV-0000035:T5:reingest_validation_evaluated',
    context: {
      tool: TOOL_NAME,
      sourceIdType: typeof sourceId,
      sourceId,
    },
  });
}

function logValidationResult(
  appendLog: (entry: Parameters<typeof append>[0]) => unknown,
  result:
    | { kind: 'success'; sourceId: string; runId: string }
    | { kind: 'error'; error: ReingestError },
) {
  appendLog({
    level: 'info',
    source: 'server',
    timestamp: new Date().toISOString(),
    message: 'DEV-0000035:T5:reingest_validation_result',
    context:
      result.kind === 'success'
        ? {
            tool: TOOL_NAME,
            outcome: 'success',
            sourceId: result.sourceId,
            runId: result.runId,
          }
        : {
            tool: TOOL_NAME,
            outcome: 'error',
            code: result.error.message,
            errorCode: result.error.code,
            data: result.error.data,
          },
  });
}

export async function runReingestRepository(
  args: unknown,
  deps: ReingestServiceDeps = {},
): Promise<ReingestResult> {
  const listRepos = deps.listIngestedRepositories ?? listIngestedRepositories;
  const checkBusy = deps.isBusy ?? isBusy;
  const runReembed = deps.reembed ?? reembed;
  const lmClientFactory = deps.lmClientFactory ?? getClient;
  const lmBaseUrl = toWebSocketUrl(
    deps.lmBaseUrl ?? process.env.LMSTUDIO_BASE_URL ?? '',
  );
  const appendLog = deps.appendLog ?? append;

  const sourceId = isRecord(args) ? args.sourceId : undefined;
  logValidationEvaluated(appendLog, sourceId);

  const repos = await listRepos();
  const retryLists = buildRetryLists(repos);

  const validationError = createValidationError(sourceId, retryLists);
  if (validationError) {
    logValidationResult(appendLog, { kind: 'error', error: validationError });
    return { ok: false, error: validationError };
  }

  const normalizedSourceId = normalizePosixPath(sourceId as string);
  const knownRoots = new Set(retryLists.reingestableSourceIds);
  if (!knownRoots.has(normalizedSourceId)) {
    const err = notFoundError(retryLists);
    logValidationResult(appendLog, { kind: 'error', error: err });
    return { ok: false, error: err };
  }

  if (checkBusy()) {
    const err = busyError(retryLists);
    logValidationResult(appendLog, { kind: 'error', error: err });
    return { ok: false, error: err };
  }

  try {
    const runId = await runReembed(normalizedSourceId, {
      lmClientFactory,
      baseUrl: lmBaseUrl,
    });

    const success: ReingestSuccess = {
      status: 'started',
      operation: 'reembed',
      runId,
      sourceId: normalizedSourceId,
    };
    logValidationResult(appendLog, {
      kind: 'success',
      sourceId: normalizedSourceId,
      runId,
    });
    return { ok: true, value: success };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === 'BUSY') {
      const err = busyError(retryLists);
      logValidationResult(appendLog, { kind: 'error', error: err });
      return { ok: false, error: err };
    }

    if (code === 'NOT_FOUND') {
      const err = notFoundError(retryLists);
      logValidationResult(appendLog, { kind: 'error', error: err });
      return { ok: false, error: err };
    }

    throw error;
  }
}
