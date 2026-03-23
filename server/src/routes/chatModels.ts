import { type ChatModelsResponse, type ChatModelInfo } from '@codeinfo2/common';
import type { ModelInfo } from '@github/copilot-sdk';
import type { LMStudioClient } from '@lmstudio/sdk';
import { Router } from 'express';
import { CopilotLifecycle } from '../chat/copilotLifecycle.js';
import {
  resolveCodexCapabilities,
  type CodexCapabilityResolution,
} from '../codex/capabilityResolver.js';
import {
  resolveChatDefaults,
  resolveCodexChatDefaults,
  STORY_47_TASK_1_LOG_MARKER,
  toChatResolutionSource,
} from '../config/chatDefaults.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';
import { getCodexDetection } from '../providers/codexRegistry.js';
import {
  resolveCopilotReadiness,
  type CopilotReadinessRuntime,
} from '../providers/copilotReadiness.js';
import { getMcpStatus } from '../providers/mcpStatus.js';

type ClientFactory = (baseUrl: string) => LMStudioClient;
const BASE_URL_REGEX = /^(https?|wss?):\/\//i;
const TASK12_LOG_SUCCESS =
  '[DEV-0000037][T12] event=chat_models_codex_capabilities_returned result=success';
const TASK12_LOG_ERROR =
  '[DEV-0000037][T12] event=chat_models_codex_capabilities_returned result=error';
const TASK7_LOG_MARKER = 'DEV_0000040_T07_REST_DEFAULTS_APPLIED';
export const TASK6_LOG_MARKER = 'story.0000051.task06.models_mapped';

const COPILOT_MODELS_REASON = 'copilot models unavailable';
const VERIFIED_COPILOT_MODEL_FIELDS = new Set([
  'id',
  'name',
  'supportedReasoningEfforts',
  'defaultReasoningEffort',
]);
const scrubBaseUrl = (value: string) => {
  try {
    return new URL(value).origin;
  } catch {
    return '[invalid-url]';
  }
};

const toWebSocketUrl = (value: string) => {
  if (value.startsWith('http://')) return value.replace(/^http:/i, 'ws:');
  if (value.startsWith('https://')) return value.replace(/^https:/i, 'wss:');
  return value;
};

const prioritizeModel = <T extends { key: string }>(
  models: T[],
  preferredModel: string | undefined,
): T[] => {
  if (!preferredModel) return models;
  const index = models.findIndex((model) => model.key === preferredModel);
  if (index <= 0) return models;
  const clone = [...models];
  const [preferred] = clone.splice(index, 1);
  clone.unshift(preferred);
  return clone;
};

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeReasoningEfforts = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  const normalized = value
    .map((entry) => normalizeString(entry))
    .filter((entry): entry is string => entry !== undefined);

  return [...new Set(normalized)];
};

const mapCopilotModels = (models: ModelInfo[]) => {
  let ignoredUnsupportedFields = false;

  const mapped = models.flatMap((model): ChatModelInfo[] => {
    const key = normalizeString(model.id);
    const displayName = normalizeString(model.name);

    if (!key || !displayName) {
      ignoredUnsupportedFields = true;
      return [];
    }

    const supportedReasoningEfforts = normalizeReasoningEfforts(
      model.supportedReasoningEfforts,
    );
    const defaultReasoningEffort = normalizeString(
      model.defaultReasoningEffort,
    );
    const mappedModel: ChatModelInfo = {
      key,
      displayName,
      type: 'copilot',
    };

    if (supportedReasoningEfforts.length > 0) {
      mappedModel.supportedReasoningEfforts = supportedReasoningEfforts;
      if (
        defaultReasoningEffort &&
        supportedReasoningEfforts.includes(defaultReasoningEffort)
      ) {
        mappedModel.defaultReasoningEffort = defaultReasoningEffort;
      } else if (defaultReasoningEffort) {
        ignoredUnsupportedFields = true;
      }
    } else if (defaultReasoningEffort) {
      ignoredUnsupportedFields = true;
    }

    const unsupportedKeys = Object.keys(model).filter(
      (field) => !VERIFIED_COPILOT_MODEL_FIELDS.has(field),
    );
    if (unsupportedKeys.length > 0) {
      ignoredUnsupportedFields = true;
    }

    return [mappedModel];
  });

  return { mapped, ignoredUnsupportedFields };
};

