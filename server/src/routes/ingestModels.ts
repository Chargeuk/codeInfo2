import type { LMStudioClient } from '@lmstudio/sdk';
import { Router } from 'express';
import {
  getLockedEmbeddingModel as getCanonicalLockedModel,
  type LockedEmbeddingModel,
} from '../ingest/chromaClient.js';
import {
  createOpenAiEmbeddingProvider,
  OpenAiEmbeddingError,
  OPENAI_EMBEDDING_MODEL_ALLOWLIST,
} from '../ingest/providers/index.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';
import { BASE_URL_REGEX, scrubBaseUrl, toWebSocketUrl } from './lmstudioUrl.js';

type ClientFactory = (baseUrl: string) => LMStudioClient;
type Deps = {
  clientFactory: ClientFactory;
  getLockedModel?: () => Promise<LockedEmbeddingModel | null>;
  openAiListModels?: () => Promise<Array<{ id: string }>>;
};

type IngestModelEntry = {
  id: string;
  displayName: string;
  provider: 'lmstudio' | 'openai';
};

type ProviderWarning = {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
};

type LmStudioEnvelope = {
  status: 'ok' | 'warning';
  statusCode:
    | 'LMSTUDIO_OK'
    | 'LMSTUDIO_MODELS_LIST_TEMPORARY_FAILURE'
    | 'LMSTUDIO_MODELS_LIST_UNAVAILABLE';
  warning?: ProviderWarning;
};

type OpenAiEnvelope = {
  enabled: boolean;
  status: 'disabled' | 'ok' | 'warning';
  statusCode:
    | 'OPENAI_DISABLED'
    | 'OPENAI_OK'
    | 'OPENAI_ALLOWLIST_NO_MATCH'
    | 'OPENAI_MODELS_LIST_TEMPORARY_FAILURE'
    | 'OPENAI_MODELS_LIST_AUTH_FAILED'
    | 'OPENAI_MODELS_LIST_UNAVAILABLE';
  warning?: ProviderWarning;
};

type LockEnvelope = {
  embeddingProvider: 'lmstudio' | 'openai';
  embeddingModel: string;
  embeddingDimensions: number;
};

const mapModel = (model: {
  modelKey?: string;
  displayName?: string;
  type?: string;
  capabilities?: string[];
}): IngestModelEntry => ({
  id: model.modelKey ?? model.displayName ?? 'unknown',
  displayName: model.displayName ?? model.modelKey ?? 'unknown',
  provider: 'lmstudio',
});

function logLockResolverState(
  requestId: string | undefined,
  surface: string,
  lock: LockEnvelope | null,
) {
  const lockedModelId = lock?.embeddingModel ?? null;
  append({
    level: 'info',
    message: 'DEV-0000036:T2:lock_resolver_source_selected',
    timestamp: new Date().toISOString(),
    source: 'server',
    requestId,
    context: {
      surface,
      source: 'canonical',
      lockedModelId,
    },
  });

  append({
    level: 'info',
    message: 'DEV-0000036:T2:lock_resolver_surface_parity',
    timestamp: new Date().toISOString(),
    source: 'server',
    requestId,
    context: {
      surface,
      embeddingProvider: lock?.embeddingProvider ?? null,
      embeddingModel: lock?.embeddingModel ?? null,
      embeddingDimensions: lock?.embeddingDimensions ?? null,
    },
  });

  baseLogger.info(
    {
      requestId,
      surface,
      source: 'canonical',
      lockedModelId,
      embeddingProvider: lock?.embeddingProvider ?? null,
      embeddingModel: lock?.embeddingModel ?? null,
      embeddingDimensions: lock?.embeddingDimensions ?? null,
    },
    'lock resolver parity baseline',
  );
}

function isOpenAiEnabled(env = process.env) {
  const key = env.OPENAI_EMBEDDING_KEY;
  return typeof key === 'string' && key.trim().length > 0;
}

