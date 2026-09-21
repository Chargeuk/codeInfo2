import path from 'path';
import { getScopedEnvValue } from '../test/support/testEnvOverrideScope.js';
import {
  isOpenAiAllowlistedEmbeddingModel,
  resolveEmbeddingModelSelection,
  type ResolvedEmbeddingModelSelection,
} from './providers/index.js';

export type CanonicalEmbeddingRequestFields = {
  embeddingProvider?: unknown;
  embeddingModel?: unknown;
  model?: unknown;
};

export type StartIngestRequestBody = CanonicalEmbeddingRequestFields & {
  path: string;
  name: string;
  description?: string;
  dryRun?: boolean;
};

export type QueuedIngestRequestPaths = {
  canonicalTargetPath: string;
  requestPayloadPath: string;
};

const CODEX_WORKDIR_PLACEHOLDER = '$CODEINFO_CODEX_WORKDIR';

function createValidationError(message: string, code = 'VALIDATION') {
  const error = new Error(message);
  (error as { code?: string }).code = code;
  return error;
}

export function splitQueuedIngestExecutionPath(params: {
  canonicalTargetPath: string;
  mountedPath?: unknown;
}): QueuedIngestRequestPaths {
  const canonical = normalizeCanonicalQueueTargetPath(
    params.canonicalTargetPath,
  );
  const mounted =
    typeof params.mountedPath === 'string' && params.mountedPath.length > 0
      ? params.mountedPath
      : canonical;

  return {
    canonicalTargetPath: canonical,
    requestPayloadPath: mounted,
  };
}

export type ResolvedRequestEmbeddingSelection = {
  selection: ResolvedEmbeddingModelSelection;
  requestedModelId: string;
  canonicalProvided: boolean;
};

export type RequestContractValidationError = {
  status: number;
  code: string;
  message: string;
};

const startIngestBodyFields = new Set([
  'path',
  'name',
  'description',
  'dryRun',
  'model',
  'embeddingProvider',
  'embeddingModel',
]);

export function validateStartIngestRequestName(
  rawName: unknown,
): string | RequestContractValidationError {
  if (typeof rawName !== 'string') {
    return {
      status: 400,
      code: 'VALIDATION',
      message: 'name must be a string',
    };
  }

  if (rawName.length === 0) {
    return {
      status: 400,
      code: 'VALIDATION',
      message: 'path and name are required',
    };
  }

  return rawName;
}

export function createInvalidReembedStateError() {
  const error = new Error('INVALID_REEMBED_STATE');
  (error as { code?: string }).code = 'INVALID_REEMBED_STATE';
  return error;
}

export function assertReembedRootStateAllowed(rootState: unknown) {
  const normalized =
    typeof rootState === 'string' ? rootState.trim().toLowerCase() : null;
  if (normalized === 'cancelled' || normalized === 'error') {
    throw createInvalidReembedStateError();
  }
}

export function normalizeCanonicalQueueTargetPath(rawPath: string): string {
  const normalized = path.posix.normalize(rawPath.replace(/\\/g, '/').trim());
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

export function validateExactDestructiveRootPath(
  rawPath: unknown,
  fieldName = 'root',
): string {
  return validateQueueableRepositoryRootPath(rawPath, {
    fieldName,
    allowedRoot: null,
  });
}

export function validateQueueableRepositoryRootPath(
  rawPath: unknown,
  options?: {
    fieldName?: string;
    allowedRoot?: string | null;
  },
): string {
  const fieldName = options?.fieldName ?? 'path';
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    throw createValidationError(`${fieldName} is required`);
  }

  const trimmedPath = rawPath.trim();
  const hasForwardSlash = trimmedPath.includes('/');
  const hasBackslash = trimmedPath.includes('\\');
  if (hasForwardSlash && hasBackslash) {
    throw createValidationError(
      `${fieldName} must be an absolute normalized repository root path`,
    );
  }

  if (trimmedPath.length > 1 && trimmedPath.endsWith('/')) {
    throw createValidationError(
      `${fieldName} must be an absolute normalized repository root path`,
    );
  }

  if (/\/(\.\.?)(\/|$)/.test(trimmedPath)) {
    throw createValidationError(
      `${fieldName} must be an absolute normalized repository root path`,
    );
  }

  if (hasBackslash) {
    throw createValidationError(
      `${fieldName} must be an absolute normalized repository root path`,
    );
  }

  if (!path.posix.isAbsolute(trimmedPath)) {
    throw createValidationError(
      `${fieldName} must be an absolute normalized repository root path`,
    );
  }

  const canonicalPath = normalizeCanonicalQueueTargetPath(trimmedPath);
  if (canonicalPath !== trimmedPath) {
    throw createValidationError(
      `${fieldName} must be an absolute normalized repository root path`,
    );
  }

  const configuredAllowedRoot = resolveQueueableAllowedRoot(
    options && Object.prototype.hasOwnProperty.call(options, 'allowedRoot')
      ? options.allowedRoot
      : getScopedEnvValue('CODEINFO_CODEX_WORKDIR'),
  );
  if (!configuredAllowedRoot) {
    return canonicalPath;
  }

  const canonicalAllowedRoot = configuredAllowedRoot;
  const withinAllowedRoot =
    canonicalPath === canonicalAllowedRoot ||
    canonicalPath.startsWith(`${canonicalAllowedRoot}/`);
  if (!withinAllowedRoot) {
    throw createValidationError(
      `${fieldName} must stay within ${canonicalAllowedRoot}`,
    );
  }

  return canonicalPath;
}

