import path from 'path';
import {
  listIngestedRepositories,
  type ListReposResult,
  type RepoEntry,
} from '../lmstudio/toolService.js';
import { append } from '../logStore.js';
import {
  pumpIngestQueue,
  QUEUE_READ_FAILED_WAIT_REASON,
  type WaitForQueueRequestTerminalStatusOptions,
  type WaitForQueueRequestTerminalStatusResult,
  waitForQueueRequestTerminalStatus,
} from './ingestJob.js';
import { resolveMountedIngestPath } from './pathMap.js';
import {
  assertReembedRootStateAllowed,
  normalizeCanonicalQueueTargetPath,
  splitQueuedIngestExecutionPath,
} from './requestContracts.js';
import {
  enqueueOrReuseIngestRequest,
  type EnqueueIngestRequestResult,
} from './requestQueue.js';

const TOOL_NAME = 'reingest_repository';
const RETRY_MESSAGE =
  'The AI can retry using one of the provided re-ingestable repository ids/sourceIds.';
const QUEUE_READ_FAILED_ERROR_CODE = 'QUEUE_READ_FAILED';

type ValidationReason =
  | 'missing'
  | 'non_string'
  | 'empty'
  | 'non_absolute'
  | 'non_normalized'
  | 'ambiguous_path'
  | 'unknown_root'
  | 'busy'
  | 'invalid_state';

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

type QueueUnavailableData = ReingestRetryLists & {
  tool: typeof TOOL_NAME;
  code: 'QUEUE_UNAVAILABLE';
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
      code: 503;
      message: 'QUEUE_UNAVAILABLE';
      data: QueueUnavailableData;
    };

type ReingestTerminalStatus = 'completed' | 'cancelled' | 'error';

export type ReingestSuccess = {
  status: ReingestTerminalStatus;
  operation: 'reembed';
  runId: string;
  sourceId: string;
  resolvedRepositoryId: string | null;
  completionMode: 'reingested' | 'skipped' | null;
  durationMs: number;
  files: number;
  chunks: number;
  embedded: number;
  errorCode: string | null;
};

export type ReingestResult =
  | { ok: true; value: ReingestSuccess }
  | { ok: false; error: ReingestError };

export type ReingestServiceDeps = {
  listIngestedRepositories?: () => Promise<ListReposResult>;
  enqueueOrReuseIngestRequest?: (
    input: Parameters<typeof enqueueOrReuseIngestRequest>[0],
  ) => Promise<EnqueueIngestRequestResult>;
  appendLog?: (entry: Parameters<typeof append>[0]) => unknown;
  pumpIngestQueue?: typeof pumpIngestQueue;
  waitForQueueRequestTerminalStatus?: (
    requestId: string,
    options: WaitForQueueRequestTerminalStatusOptions,
  ) => Promise<WaitForQueueRequestTerminalStatusResult>;
  waitOptions?: Partial<WaitForQueueRequestTerminalStatusOptions>;
};

export function isRepoReingestable(repo: RepoEntry): boolean {
  return (
    typeof repo.lastIngestAt === 'string' && repo.lastIngestAt.trim().length > 0
  );
}

function buildRetryLists(repos: ListReposResult): ReingestRetryLists {
  const repositoryIds = new Set<string>();
  const sourceIds = new Set<string>();

  repos.repos.forEach((repo) => {
    if (!isRepoReingestable(repo)) {
      return;
    }
    if (repo.id) repositoryIds.add(repo.id);
    if (repo.containerPath) {
      sourceIds.add(normalizeCanonicalQueueTargetPath(repo.containerPath));
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

function queueUnavailableError(
  retryLists: ReingestRetryLists,
  message: string,
): ReingestError {
  return {
    code: 503,
    message: 'QUEUE_UNAVAILABLE',
    data: {
      tool: TOOL_NAME,
      code: 'QUEUE_UNAVAILABLE',
      retryable: true,
      retryMessage: RETRY_MESSAGE,
      fieldErrors: [
        {
          field: 'sourceId',
          reason: 'invalid_state',
          message,
        },
      ],
      ...retryLists,
    },
  };
}

function invalidStateError(
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
          reason: 'invalid_state',
          message,
        },
      ],
      ...retryLists,
    },
  };
}

