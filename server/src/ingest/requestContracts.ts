import path from 'path';
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

export type QueuedIngestRequestPaths = {
  canonicalTargetPath: string;
  requestPayloadPath: string;
};

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

  const rawAllowedRoot =
    options?.allowedRoot?.trim() ?? process.env.CODEINFO_CODEX_WORKDIR?.trim();
  if (
    !rawAllowedRoot ||
    rawAllowedRoot.includes('$') ||
    !path.posix.isAbsolute(normalizeCanonicalQueueTargetPath(rawAllowedRoot))
  ) {
    return canonicalPath;
  }

  const canonicalAllowedRoot =
    normalizeCanonicalQueueTargetPath(rawAllowedRoot);
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