function resolveQueueableAllowedRoot(
  rawAllowedRoot: string | null | undefined,
) {
  if (rawAllowedRoot === undefined || rawAllowedRoot === null) {
    return null;
  }

  if (rawAllowedRoot === CODEX_WORKDIR_PLACEHOLDER) {
    return null;
  }

  const trimmedAllowedRoot = rawAllowedRoot.trim();
  if (!trimmedAllowedRoot) {
    throw createValidationError(
      'CODEINFO_CODEX_WORKDIR must not be blank',
      'CONFIGURATION',
    );
  }

  if (trimmedAllowedRoot === CODEX_WORKDIR_PLACEHOLDER) {
    return null;
  }

  const hasForwardSlash = trimmedAllowedRoot.includes('/');
  const hasBackslash = trimmedAllowedRoot.includes('\\');
  if (
    hasBackslash ||
    (hasForwardSlash && hasBackslash) ||
    (trimmedAllowedRoot.length > 1 && trimmedAllowedRoot.endsWith('/')) ||
    /\/(\.\.?)(\/|$)/.test(trimmedAllowedRoot)
  ) {
    throw createValidationError(
      `CODEINFO_CODEX_WORKDIR must be an absolute normalized repository root path or the exact placeholder "${CODEX_WORKDIR_PLACEHOLDER}"`,
      'CONFIGURATION',
    );
  }

  const canonicalAllowedRoot =
    normalizeCanonicalQueueTargetPath(trimmedAllowedRoot);
  if (
    trimmedAllowedRoot.includes('$') ||
    !path.posix.isAbsolute(trimmedAllowedRoot) ||
    canonicalAllowedRoot !== trimmedAllowedRoot
  ) {
    throw createValidationError(
      `CODEINFO_CODEX_WORKDIR must be an absolute normalized repository root path or the exact placeholder "${CODEX_WORKDIR_PLACEHOLDER}"`,
      'CONFIGURATION',
    );
  }

  return canonicalAllowedRoot;
}

export function validateStartIngestRequestBody(
  body: unknown,
): StartIngestRequestBody | RequestContractValidationError {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      status: 400,
      code: 'VALIDATION',
      message: 'request body must be an object',
    };
  }

  const record = body as Record<string, unknown>;
  const unexpectedField = Object.keys(record).find(
    (key) => !startIngestBodyFields.has(key),
  );
  if (unexpectedField) {
    return {
      status: 400,
      code: 'VALIDATION',
      message: `unexpected body field: ${unexpectedField}`,
    };
  }

  const hasName = Object.prototype.hasOwnProperty.call(record, 'name');
  if (!record.path || !hasName) {
    return {
      status: 400,
      code: 'VALIDATION',
      message: 'path and name are required',
    };
  }

  const validatedName = validateStartIngestRequestName(record.name);
  if (typeof validatedName !== 'string') {
    return validatedName;
  }

  if (
    record.description !== undefined &&
    typeof record.description !== 'string'
  ) {
    return {
      status: 400,
      code: 'VALIDATION',
      message: 'description must be a string',
    };
  }

  if (record.dryRun !== undefined && typeof record.dryRun !== 'boolean') {
    return {
      status: 400,
      code: 'VALIDATION',
      message: 'dryRun must be a boolean',
    };
  }

  return {
    ...(record as Omit<StartIngestRequestBody, 'name'>),
    name: validatedName,
  };
}

function normalizeProvider(
  provider: unknown,
): 'lmstudio' | 'openai' | undefined | null {
  if (provider === undefined) return undefined;
  if (typeof provider !== 'string') return null;
  const trimmed = provider.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === 'lmstudio' || trimmed === 'openai') return trimmed;
  return null;
}

export function resolveRequestEmbeddingSelection(
  body: CanonicalEmbeddingRequestFields,
): ResolvedRequestEmbeddingSelection | RequestContractValidationError {
  const provider = normalizeProvider(body.embeddingProvider);
  const embeddingModel =
    typeof body.embeddingModel === 'string' ? body.embeddingModel.trim() : '';
  const legacyModel = typeof body.model === 'string' ? body.model.trim() : '';
  const hasCanonicalInput =
    body.embeddingProvider !== undefined || body.embeddingModel !== undefined;

  if (hasCanonicalInput) {
    if (!provider || !embeddingModel) {
      return {
        status: 400,
        code: 'VALIDATION',
        message:
          'embeddingProvider and embeddingModel are required when canonical fields are present',
      };
    }
    if (
      provider === 'openai' &&
      !isOpenAiAllowlistedEmbeddingModel(embeddingModel)
    ) {
      return {
        status: 409,
        code: 'OPENAI_MODEL_UNAVAILABLE',
        message:
          'Requested OpenAI embedding model is unavailable for this deployment',
      };
    }
    return {
      selection: {
        providerId: provider,
        modelKey: embeddingModel,
      },
      requestedModelId:
        provider === 'openai' ? `openai/${embeddingModel}` : embeddingModel,
      canonicalProvided: true,
    };
  }

  if (!legacyModel) {
    return {
      status: 400,
      code: 'VALIDATION',
      message: 'model is required',
    };
  }

  const selection = resolveEmbeddingModelSelection(legacyModel);
  if (
    selection.providerId === 'openai' &&
    !isOpenAiAllowlistedEmbeddingModel(selection.modelKey)
  ) {
    return {
      status: 409,
      code: 'OPENAI_MODEL_UNAVAILABLE',
      message:
        'Requested OpenAI embedding model is unavailable for this deployment',
    };
  }
  return {
    selection,
    requestedModelId:
      selection.providerId === 'openai'
        ? `openai/${selection.modelKey}`
        : selection.modelKey,
    canonicalProvided: false,
  };
}