export function assertRepoCanQueueReingest(repo: RepoEntry) {
  assertReembedRootStateAllowed(repo.status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function validateExactReingestSourceId(sourceId: unknown):
  | { ok: true; sourceId: string }
  | {
      ok: false;
      reason: ValidationReason;
      message: string;
    } {
  if (sourceId === undefined) {
    return {
      ok: false,
      reason: 'missing',
      message: 'sourceId is required',
    };
  }

  if (typeof sourceId !== 'string') {
    return {
      ok: false,
      reason: 'non_string',
      message: 'sourceId must be a string',
    };
  }

  if (!sourceId.trim()) {
    return {
      ok: false,
      reason: 'empty',
      message: 'sourceId must be a non-empty string',
    };
  }

  const hasForwardSlash = sourceId.includes('/');
  const hasBackslash = sourceId.includes('\\');
  if (hasForwardSlash && hasBackslash) {
    return {
      ok: false,
      reason: 'ambiguous_path',
      message: 'sourceId must not mix slash styles',
    };
  }

  if (sourceId.length > 1 && sourceId.endsWith('/')) {
    return {
      ok: false,
      reason: 'ambiguous_path',
      message: 'sourceId must not include a trailing slash variant',
    };
  }

  if (/\/(\.\.?)(\/|$)/.test(sourceId)) {
    return {
      ok: false,
      reason: 'ambiguous_path',
      message: 'sourceId must not include dot-segment path traversal forms',
    };
  }

  if (!path.posix.isAbsolute(sourceId)) {
    return {
      ok: false,
      reason: 'non_absolute',
      message: 'sourceId must be an absolute normalized container path',
    };
  }

  if (hasBackslash) {
    return {
      ok: false,
      reason: 'non_normalized',
      message: 'sourceId must be an absolute normalized container path',
    };
  }

  const normalized = normalizeCanonicalQueueTargetPath(sourceId);
  if (normalized !== sourceId) {
    return {
      ok: false,
      reason: 'non_normalized',
      message: 'sourceId must be an absolute normalized container path',
    };
  }

  return { ok: true, sourceId };
}

export function findReingestableRepoByExactSourceId(
  repos: ListReposResult,
  sourceId: string,
): RepoEntry | null {
  return (
    repos.repos.find(
      (repo) => isRepoReingestable(repo) && repo.containerPath === sourceId,
    ) ?? null
  );
}

function findUnsupportedArgKeys(args: unknown) {
  if (!isRecord(args)) return [];
  return Object.keys(args).filter((key) => key !== 'sourceId');
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

function logNormalizedResult(
  appendLog: (entry: Parameters<typeof append>[0]) => unknown,
  result: ReingestSuccess,
) {
  appendLog({
    level: 'info',
    source: 'server',
    timestamp: new Date().toISOString(),
    message: 'DEV-0000050:T02:reingest_strict_result_normalized',
    context: {
      sourceId: result.sourceId,
      resolvedRepositoryId: result.resolvedRepositoryId,
      status: result.status,
      completionMode: result.completionMode,
    },
  });
}

export function buildQueuedReingestRequest(
  repo: RepoEntry,
): Parameters<typeof enqueueOrReuseIngestRequest>[0] {
  assertRepoCanQueueReingest(repo);
  const provider = repo.lock?.embeddingProvider ?? repo.embeddingProvider;
  const embeddingModel = repo.lock?.embeddingModel ?? repo.embeddingModel;
  const model =
    provider === 'openai' ? `${provider}/${embeddingModel}` : embeddingModel;
  const requestPaths = splitQueuedIngestExecutionPath({
    canonicalTargetPath: repo.containerPath,
    mountedPath: resolveMountedIngestPath({
      containerPath: repo.containerPath,
      hostPath: repo.hostPath,
    }),
  });
  const stableName =
    typeof repo.name === 'string' && repo.name.trim().length > 0
      ? repo.name.trim()
      : path.posix.basename(requestPaths.canonicalTargetPath) || 'repo';

  return {
    canonicalTargetPath: requestPaths.canonicalTargetPath,
    operation: 'reembed',
    sourceSurface: 'reingest_repository',
    requestPayload: {
      path: requestPaths.requestPayloadPath,
      name: stableName,
      ...(repo.description ? { description: repo.description } : {}),
      model,
      embeddingProvider: provider,
      embeddingModel,
    },
  };
}

export async function runReingestRepository(
  args: unknown,
  deps: ReingestServiceDeps = {},
): Promise<ReingestResult> {
  const WAIT_TIMEOUT_MS = deps.waitOptions?.timeoutMs ?? 90_000;
  const listRepos = deps.listIngestedRepositories ?? listIngestedRepositories;
  const appendLog = deps.appendLog ?? append;
  const enqueueRequest =
    deps.enqueueOrReuseIngestRequest ?? enqueueOrReuseIngestRequest;
  const pumpQueue = deps.pumpIngestQueue ?? pumpIngestQueue;
  const waitForQueueTerminal =
    deps.waitForQueueRequestTerminalStatus ?? waitForQueueRequestTerminalStatus;

  const sourceId = isRecord(args) ? args.sourceId : undefined;
  logValidationEvaluated(appendLog, sourceId);

  const repos = await listRepos();
  const retryLists = buildRetryLists(repos);

  const unsupportedArgKeys = findUnsupportedArgKeys(args);
  if (unsupportedArgKeys.length > 0) {
    const err = invalidStateError(
      `Unsupported arguments for reingest_repository: ${unsupportedArgKeys.join(', ')}`,
      retryLists,
    );
    logValidationResult(appendLog, { kind: 'error', error: err });
    return { ok: false, error: err };
  }

  const validatedSourceId = validateExactReingestSourceId(sourceId);
  const validationError = validatedSourceId.ok
    ? null
    : invalidParamsError(
        validatedSourceId.reason,
        validatedSourceId.message,
        retryLists,
      );
  if (validationError) {
    logValidationResult(appendLog, { kind: 'error', error: validationError });
    return { ok: false, error: validationError };
  }

  const normalizedSourceId = validatedSourceId.sourceId;
  const knownRoots = new Set(retryLists.reingestableSourceIds);
  if (!knownRoots.has(normalizedSourceId)) {
    const err = notFoundError(retryLists);
    logValidationResult(appendLog, { kind: 'error', error: err });
    return { ok: false, error: err };
  }

  const selectedRepo = findReingestableRepoByExactSourceId(
    repos,
    normalizedSourceId,
  );
  if (!selectedRepo) {
    const err = notFoundError(retryLists);
    logValidationResult(appendLog, { kind: 'error', error: err });
    return { ok: false, error: err };
  }

  try {
    const requestStartedAt = Date.now();
    const queueRequest = await enqueueRequest(
      buildQueuedReingestRequest(selectedRepo),
    );
    const pumpResult = await pumpQueue();
    const queueRunId =
      queueRequest.runId ??
      (pumpResult.requestId === queueRequest.requestId
        ? pumpResult.runId
        : null);

    appendLog({
      level: 'info',
      source: 'server',
      timestamp: new Date().toISOString(),
      message: `[DEV-0000038][T4] REINGEST_BLOCKING_WAIT_STARTED sourceId=${normalizedSourceId} requestId=${queueRequest.requestId} runId=${queueRunId ?? 'pending'}`,
      context: {
        sourceId: normalizedSourceId,
        requestId: queueRequest.requestId,
        runId: queueRunId,
      },
    });

    const waitResult = await waitForQueueTerminal(queueRequest.requestId, {
      timeoutMs: WAIT_TIMEOUT_MS,
    });

    const lastKnownCounts = waitResult.lastKnown?.counts ?? {
      files: 0,
      chunks: 0,
      embedded: 0,
    };

    let terminalStatus: ReingestTerminalStatus = 'error';
    let completionMode: ReingestSuccess['completionMode'] = null;
    let errorCode: string | null = null;
    if (waitResult.reason === 'timeout') {
      terminalStatus = 'error';
      errorCode = 'WAIT_TIMEOUT';
    } else if (waitResult.reason === QUEUE_READ_FAILED_WAIT_REASON) {
      terminalStatus = 'error';
      errorCode = QUEUE_READ_FAILED_ERROR_CODE;
    } else if (waitResult.status?.state === 'cancelled') {
      terminalStatus = 'cancelled';
    } else if (waitResult.status?.state === 'completed') {
      terminalStatus = 'completed';
      completionMode = 'reingested';
    } else if (waitResult.status?.state === 'skipped') {
      terminalStatus = 'completed';
      completionMode = 'skipped';
    } else if (waitResult.status?.state === 'cleanup-blocked') {
      terminalStatus = 'error';
      errorCode = 'QUEUE_CLEANUP_BLOCKED';
    } else if (waitResult.status?.state === 'error') {
      terminalStatus = 'error';
      errorCode = waitResult.status.error?.error ?? 'INGEST_ERROR';
    } else {
      terminalStatus = 'error';
      errorCode = 'UNKNOWN_TERMINAL_STATE';
    }

    const success: ReingestSuccess = {
      status: terminalStatus,
      operation: 'reembed',
      runId: waitResult.runId ?? queueRunId ?? 'unknown-run',
      sourceId: normalizedSourceId,
      resolvedRepositoryId: selectedRepo?.id ?? null,
      completionMode,
      durationMs: Math.max(0, Date.now() - requestStartedAt),
      files: lastKnownCounts.files,
      chunks: lastKnownCounts.chunks,
      embedded: lastKnownCounts.embedded,
      errorCode,
    };
    appendLog({
      level: 'info',
      source: 'server',
      timestamp: new Date().toISOString(),
      message: `[DEV-0000038][T4] REINGEST_TERMINAL_RESULT status=${success.status} requestId=${queueRequest.requestId} runId=${success.runId} errorCode=${success.errorCode ?? 'null'}`,
      context: {
        status: success.status,
        requestId: queueRequest.requestId,
        runId: success.runId,
        errorCode: success.errorCode,
      },
    });
    logNormalizedResult(appendLog, success);
    logValidationResult(appendLog, {
      kind: 'success',
      sourceId: normalizedSourceId,
      runId: success.runId,
    });
    return { ok: true, value: success };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === 'NOT_FOUND') {
      const err = notFoundError(retryLists);
      logValidationResult(appendLog, { kind: 'error', error: err });
      return { ok: false, error: err };
    }

    if (
      code === 'INVALID_REEMBED_STATE' ||
      code === 'INVALID_LOCK_METADATA' ||
      code === 'MODEL_LOCKED'
    ) {
      const err = invalidStateError(
        'sourceId points to a repository that cannot be re-embedded in its current state',
        retryLists,
      );
      logValidationResult(appendLog, { kind: 'error', error: err });
      return { ok: false, error: err };
    }

    if (code === 'QUEUE_UNAVAILABLE') {
      const err = queueUnavailableError(
        retryLists,
        'Mongo-backed ingest queue is unavailable while Mongo is disconnected',
      );
      logValidationResult(appendLog, { kind: 'error', error: err });
      return { ok: false, error: err };
    }

    throw error;
  }
}
