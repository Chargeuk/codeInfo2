import {
  ORDERED_CHAT_PROVIDER_IDS,
  isChatProviderId,
  type ChatModelInfo,
} from '@codeinfo2/common';
import type { ModelInfo } from '@github/copilot-sdk';
import type { LMStudioClient } from '@lmstudio/sdk';
import { Router } from 'express';
import { resolveCopilotDefaultModel } from '../chat/copilotModelSupport.js';
import {
  resolveCodexCapabilities,
  type CodexCapabilityResolution,
} from '../codex/capabilityResolver.js';
import {
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
import {
  buildCodexAgentFlags,
  buildCodexCompatibilityDefaults,
  buildCodexModelFlagOverrides,
  buildCopilotAgentFlags,
  buildCopilotModelFlagOverrides,
  buildLmStudioAgentFlags,
  buildModelsResponse,
  buildProviderInfo,
  orderProviders,
  toCompatibilityCodexWarnings,
  toCompatibilityReasoningEfforts,
} from './chatDiscovery.js';

type ClientFactory = (baseUrl: string) => LMStudioClient;
const BASE_URL_REGEX = /^(https?|wss?):\/\//i;
const TASK12_LOG_SUCCESS =
  '[DEV-0000037][T12] event=chat_models_codex_capabilities_returned result=success';
const TASK12_LOG_ERROR =
  '[DEV-0000037][T12] event=chat_models_codex_capabilities_returned result=error';
const TASK7_LOG_MARKER = 'DEV_0000040_T07_REST_DEFAULTS_APPLIED';
export const TASK6_LOG_MARKER = 'story.0000051.task06.models_mapped';
const PROVIDER_VALIDATION_MESSAGE = `provider must be one of: ${ORDERED_CHAT_PROVIDER_IDS.join(', ')}`;

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

const parseChatModelProvider = (value: unknown) => {
  if (value === undefined) return { provider: undefined };
  if (typeof value !== 'string') {
    return { error: PROVIDER_VALIDATION_MESSAGE };
  }

  const normalized = value.trim().toLowerCase();
  if (!isChatProviderId(normalized)) {
    return { error: PROVIDER_VALIDATION_MESSAGE };
  }

  return { provider: normalized };
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
    const parsedProvider = parseChatModelProvider(req.query.provider);
    if ('error' in parsedProvider) {
      return res.status(400).json({
        error: 'invalid_request',
        message: parsedProvider.error,
      });
    }
    const provider = parsedProvider.provider ?? 'lmstudio';
    const detection = getCodexDetection();
    const mcp = await getMcpStatus();
    const capabilities = await codexCapabilityResolver({
      consumer: 'chat_models',
    });
    const codexToolsAvailable = detection.available && mcp.available;
    const codexRuntimeWarnings: string[] = [];
    if (capabilities.defaults.webSearchEnabled && !codexToolsAvailable) {
      codexRuntimeWarnings.push(
        'Codex web search is enabled, but tools are unavailable; web search will be ignored.',
      );
    }
    const codexWarnings = [...capabilities.warnings, ...codexRuntimeWarnings];
    const codexDefaults = buildCodexCompatibilityDefaults({
      capabilities,
      codexHome: process.env.CODEX_HOME,
    });
    const codexPreferredDefaults = await resolveCodexChatDefaults({
      codexHome: process.env.CODEX_HOME,
    });
    const codexModels = prioritizeModel(
      capabilities.models.map((capability) => ({
        key: capability.model,
        displayName: capability.model,
        type: 'codex',
        ...toCompatibilityReasoningEfforts(
          buildCodexModelFlagOverrides(capability),
        ),
        flagOverrides: buildCodexModelFlagOverrides(capability),
      })),
      codexPreferredDefaults.values.model,
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

    const readiness = await resolveCopilotReadiness({
      createRuntime: copilotRuntimeFactory,
      env: process.env,
      toolsAvailable: mcp.available,
      toolsReason: mcp.reason,
    });
    const copilotRawModels = readiness.modelsRaw as ModelInfo[];
    const copilotModelMetadata = resolveCopilotDefaultModel({
      models: copilotRawModels,
      copilotHome: process.env.CODEINFO_COPILOT_HOME,
    });
    const { mapped: mappedCopilotModels, ignoredUnsupportedFields } =
      mapCopilotModels(copilotRawModels);
    const prioritizedCopilotModels = prioritizeModel(
      mappedCopilotModels.map((model) => {
        const rawModel = copilotRawModels.find(
          (entry) => entry.id === model.key,
        );
        const flagOverrides = rawModel
          ? buildCopilotModelFlagOverrides(rawModel)
          : [];
        return {
          ...model,
          ...toCompatibilityReasoningEfforts(flagOverrides),
          flagOverrides,
        };
      }),
      copilotModelMetadata.defaultModel,
    );
    const copilotAvailable =
      readiness.available && prioritizedCopilotModels.length > 0;
    logCopilotModelMapping({
      requestId,
      mappedModelCount: prioritizedCopilotModels.length,
      ignoredUnsupportedFields,
      blockingStage: copilotAvailable ? readiness.blockingStage : 'models',
    });

    const baseUrl = process.env.CODEINFO_LMSTUDIO_BASE_URL ?? '';
    const safeBase = scrubBaseUrl(baseUrl);
    let lmstudioAvailable = false;
    let lmstudioReason: string | undefined;
    let lmstudioModels: ChatModelInfo[] = [];

    if (!BASE_URL_REGEX.test(baseUrl)) {
      lmstudioReason = 'lmstudio unavailable';
    } else {
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
        lmstudioModels = prioritizeModel(
          models.filter(isChatModel).map((model) => ({
            key: model.modelKey,
            displayName: model.displayName,
            type: model.type,
          })),
          preferredDefaults.provider === 'lmstudio'
            ? preferredDefaults.model
            : undefined,
        );
        lmstudioAvailable = lmstudioModels.length > 0;
        lmstudioReason = lmstudioAvailable ? undefined : 'lmstudio unavailable';
        append({
          level: 'info',
          message: 'chat models fetch success',
          timestamp: new Date().toISOString(),
          source: 'server',
          requestId,
          context: { baseUrl: safeBase, models: lmstudioModels.length },
        });
        baseLogger.info(
          { requestId, baseUrl: safeBase, models: lmstudioModels.length },
          'chat models fetch success',
        );
      } catch (err) {
        const error = (err as Error).message ?? 'lmstudio unavailable';
        lmstudioReason = 'lmstudio unavailable';
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
      }
    }

    const providerMap = {
      codex: buildProviderInfo({
        provider: 'codex',
        available: detection.available,
        toolsAvailable: codexToolsAvailable,
        reason: detection.reason ?? (mcp.available ? undefined : mcp.reason),
        codexHome: process.env.CODEX_HOME,
        warnings: codexWarnings,
        agentFlags: buildCodexAgentFlags({
          capabilities,
          codexHome: process.env.CODEX_HOME,
        }),
        compatibility: {
          codexDefaults,
          codexWarnings: toCompatibilityCodexWarnings(codexWarnings),
        },
      }),
      copilot: buildProviderInfo({
        provider: 'copilot',
        available: copilotAvailable,
        toolsAvailable: copilotAvailable ? readiness.toolsAvailable : false,
        reason: copilotAvailable
          ? readiness.reason
          : (readiness.reason ?? COPILOT_MODELS_REASON),
        copilotHome: process.env.CODEINFO_COPILOT_HOME,
        warnings:
          copilotAvailable && readiness.reason
            ? [readiness.reason]
            : readiness.reason
              ? [readiness.reason]
              : [],
        modelMetadata: {
          defaultModel: copilotModelMetadata.defaultModel,
          defaultModelSource: copilotModelMetadata.defaultModelSource,
          warnings: copilotModelMetadata.warnings,
        },
        agentFlags: buildCopilotAgentFlags({
          models: copilotRawModels,
          copilotHome: process.env.CODEINFO_COPILOT_HOME,
        }),
      }),
      lmstudio: buildProviderInfo({
        provider: 'lmstudio',
        available: lmstudioAvailable,
        toolsAvailable: lmstudioAvailable,
        reason: lmstudioReason,
        lmstudioHome: process.env.CODEINFO_LMSTUDIO_HOME,
        warnings: lmstudioReason ? [lmstudioReason] : [],
        agentFlags: buildLmStudioAgentFlags({}),
      }),
    } as const;
    const providers = orderProviders(providerMap, provider);

    if (provider === 'codex') {
      const response = buildModelsResponse({
        provider: 'codex',
        available: detection.available,
        toolsAvailable: codexToolsAvailable,
        reason: detection.reason ?? (mcp.available ? undefined : mcp.reason),
        models: detection.available ? codexModels : [],
        providers,
        providerInfo: providerMap.codex,
        compatibility: providerMap.codex.compatibility,
        codexDefaults,
        codexWarnings,
      });
      console.info(STORY_47_TASK_1_LOG_MARKER, {
        surface: '/chat/models',
        requested_provider: 'codex',
        requested_model: codexPreferredDefaults.values.model,
        resolved_model: codexPreferredDefaults.values.model,
        model_source: toChatResolutionSource(
          codexPreferredDefaults.sources.model,
        ),
        codex_model_source: codexPreferredDefaults.sources.model,
        success: true,
        warning_count: codexWarnings.length,
      });
      console.info(TASK7_LOG_MARKER, {
        surface: '/chat/models',
        provider: 'codex',
        warningCount: codexWarnings.length,
        defaults: codexDefaults,
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
      const response = buildModelsResponse({
        provider: 'copilot',
        available: copilotAvailable,
        toolsAvailable: copilotAvailable ? readiness.toolsAvailable : false,
        reason: copilotAvailable
          ? readiness.reason
          : (readiness.reason ?? COPILOT_MODELS_REASON),
        models: copilotAvailable ? prioritizedCopilotModels : [],
        providers,
        providerInfo: providerMap.copilot,
      });
      return res.json(response);
    }

    if (!BASE_URL_REGEX.test(baseUrl) || !lmstudioAvailable) {
      append({
        level: 'error',
        message: !BASE_URL_REGEX.test(baseUrl)
          ? 'chat models invalid baseUrl'
          : 'chat models fetch failed',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: {
          baseUrl: safeBase,
          error: lmstudioReason ?? 'lmstudio unavailable',
        },
      });
      baseLogger.error(
        {
          requestId,
          baseUrl: safeBase,
          error: lmstudioReason ?? 'lmstudio unavailable',
        },
        !BASE_URL_REGEX.test(baseUrl)
          ? 'chat models invalid baseUrl'
          : 'chat models fetch failed',
      );
      return res.status(503).json({
        error: 'lmstudio unavailable',
        provider: 'lmstudio',
        available: false,
        toolsAvailable: false,
        reason: lmstudioReason ?? 'lmstudio unavailable',
        models: [],
        providers,
        providerInfo: providerMap.lmstudio,
        agentFlags: providerMap.lmstudio.agentFlags,
        defaultModel: providerMap.lmstudio.defaultModel,
        defaultModelSource: providerMap.lmstudio.defaultModelSource,
        warnings: providerMap.lmstudio.warnings,
      });
    }

    const response = buildModelsResponse({
      provider: 'lmstudio',
      available: true,
      toolsAvailable: true,
      models: lmstudioModels,
      providers,
      providerInfo: providerMap.lmstudio,
    });
    return res.json(response);
  });

  return router;
}