function mapOpenAiListFailure(error: unknown): {
  statusCode: OpenAiEnvelope['statusCode'];
  warning: ProviderWarning;
} {
  if (error instanceof OpenAiEmbeddingError) {
    if (
      error.code === 'OPENAI_AUTH_FAILED' ||
      error.code === 'OPENAI_PERMISSION_DENIED'
    ) {
      return {
        statusCode: 'OPENAI_MODELS_LIST_AUTH_FAILED',
        warning: {
          code: 'OPENAI_MODELS_LIST_AUTH_FAILED',
          message:
            'OpenAI model listing failed authentication. Check OPENAI_EMBEDDING_KEY.',
          retryable: false,
        },
      };
    }
    if (
      error.code === 'OPENAI_RATE_LIMITED' ||
      error.code === 'OPENAI_TIMEOUT' ||
      error.code === 'OPENAI_CONNECTION_FAILED'
    ) {
      return {
        statusCode: 'OPENAI_MODELS_LIST_TEMPORARY_FAILURE',
        warning: {
          code: 'OPENAI_MODELS_LIST_TEMPORARY_FAILURE',
          message:
            'OpenAI model listing is temporarily unavailable. LM Studio models are still available.',
          retryable: true,
          ...(typeof error.retryAfterMs === 'number'
            ? { retryAfterMs: error.retryAfterMs }
            : {}),
        },
      };
    }
  }

  return {
    statusCode: 'OPENAI_MODELS_LIST_UNAVAILABLE',
    warning: {
      code: 'OPENAI_MODELS_LIST_UNAVAILABLE',
      message:
        'OpenAI model listing is unavailable. LM Studio models are still available.',
      retryable: false,
    },
  };
}

function mapLmStudioFailure(error: unknown): {
  statusCode: LmStudioEnvelope['statusCode'];
  warning: ProviderWarning;
} {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const retryable =
    normalized.includes('timeout') ||
    normalized.includes('temporar') ||
    normalized.includes('econn') ||
    normalized.includes('network');

  if (retryable) {
    return {
      statusCode: 'LMSTUDIO_MODELS_LIST_TEMPORARY_FAILURE',
      warning: {
        code: 'LMSTUDIO_MODELS_LIST_TEMPORARY_FAILURE',
        message:
          'LM Studio embedding models are temporarily unavailable. OpenAI models are still available.',
        retryable: true,
      },
    };
  }

  return {
    statusCode: 'LMSTUDIO_MODELS_LIST_UNAVAILABLE',
    warning: {
      code: 'LMSTUDIO_MODELS_LIST_UNAVAILABLE',
      message: 'LM Studio embedding models are unavailable.',
      retryable: false,
    },
  };
}

