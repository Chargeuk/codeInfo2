import {
  ORDERED_CHAT_PROVIDER_IDS,
  isChatProviderId,
  type ChatModelInfo,
} from '@codeinfo2/common';
import type { ModelInfo } from '@github/copilot-sdk';
import type { LMStudioClient } from '@lmstudio/sdk';
import { Router } from 'express';
import {
  resolveCodexCapabilities,
  type CodexCapabilityResolution,
} from '../codex/capabilityResolver.js';
import {
  buildDefaultsAppliedMarkerPayload,
  ChatDefaultsResolutionError,
  prioritizeRuntimeProviderModels,
  resolveChatDefaults,
  resolveCodexChatDefaults,
  resolveProviderRuntimePreferredModel,
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
  getScopedEnvValue,
  getScopedProcessEnv,
} from '../test/support/testEnvOverrideScope.js';
import {
  buildEndpointOnlyProviderWarning,
  buildCodexAgentFlags,
  buildCodexCompatibilityDefaults,
  buildCodexModelFlagOverrides,
  buildCopilotAgentFlags,
  buildCopilotModelFlagOverrides,
  getProviderBootstrapReason,
  getProviderBootstrapWarnings,
  isCodexEndpointOnlyAvailable,
  isCopilotEndpointOnlyAvailable,
  isProviderBootstrapHealthy,
  buildLmStudioAgentFlags,
  buildModelsResponse,
  buildProviderInfo,
  filterUserFacingWarnings,
  orderProviders,
  resolveOpenAiCompatProviderDiscovery,
  selectProviderNativeAndEndpointModels,
  selectProviderNativeAndEndpointLiveModels,
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

const prioritizeModelIdentity = <T extends { key: string; endpointId?: string }>(
  models: T[],
  preferredModel: string | undefined,
  preferredEndpointId?: string,
): T[] => {
  if (!preferredModel) return models;

  if (preferredEndpointId !== undefined) {
    const exactIndex = models.findIndex(
      (model) =>
        model.key === preferredModel &&
        (model.endpointId ?? undefined) === preferredEndpointId,
    );
    if (exactIndex > 0) {
      const clone = [...models];
      const [preferred] = clone.splice(exactIndex, 1);
      clone.unshift(preferred);
      return clone;
    }
  }

  return prioritizeModel(models, preferredModel);
};

const resolveSelectedEndpointId = <T extends { key: string; endpointId?: string }>(
  models: T[],
  selectedModel: string | undefined,
  selectedEndpointId: string | undefined,
): string | undefined => {
  if (!selectedModel || !selectedEndpointId) {
    return undefined;
  }

  const exactMatch = models.find(
    (model) =>
      model.key === selectedModel &&
      (model.endpointId ?? undefined) === selectedEndpointId,
  );

  return exactMatch?.endpointId;
};

const normalizeModelIdentity = (value: string | undefined): string | undefined => {
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : undefined;
};

const dropSelectedPlainModelDuplicates = <
  T extends { key: string; endpointId?: string },
>(
  models: T[],
  selectedModel: string | undefined,
  selectedEndpointId: string | undefined,
): T[] => {
  if (!selectedModel || !selectedEndpointId) {
    return models;
  }

  const hasEndpointBackedSelection = models.some(
    (model) =>
      model.key === selectedModel &&
      (model.endpointId ?? undefined) === selectedEndpointId,
  );
  if (!hasEndpointBackedSelection) {
    return models;
  }

  const normalizedSelectedModel = normalizeModelIdentity(selectedModel);
  if (!normalizedSelectedModel) {
    return models;
  }

  return models.filter(
    (model) =>
      (model.endpointId ?? undefined) !== undefined ||
      normalizeModelIdentity(model.key) !== normalizedSelectedModel,
  );
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
    const env = getScopedProcessEnv();
    const codexHome =
      getScopedEnvValue('CODEINFO_CODEX_HOME') ?? getScopedEnvValue('CODEX_HOME');
    const codexBootstrapHealthy = isProviderBootstrapHealthy('codex');
    const copilotBootstrapHealthy = isProviderBootstrapHealthy('copilot');
    const lmstudioBootstrapHealthy = isProviderBootstrapHealthy('lmstudio');
    const requestId = res.locals.requestId as string | undefined;
    const parsedProvider = parseChatModelProvider(req.query.provider);
    if ('error' in parsedProvider) {
      return res.status(400).json({
        error: 'invalid_request',
        message: parsedProvider.error,
      });
    }
    const provider = parsedProvider.provider ?? 'lmstudio';
    const externalOpenAiCompatDiscovery =
      provider === 'codex' || provider === 'copilot'
        ? await resolveOpenAiCompatProviderDiscovery({
            provider,
            codexHome,
            copilotHome: getScopedEnvValue('CODEINFO_COPILOT_HOME'),
            env,
          })
        : {
            models: [],
            liveModels: [],
            warnings: [],
          };
    const detection = getCodexDetection();
    const mcp = await getMcpStatus();
    const capabilities = await codexCapabilityResolver({
      consumer: 'chat_models',
    });
    const codexNativeAvailable = detection.available && codexBootstrapHealthy;
    const codexConfigWarnings: string[] = [];
    const codexDefaults = buildCodexCompatibilityDefaults({
      capabilities,
      codexHome,
      warnings: codexConfigWarnings,
    });
    let requestedDefaults: ReturnType<typeof resolveChatDefaults> | undefined =
      undefined;
    try {
      requestedDefaults = resolveChatDefaults({
        requestProvider: provider,
        codexHome,
        copilotHome: getScopedEnvValue('CODEINFO_COPILOT_HOME'),
        lmstudioHome: getScopedEnvValue('CODEINFO_LMSTUDIO_HOME'),
      });
    } catch (error) {
      if (!(error instanceof ChatDefaultsResolutionError)) {
        throw error;
      }
    }
    const codexPreferredDefaults = await resolveCodexChatDefaults({
      codexHome,
    });
    const codexExternalModels =
      provider === 'codex' ? externalOpenAiCompatDiscovery.models : [];
    const codexLiveModels = selectProviderNativeAndEndpointLiveModels({
      nativeAvailable: codexNativeAvailable,
      nativeModels: capabilities.models.map((capability) => capability.model),
      endpointModels:
        provider === 'codex' ? externalOpenAiCompatDiscovery.liveModels : [],
    });
    const codexEndpointOnly =
      provider === 'codex' &&
      isCodexEndpointOnlyAvailable({
        detection,
        bootstrapHealthy: codexBootstrapHealthy,
        endpointModelCount: externalOpenAiCompatDiscovery.liveModels.length,
      });
    const codexAvailable = codexNativeAvailable || codexEndpointOnly;
    const codexToolsAvailable =
      mcp.available && (codexNativeAvailable || codexEndpointOnly);
    const rawCodexWarnings = [
      ...capabilities.warnings,
      ...getProviderBootstrapWarnings('codex'),
      ...(capabilities.defaults.webSearchEnabled && !codexToolsAvailable
        ? [
            'Codex web search is enabled, but tools are unavailable; web search will be ignored.',
          ]
        : []),
    ];
    rawCodexWarnings.push(...codexConfigWarnings);
    if (provider === 'codex') {
      rawCodexWarnings.push(...externalOpenAiCompatDiscovery.warnings);
    }
    if (codexEndpointOnly) {
      rawCodexWarnings.push(buildEndpointOnlyProviderWarning('codex'));
    }
    const codexWarnings = filterUserFacingWarnings(rawCodexWarnings) ?? [];
    const codexProviderInfo = buildProviderInfo({
      provider: 'codex',
      available: codexAvailable,
      toolsAvailable: codexToolsAvailable,
      endpointOnly: codexEndpointOnly,
      reason:
        codexEndpointOnly
          ? undefined
          : (getProviderBootstrapReason('codex') ??
            detection.reason ??
            (mcp.available ? undefined : mcp.reason)),
      codexHome,
      warnings: codexWarnings,
      liveModels: codexLiveModels,
      agentFlags: buildCodexAgentFlags({
        capabilities,
        codexHome,
        defaults: codexDefaults,
      }),
      compatibility: {
        codexDefaults,
        codexWarnings: toCompatibilityCodexWarnings(codexWarnings),
      },
      modelMetadata:
        provider === 'codex' && externalOpenAiCompatDiscovery.selectedModelKey
          ? {
              defaultModel: externalOpenAiCompatDiscovery.selectedModelKey,
              defaultModelSource: 'config',
              warnings: [],
            }
          : undefined,
    });
    const nativeCodexModels: ChatModelInfo[] = capabilities.models.map(
      (capability) => ({
        key: capability.model,
        displayName: capability.model,
        type: 'codex',
        ...toCompatibilityReasoningEfforts(
          buildCodexModelFlagOverrides(capability),
        ),
        flagOverrides: buildCodexModelFlagOverrides(capability),
      }),
    );
    const codexModels: ChatModelInfo[] = selectProviderNativeAndEndpointModels({
      nativeAvailable: codexNativeAvailable,
      nativeModels: nativeCodexModels,
      endpointModels: codexExternalModels,
    });
    const codexSelectedEndpointId = resolveSelectedEndpointId(
      codexModels,
      codexProviderInfo.defaultModel,
      externalOpenAiCompatDiscovery.selectedEndpointId,
    );
    const codexVisibleModels = dropSelectedPlainModelDuplicates(
      codexModels,
      codexProviderInfo.defaultModel,
      codexSelectedEndpointId,
    );
    const prioritizedCodexModels = prioritizeModelIdentity(
      codexVisibleModels,
      codexProviderInfo.defaultModel,
      codexSelectedEndpointId,
    );

    baseLogger.info(
      {
        modelCount: capabilities.models.length,
        fallbackUsed: capabilities.fallbackUsed,
        warningsCount: capabilities.warnings.length,
      },
      '[codex-model-list] using env list',
    );
    if (rawCodexWarnings.length > 0) {
      baseLogger.warn(
        {
          requestId,
          warningsCount: rawCodexWarnings.length,
          codexWarnings: rawCodexWarnings,
        },
        'chat models codex warnings',
      );
    }

    const readiness = await resolveCopilotReadiness({
      createRuntime: copilotRuntimeFactory,
      env,
      toolsAvailable: mcp.available,
      toolsReason: mcp.reason,
    });
    const copilotRawModels = readiness.modelsRaw as ModelInfo[];
    const copilotAgentFlags = buildCopilotAgentFlags({
      models: copilotRawModels,
      copilotHome: getScopedEnvValue('CODEINFO_COPILOT_HOME'),
    });
    const { mapped: mappedCopilotModels, ignoredUnsupportedFields } =
      mapCopilotModels(copilotRawModels);
    const copilotExternalModels =
      provider === 'copilot'
        ? externalOpenAiCompatDiscovery.models.map((model) => ({
            ...model,
            type: 'copilot',
          }))
        : [];
    const copilotModels = [
      ...mappedCopilotModels.map((model) => {
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
      ...copilotExternalModels,
    ];
    const copilotNativeAvailable =
      readiness.available && copilotBootstrapHealthy;
    const copilotLiveModels = selectProviderNativeAndEndpointLiveModels({
      nativeAvailable: copilotNativeAvailable,
      nativeModels: mappedCopilotModels.map((model) => model.key),
      endpointModels:
        provider === 'copilot' ? externalOpenAiCompatDiscovery.liveModels : [],
    });
    const copilotEndpointOnly =
      provider === 'copilot' &&
      isCopilotEndpointOnlyAvailable({
        readiness,
        bootstrapHealthy: copilotBootstrapHealthy,
        endpointModelCount: externalOpenAiCompatDiscovery.liveModels.length,
      });
    const copilotAvailable =
      (copilotNativeAvailable || copilotEndpointOnly) &&
      copilotLiveModels.length > 0;
    const copilotWarnings =
      filterUserFacingWarnings([
      ...getProviderBootstrapWarnings('copilot'),
      ...(copilotEndpointOnly
        ? [buildEndpointOnlyProviderWarning('copilot')]
        : readiness.reason
          ? [readiness.reason]
          : []),
      ...copilotAgentFlags.warnings,
      ...(provider === 'copilot'
        ? externalOpenAiCompatDiscovery.warnings
        : []),
      ]) ?? [];
    const copilotProviderInfo = buildProviderInfo({
      provider: 'copilot',
      available: copilotAvailable,
      toolsAvailable: copilotAvailable ? mcp.available : false,
      endpointOnly: copilotEndpointOnly,
      reason:
        getProviderBootstrapReason('copilot') ??
        (copilotEndpointOnly
          ? undefined
          : copilotAvailable
          ? readiness.reason
          : (readiness.reason ?? COPILOT_MODELS_REASON)),
      copilotHome: getScopedEnvValue('CODEINFO_COPILOT_HOME'),
      warnings: copilotWarnings,
      liveModels: copilotLiveModels,
      modelMetadata:
        provider === 'copilot' && externalOpenAiCompatDiscovery.selectedModelKey
          ? {
              defaultModel: externalOpenAiCompatDiscovery.selectedModelKey,
              defaultModelSource: 'config',
              warnings: [],
            }
          : undefined,
      agentFlags: copilotAgentFlags.agentFlags,
    });
    const copilotSelectedEndpointId = resolveSelectedEndpointId(
      copilotModels,
      copilotProviderInfo.defaultModel,
      externalOpenAiCompatDiscovery.selectedEndpointId,
    );
    const copilotVisibleModels = dropSelectedPlainModelDuplicates(
      copilotModels,
      copilotProviderInfo.defaultModel,
      copilotSelectedEndpointId,
    );
    const prioritizedCopilotModels = prioritizeModelIdentity(
      copilotVisibleModels,
      copilotProviderInfo.defaultModel,
      copilotSelectedEndpointId,
    );
    logCopilotModelMapping({
      requestId,
      mappedModelCount: prioritizedCopilotModels.length,
      ignoredUnsupportedFields,
      blockingStage: copilotAvailable ? readiness.blockingStage : 'models',
    });

    const baseUrl = getScopedEnvValue('CODEINFO_LMSTUDIO_BASE_URL') ?? '';
    const safeBase = scrubBaseUrl(baseUrl);
    let lmstudioAvailable = false;
    let lmstudioReason: string | undefined;
    let lmstudioModels: ChatModelInfo[] = [];
    let lmstudioModelMetadata:
      | {
          defaultModel: string;
          defaultModelSource: 'config' | 'hardcoded';
          warnings: string[];
        }
      | undefined;

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
        const lmstudioPreferredModel = resolveProviderRuntimePreferredModel({
          provider: 'lmstudio',
          lmstudioHome: getScopedEnvValue('CODEINFO_LMSTUDIO_HOME'),
        }).model;
        const prioritizedLmstudioModel = prioritizeRuntimeProviderModels(
          models.filter(isChatModel).map((model) => model.modelKey),
          requestedDefaults?.provider === 'lmstudio'
            ? requestedDefaults.model
            : lmstudioPreferredModel,
        )[0];
        lmstudioModels = prioritizeModel(
          models.filter(isChatModel).map((model) => ({
            key: model.modelKey,
            displayName: model.displayName,
            type: model.type,
          })),
          prioritizedLmstudioModel,
        );
        lmstudioModelMetadata =
          lmstudioModels.length > 0
            ? {
                defaultModel: lmstudioModels[0].key,
                defaultModelSource:
                  requestedDefaults?.provider === 'lmstudio' &&
                  requestedDefaults.model === lmstudioModels[0].key
                    ? 'config'
                    : 'hardcoded',
                warnings: [],
              }
            : undefined;
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
    const lmstudioAgentFlags = buildLmStudioAgentFlags({});
    const lmstudioWarnings =
      filterUserFacingWarnings([
        ...getProviderBootstrapWarnings('lmstudio'),
        ...(lmstudioReason ? [lmstudioReason] : []),
        ...lmstudioAgentFlags.warnings,
      ]) ?? [];

    const providerMap = {
      codex: codexProviderInfo,
      copilot: copilotProviderInfo,
      lmstudio: buildProviderInfo({
        provider: 'lmstudio',
        available: lmstudioAvailable && lmstudioBootstrapHealthy,
        toolsAvailable: lmstudioAvailable && lmstudioBootstrapHealthy,
        endpointOnly: false,
        reason: getProviderBootstrapReason('lmstudio') ?? lmstudioReason,
        lmstudioHome: getScopedEnvValue('CODEINFO_LMSTUDIO_HOME'),
        warnings: lmstudioWarnings,
        liveModels: lmstudioModels.map((model) => model.key),
        modelMetadata: lmstudioModelMetadata,
        agentFlags: lmstudioAgentFlags.agentFlags,
      }),
    } as const;
    const providers = orderProviders(providerMap, provider);

    if (provider === 'codex') {
      const response = buildModelsResponse({
        provider: 'codex',
        available: codexAvailable,
        toolsAvailable: codexToolsAvailable,
        reason:
          codexEndpointOnly
            ? undefined
            : (getProviderBootstrapReason('codex') ??
              detection.reason ??
              (mcp.available ? undefined : mcp.reason)),
        models: codexAvailable ? prioritizedCodexModels : [],
        providers,
        providerInfo: providerMap.codex,
        selectedEndpointId: codexSelectedEndpointId,
        compatibility: providerMap.codex.compatibility,
        codexDefaults,
        codexWarnings,
      });
      console.info(
        STORY_47_TASK_1_LOG_MARKER,
      buildDefaultsAppliedMarkerPayload({
        surface: '/chat/models',
        requestedProvider: 'codex',
        requestedModel: codexPreferredDefaults.values.model,
        resolvedModel: codexPreferredDefaults.values.model,
          modelSource: toChatResolutionSource(
          codexPreferredDefaults.sources.model,
        ),
        codexModelSource: codexPreferredDefaults.sources.model,
        warnings: rawCodexWarnings,
      }),
    );
    console.info(TASK7_LOG_MARKER, {
      surface: '/chat/models',
      provider: 'codex',
      warningCount: rawCodexWarnings.length,
      defaults: codexDefaults,
    });

      if (codexAvailable) {
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
        available: providerMap.copilot.available,
        toolsAvailable: providerMap.copilot.toolsAvailable,
        reason: providerMap.copilot.reason,
        models: copilotAvailable ? prioritizedCopilotModels : [],
        providers,
        providerInfo: providerMap.copilot,
        selectedEndpointId: copilotSelectedEndpointId,
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
        available: providerMap.lmstudio.available,
        toolsAvailable: providerMap.lmstudio.toolsAvailable,
        reason: providerMap.lmstudio.reason,
        models: [],
        providers,
        providerInfo: providerMap.lmstudio,
        agentFlags: providerMap.lmstudio.agentFlags,
        selectedEndpointId: undefined,
        defaultModel: providerMap.lmstudio.defaultModel,
        defaultModelSource: providerMap.lmstudio.defaultModelSource,
        warnings: providerMap.lmstudio.warnings,
      });
    }

    const response = buildModelsResponse({
      provider: 'lmstudio',
      available: providerMap.lmstudio.available,
      toolsAvailable: providerMap.lmstudio.toolsAvailable,
      reason: providerMap.lmstudio.reason,
      models: lmstudioModels,
      providers,
      providerInfo: providerMap.lmstudio,
      selectedEndpointId: undefined,
    });
    return res.json(response);
  });

  return router;
}
