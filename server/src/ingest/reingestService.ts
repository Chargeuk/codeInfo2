import path from 'path';
import {
  listIngestedRepositories,
  type ListReposResult,
  type RepoEntry,
} from '../lmstudio/toolService.js';
import { append } from '../logStore.js';
import { InvalidLockMetadataError } from './chromaClient.js';
import {
  pumpIngestQueue,
  QUEUE_READ_FAILED_WAIT_REASON,
  type WaitForQueueRequestTerminalStatusOptions,
  type WaitForQueueRequestTerminalStatusResult,
  waitForQueueRequestTerminalStatus,
} from './ingestJob.js';
import { resolveMountedIngestPath } from './pathMap.js';
import {
  OpenAiEmbeddingError,
  isOpenAiAllowlistedEmbeddingModel,
} from './providers/index.js';
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
const QUEUE_WAIT_READ_FAILURE_MESSAGE =
  'Mongo-backed ingest queue is unavailable while waiting for re-ingest completion';
export const REINGEST_QUEUE_WAIT_SAFETY_TIMEOUT_MS = 24 * 60 * 60 * 1000;

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
  queueFailureStage?: 'wait';
  waitReason?: typeof QUEUE_READ_FAILED_WAIT_REASON;
};

type QueueCleanupBlockedData = ReingestRetryLists & {
  tool: typeof TOOL_NAME;
  code: 'QUEUE_CLEANUP_BLOCKED';
  retryable: true;
  retryMessage: string;
  fieldErrors: ValidationFieldError[];
  sourceId: string;
  runId: string | null;
};

type OpenAiModelUnavailableData = ReingestRetryLists & {
  tool: typeof TOOL_NAME;
  code: 'OPENAI_MODEL_UNAVAILABLE';
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
    }
  | {
      code: 503;
      message: 'QUEUE_CLEANUP_BLOCKED';
      data: QueueCleanupBlockedData;
    }
  | {
      code: 409;
      message: 'OPENAI_MODEL_UNAVAILABLE';
      data: OpenAiModelUnavailableData;
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

function emptyRetryLists(): ReingestRetryLists {
  return {
    reingestableRepositoryIds: [],
    reingestableSourceIds: [],
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
  options?: {
    queueFailureStage?: 'wait';
    waitReason?: typeof QUEUE_READ_FAILED_WAIT_REASON;
  },
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
      ...(options?.queueFailureStage
        ? { queueFailureStage: options.queueFailureStage }
        : {}),
      ...(options?.waitReason ? { waitReason: options.waitReason } : {}),
      ...retryLists,
    },
  };
}

function getQueueUnavailableMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return 'Mongo-backed ingest queue is unavailable while Mongo is disconnected';
}