export function createIngestModelsRouter({
  clientFactory,
  getLockedModel: getLockedModelResolver = getCanonicalLockedModel,
  openAiListModels,
}: Deps) {
  const router = Router();
  router.get('/ingest/models', async (_req, res) => {
    const requestId = res.locals.requestId as string | undefined;
    const baseUrl = process.env.LMSTUDIO_BASE_URL ?? '';
    const safeBase = scrubBaseUrl(baseUrl);

    append({
      level: 'info',
      message: 'ingest models fetch start',
      timestamp: new Date().toISOString(),
      source: 'server',
      requestId,
      context: { baseUrl: safeBase },
    });

    try {
      const lock = await getLockedModelResolver();
      const lockEnvelope: LockEnvelope | null = lock
        ? {
            embeddingProvider: lock.embeddingProvider,
            embeddingModel: lock.embeddingModel,
            embeddingDimensions: lock.embeddingDimensions,
          }
        : null;
      const lockedModelId = lockEnvelope?.embeddingModel ?? null;
      logLockResolverState(requestId, 'ingest/models', lockEnvelope);

      let lmstudio: LmStudioEnvelope = {
        status: 'ok',
        statusCode: 'LMSTUDIO_OK',
      };
      let lmStudioModels: IngestModelEntry[] = [];
      if (!BASE_URL_REGEX.test(baseUrl)) {
        const mapped = mapLmStudioFailure(
          new Error('LMSTUDIO_BASE_URL is invalid or missing'),
        );
        lmstudio = {
          status: 'warning',
          statusCode: mapped.statusCode,
          warning: mapped.warning,
        };
      } else {
        try {
          const client = clientFactory(toWebSocketUrl(baseUrl));
          const models = await client.system.listDownloadedModels();
          const embedding = models.filter((m) => {
            const type = (m.type ?? '').toLowerCase();
            const caps = Array.isArray(
              (m as { capabilities?: string[] }).capabilities,
            )
              ? ((m as { capabilities?: string[] }).capabilities as string[])
              : [];
            return type === 'embedding' || caps.includes('embedding');
          });
          lmStudioModels = embedding.map(mapModel);
        } catch (error) {
          const mapped = mapLmStudioFailure(error);
          lmstudio = {
            status: 'warning',
            statusCode: mapped.statusCode,
            warning: mapped.warning,
          };
        }
      }

      const openAiEnabled = isOpenAiEnabled(process.env);
      let openai: OpenAiEnvelope;
      let openAiModels: IngestModelEntry[] = [];
      if (!openAiEnabled) {
        openai = {
          enabled: false,
          status: 'disabled',
          statusCode: 'OPENAI_DISABLED',
        };
      } else {
        try {
          const listed = openAiListModels
            ? await openAiListModels()
            : await createOpenAiEmbeddingProvider({
                apiKey: process.env.OPENAI_EMBEDDING_KEY,
              }).listModels();
          const available = new Set(
            listed
              .map((entry) => entry.id)
              .filter((id): id is string => typeof id === 'string'),
          );
          openAiModels = OPENAI_EMBEDDING_MODEL_ALLOWLIST.filter((id) =>
            available.has(id),
          ).map((id) => ({
            id,
            displayName: id,
            provider: 'openai' as const,
          }));
          if (openAiModels.length === 0) {
            openai = {
              enabled: true,
              status: 'warning',
              statusCode: 'OPENAI_ALLOWLIST_NO_MATCH',
              warning: {
                code: 'OPENAI_ALLOWLIST_NO_MATCH',
                message:
                  'OpenAI is configured, but no supported embedding models are available for this key.',
                retryable: false,
              },
            };
          } else {
            openai = {
              enabled: true,
              status: 'ok',
              statusCode: 'OPENAI_OK',
            };
          }
        } catch (error) {
          const mapped = mapOpenAiListFailure(error);
          openai = {
            enabled: true,
            status: 'warning',
            statusCode: mapped.statusCode,
            warning: mapped.warning,
          };
        }
      }

      const models = [...lmStudioModels, ...openAiModels];

      append({
        level: 'info',
        message: 'DEV-0000036:T8:ingest_models_response_summary',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: {
          lmstudioModelCount: lmStudioModels.length,
          openaiModelCount: openAiModels.length,
          totalModelCount: models.length,
          openaiStatusCode: openai.statusCode,
          lmstudioStatusCode: lmstudio.statusCode,
          defaultModelId: lockedModelId ?? models[0]?.id ?? null,
        },
      });

      if (openai.status === 'warning') {
        append({
          level: 'info',
          message: 'DEV-0000036:T8:ingest_models_warning_status',
          timestamp: new Date().toISOString(),
          source: 'server',
          requestId,
          context: {
            openaiStatusCode: openai.statusCode,
            retryable: openai.warning?.retryable ?? false,
          },
        });
      }

      append({
        level: 'info',
        message: 'ingest models fetch success',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: { baseUrl: safeBase, models: models.length },
      });
      baseLogger.info(
        { requestId, baseUrl: safeBase, models: models.length },
        'ingest models fetch success',
      );

      res.json({
        models,
        lock: lockEnvelope,
        lockedModelId,
        openai,
        lmstudio,
      });
    } catch (err) {
      const error = (err as Error).message ?? 'lmstudio unavailable';
      append({
        level: 'error',
        message: 'ingest models fetch failed',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: { baseUrl: safeBase, error },
      });
      baseLogger.error(
        { requestId, baseUrl: safeBase, error },
        'ingest models fetch failed',
      );
      res.status(500).json({ status: 'error', message: error });
    }
  });

  return router;
}