const logCopilotModelMapping = (params: {
  requestId?: string;
  mappedModelCount: number;
  ignoredUnsupportedFields: boolean;
  blockingStage: string;
}) => {
  const context = {
    requestId: params.requestId,
    provider: 'copilot',
    mappedModelCount: params.mappedModelCount,
    ignoredUnsupportedFields: params.ignoredUnsupportedFields,
    blockingStage: params.blockingStage,
  };

  append({
    level: 'info',
    message: TASK6_LOG_MARKER,
    timestamp: new Date().toISOString(),
    source: 'server',
    requestId: params.requestId,
    context,
  });
  baseLogger.info(context, TASK6_LOG_MARKER);
};

export function createChatModelsRouter({
  clientFactory,
  codexCapabilityResolver = resolveCodexCapabilities,
  copilotRuntimeFactory,
}: {
  clientFactory: ClientFactory;
  codexCapabilityResolver?: (options: {
    consumer: 'chat_models' | 'chat_validation';
  }) => Promise<CodexCapabilityResolution>;
  copilotRuntimeFactory?: () => CopilotReadinessRuntime;
}) {
  const router = Router();
  const isChatModel = (model: { type?: string; architecture?: string }) => {
    const kind = (model.type ?? '').toLowerCase();
    return kind !== 'embedding' && kind !== 'vector';
  };

  router.get('/models', async (req, res) => {
    const requestId = res.locals.requestId as string | undefined;
    const provider = (req.query.provider as string | undefined)?.toLowerCase();

    if (provider === 'codex') {
      const detection = getCodexDetection();
      const mcp = await getMcpStatus();
      const capabilities = await codexCapabilityResolver({
        consumer: 'chat_models',
      });
      const toolsAvailable = detection.available && mcp.available;
      const runtimeWarnings: string[] = [];

      if (capabilities.defaults.webSearchEnabled && !toolsAvailable) {
        runtimeWarnings.push(
          'Codex web search is enabled, but tools are unavailable; web search will be ignored.',
        );
      }

      const codexWarnings = [...capabilities.warnings, ...runtimeWarnings];
      const preferredDefaults = await resolveCodexChatDefaults({
        codexHome: process.env.CODEX_HOME,
      });
      const codexModels = prioritizeModel(
        capabilities.models.map((capability) => {
          return {
            key: capability.model,
            displayName: capability.model,
            type: 'codex',
            supportedReasoningEfforts: capability.supportedReasoningEfforts,
            defaultReasoningEffort: capability.defaultReasoningEffort,
          };
        }),
        preferredDefaults.values.model,
      );

      baseLogger.info(
        {
          modelCount: capabilities.models.length,
          fallbackUsed: capabilities.fallbackUsed,
          warningsCount: capabilities.warnings.length,
        },
        '[codex-model-list] using env list',
      );

      if (codexWarnings.length > 0) {
        baseLogger.warn(
          { requestId, warningsCount: codexWarnings.length, codexWarnings },
          'chat models codex warnings',
        );
      }

      const response: ChatModelsResponse = {
        provider: 'codex',
        available: detection.available,
        toolsAvailable,
        reason: detection.reason ?? (mcp.available ? undefined : mcp.reason),
        models: detection.available ? codexModels : [],
        codexDefaults: capabilities.defaults,
        codexWarnings,
      };
      console.info(STORY_47_TASK_1_LOG_MARKER, {
        surface: '/chat/models',
        requested_provider: 'codex',
        requested_model: preferredDefaults.values.model,
        resolved_model: preferredDefaults.values.model,
        model_source: toChatResolutionSource(preferredDefaults.sources.model),
        codex_model_source: preferredDefaults.sources.model,
        success: true,
        warning_count: codexWarnings.length,
      });
      console.info(TASK7_LOG_MARKER, {
        surface: '/chat/models',
        provider: 'codex',
        warningCount: codexWarnings.length,
        defaults: capabilities.defaults,
      });

      if (detection.available) {
        baseLogger.info(
          {
            requestId,
            modelCount: response.models.length,
            toolsAvailable: response.toolsAvailable,
          },
          TASK12_LOG_SUCCESS,
        );
      } else {
        baseLogger.error(
          {
            requestId,
            code: 'codex_unavailable',
            reason: response.reason,
            modelCount: response.models.length,
          },
          TASK12_LOG_ERROR,
        );
      }

      return res.json(response);
    }

    if (provider === 'copilot') {
      const mcp = await getMcpStatus();
      const readiness = await resolveCopilotReadiness({
        createRuntime: copilotRuntimeFactory,
        env: process.env,
        toolsAvailable: mcp.available,
        toolsReason: mcp.reason,
      });

      if (!readiness.available) {
        logCopilotModelMapping({
          requestId,
          mappedModelCount: 0,
          ignoredUnsupportedFields: false,
          blockingStage: readiness.blockingStage,
        });
        const response: ChatModelsResponse = {
          provider: 'copilot',
          available: false,
          toolsAvailable: false,
          reason: readiness.reason,
          models: [],
        };
        return res.json(response);
      }

      const preferredDefaults = resolveChatDefaults({});
      const preferredModel =
        preferredDefaults.provider === 'copilot'
          ? preferredDefaults.model
          : undefined;
      const runtime = copilotRuntimeFactory?.() ?? new CopilotLifecycle();
      let started = false;

      try {
        await runtime.start();
        started = true;

        const rawModels = await runtime.listModels();
        const { mapped, ignoredUnsupportedFields } =
          mapCopilotModels(rawModels);
        const prioritized = prioritizeModel(mapped, preferredModel);
        const available = prioritized.length > 0;

        logCopilotModelMapping({
          requestId,
          mappedModelCount: prioritized.length,
          ignoredUnsupportedFields,
          blockingStage: available ? readiness.blockingStage : 'models',
        });

        const response: ChatModelsResponse = {
          provider: 'copilot',
          available,
          toolsAvailable: available ? readiness.toolsAvailable : false,
          reason: available ? readiness.reason : COPILOT_MODELS_REASON,
          models: prioritized,
        };
        return res.json(response);
      } catch {
        logCopilotModelMapping({
          requestId,
          mappedModelCount: 0,
          ignoredUnsupportedFields: false,
          blockingStage: 'models',
        });
        const response: ChatModelsResponse = {
          provider: 'copilot',
          available: false,
          toolsAvailable: false,
          reason: COPILOT_MODELS_REASON,
          models: [],
        };
        return res.json(response);
      } finally {
        if (started) {
          await runtime.stop().catch(() => []);
        }
      }
    }

    const baseUrl = process.env.CODEINFO_LMSTUDIO_BASE_URL ?? '';
    const safeBase = scrubBaseUrl(baseUrl);

    if (!BASE_URL_REGEX.test(baseUrl)) {
      append({
        level: 'error',
        message: 'chat models invalid baseUrl',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: { baseUrl: safeBase },
      });
      baseLogger.error(
        { requestId, baseUrl: safeBase },
        'chat models invalid baseUrl',
      );
      return res.status(503).json({
        error: 'lmstudio unavailable',
        provider: 'lmstudio',
        available: false,
        toolsAvailable: false,
        models: [],
      });
    }

    append({
      level: 'info',
      message: 'chat models fetch start',
      timestamp: new Date().toISOString(),
      source: 'server',
      requestId,
      context: { baseUrl: safeBase },
    });

    try {
      const client = clientFactory(toWebSocketUrl(baseUrl));
      const models = await client.system.listDownloadedModels();
      const mapped = models.filter(isChatModel).map((model) => ({
        key: model.modelKey,
        displayName: model.displayName,
        type: model.type,
      }));
      const preferredDefaults = resolveChatDefaults({});
      const prioritized = prioritizeModel(
        mapped,
        preferredDefaults.provider === 'lmstudio'
          ? preferredDefaults.model
          : undefined,
      );
      const available = prioritized.length > 0;
      const reason = available ? undefined : 'lmstudio unavailable';

      const response: ChatModelsResponse = {
        provider: 'lmstudio',
        available,
        toolsAvailable: available,
        reason,
        models: prioritized,
      };

      append({
        level: 'info',
        message: 'chat models fetch success',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: { baseUrl: safeBase, models: prioritized.length },
      });
      baseLogger.info(
        { requestId, baseUrl: safeBase, models: prioritized.length },
        'chat models fetch success',
      );
      res.json(response);
    } catch (err) {
      const error = (err as Error).message ?? 'lmstudio unavailable';
      append({
        level: 'error',
        message: 'chat models fetch failed',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: { baseUrl: safeBase, error },
      });
      baseLogger.error(
        { requestId, baseUrl: safeBase, error },
        'chat models fetch failed',
      );
      res.status(503).json({
        error: 'lmstudio unavailable',
        provider: 'lmstudio',
        available: false,
        toolsAvailable: false,
        models: [],
      });
    }
  });

  return router;
}