function queueCleanupBlockedError(params: {
  retryLists: ReingestRetryLists;
  sourceId: string;
  runId: string | null;
  message: string;
}): ReingestError {
  return {
    code: 503,
    message: 'QUEUE_CLEANUP_BLOCKED',
    data: {
      ...params.retryLists,
      tool: TOOL_NAME,
      code: 'QUEUE_CLEANUP_BLOCKED',
      retryable: true,
      retryMessage: RETRY_MESSAGE,
      sourceId: params.sourceId,
      runId: params.runId,
      fieldErrors: [
        {
          field: 'sourceId',
          reason: 'invalid_state',
          message: params.message,
        },
      ],
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

function openAiModelUnavailableError(
  retryLists: ReingestRetryLists,
  message: string,
): ReingestError {
  return {
    code: 409,
    message: 'OPENAI_MODEL_UNAVAILABLE',
    data: {
      tool: TOOL_NAME,
      code: 'OPENAI_MODEL_UNAVAILABLE',
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

function normalizeRepoEmbeddingProvider(value: unknown) {
  return value === 'lmstudio' || value === 'openai' ? value : null;
}

function normalizeRepoEmbeddingModel(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveQueuedReingestSelection(repo: RepoEntry) {
  const canonicalProvider = normalizeRepoEmbeddingProvider(
    repo.embeddingProvider,
  );
  const canonicalModel = normalizeRepoEmbeddingModel(repo.embeddingModel);
  const lockProvider = normalizeRepoEmbeddingProvider(
    repo.lock?.embeddingProvider,
  );
  const lockModel = normalizeRepoEmbeddingModel(repo.lock?.embeddingModel);

  if (canonicalProvider === 'openai' && canonicalModel === null) {
    throw new InvalidLockMetadataError(
      'Canonical OpenAI re-embed metadata is partially populated',
    );
  }

  const provider = lockProvider ?? canonicalProvider ?? repo.embeddingProvider;
  const embeddingModel =
    lockModel ??
    canonicalModel ??
    repo.lock?.embeddingModel ??
    repo.embeddingModel;

  if (provider === 'openai') {
    if (
      typeof embeddingModel !== 'string' ||
      embeddingModel.trim().length === 0
    ) {
      throw new InvalidLockMetadataError(
        'OpenAI re-embed metadata is partially populated',
      );
    }
    if (!isOpenAiAllowlistedEmbeddingModel(embeddingModel)) {
      throw new OpenAiEmbeddingError(
        'OPENAI_MODEL_UNAVAILABLE',
        'Requested OpenAI embedding model is unavailable for this deployment',
        false,
        404,
      );
    }
  }

  return {
    provider,
    embeddingModel:
      typeof embeddingModel === 'string'
        ? embeddingModel
        : String(embeddingModel ?? ''),
  };
}

export function assertRepoCanAdmitQueuedReingest(repo: RepoEntry) {
  assertRepoCanQueueReingest(repo);
  resolveQueuedReingestSelection(repo);
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
  assertRepoCanAdmitQueuedReingest(repo);
  const { provider, embeddingModel } = resolveQueuedReingestSelection(repo);
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
  const WAIT_TIMEOUT_MS =
    deps.waitOptions?.timeoutMs ?? REINGEST_QUEUE_WAIT_SAFETY_TIMEOUT_MS;
  const listRepos = deps.listIngestedRepositories ?? listIngestedRepositories;
  const appendLog = deps.appendLog ?? append;
  const enqueueRequest =
    deps.enqueueOrReuseIngestRequest ?? enqueueOrReuseIngestRequest;
  const pumpQueue = deps.pumpIngestQueue ?? pumpIngestQueue;
  const waitForQueueTerminal =
    deps.waitForQueueRequestTerminalStatus ?? waitForQueueRequestTerminalStatus;

  const sourceId = isRecord(args) ? args.sourceId : undefined;
  logValidationEvaluated(appendLog, sourceId);
  const validationRetryLists = emptyRetryLists();

  const unsupportedArgKeys = findUnsupportedArgKeys(args);
  if (unsupportedArgKeys.length > 0) {
    const err = invalidStateError(
      `Unsupported arguments for reingest_repository: ${unsupportedArgKeys.join(', ')}`,
      validationRetryLists,
    );
    logValidationResult(appendLog, { kind: 'error', error: err });
    return { ok: false, error: err };
  }

  const validatedSourceId = validateExactReingestSourceId(sourceId);
  if (!validatedSourceId.ok) {
    const validationError = invalidParamsError(
      validatedSourceId.reason,
      validatedSourceId.message,
      validationRetryLists,
    );
    logValidationResult(appendLog, { kind: 'error', error: validationError });
    return { ok: false, error: validationError };
  }

  const repos = await listRepos();
  const retryLists = buildRetryLists(repos);
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
      const err = queueUnavailableError(
        retryLists,
        QUEUE_WAIT_READ_FAILURE_MESSAGE,
        {
          queueFailureStage: 'wait',
          waitReason: QUEUE_READ_FAILED_WAIT_REASON,
        },
      );
      appendLog({
        level: 'info',
        source: 'server',
        timestamp: new Date().toISOString(),
        message: `[DEV-0000038][T4] REINGEST_TERMINAL_RESULT status=error requestId=${queueRequest.requestId} runId=${waitResult.runId ?? queueRunId ?? 'unknown-run'} errorCode=QUEUE_UNAVAILABLE`,
        context: {
          status: 'error',
          requestId: queueRequest.requestId,
          runId: waitResult.runId ?? queueRunId ?? null,
          errorCode: 'QUEUE_UNAVAILABLE',
          waitReason: QUEUE_READ_FAILED_WAIT_REASON,
        },
      });
      logValidationResult(appendLog, { kind: 'error', error: err });
      return { ok: false, error: err };
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

    if (errorCode === 'QUEUE_CLEANUP_BLOCKED') {
      const runId = waitResult.runId ?? queueRunId ?? null;
      const err = queueCleanupBlockedError({
        retryLists,
        sourceId: normalizedSourceId,
        runId,
        message:
          waitResult.status?.lastError ??
          'Queued re-embed finished, but queue cleanup is blocked',
      });
      appendLog({
        level: 'info',
        source: 'server',
        timestamp: new Date().toISOString(),
        message: `[DEV-0000038][T4] REINGEST_TERMINAL_RESULT status=error requestId=${queueRequest.requestId} runId=${runId ?? 'unknown-run'} errorCode=QUEUE_CLEANUP_BLOCKED`,
        context: {
          status: 'error',
          requestId: queueRequest.requestId,
          runId,
          errorCode: 'QUEUE_CLEANUP_BLOCKED',
        },
      });
      logValidationResult(appendLog, { kind: 'error', error: err });
      return { ok: false, error: err };
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

    if (code === 'OPENAI_MODEL_UNAVAILABLE') {
      const err = openAiModelUnavailableError(
        retryLists,
        getQueueUnavailableMessage(error),
      );
      logValidationResult(appendLog, { kind: 'error', error: err });
      return { ok: false, error: err };
    }

    if (code === 'QUEUE_UNAVAILABLE') {
      const err = queueUnavailableError(
        retryLists,
        getQueueUnavailableMessage(error),
      );
      logValidationResult(appendLog, { kind: 'error', error: err });
      return { ok: false, error: err };
    }

    throw error;
  }
}
