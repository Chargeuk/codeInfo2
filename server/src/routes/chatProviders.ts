import {
  ORDERED_CHAT_PROVIDER_CONTRACT,
  ORDERED_CHAT_PROVIDER_IDS,
} from '@codeinfo2/common';
import type { LMStudioClient } from '@lmstudio/sdk';
import { Router, type Request, type Response } from 'express';
import {
  normalizeImplicitCopilotRequestedModel,
  resolveCopilotDefaultModel,
} from '../chat/copilotModelSupport.js';
import {
  resolveCodexCapabilities,
  type CodexCapabilityResolution,
} from '../codex/capabilityResolver.js';
import {
  buildDefaultsAppliedMarkerPayload,
  prioritizeRuntimeProviderModels,
  resolveChatDefaults,
  resolveCodexChatDefaults,
  resolveProviderRuntimePreferredModel,
  resolveRuntimeProviderSelection,
  STORY_47_TASK_1_LOG_MARKER,
  toChatResolutionSource,
  type ChatDefaultProvider,
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
  bindCurrentTestEnvOverrides,
  getScopedEnvValue,
  getScopedProcessEnv,
} from '../test/support/testEnvOverrideScope.js';
import {
  buildEndpointOnlyProviderWarning,
  buildCodexAgentFlags,
  buildCodexCompatibilityDefaults,
  buildCopilotAgentFlags,
  buildLmStudioAgentFlags,
  buildProviderInfo,
  buildProvidersResponse,
  filterUserFacingWarnings,
  getProviderBootstrapReason,
  getProviderBootstrapWarnings,
  isCodexEndpointOnlyAvailable,
  isCopilotEndpointOnlyAvailable,
  isProviderBootstrapHealthy,
  resolveOpenAiCompatProviderDiscovery,
  selectProviderNativeAndEndpointLiveModels,
  toCompatibilityCodexWarnings,
} from './chatDiscovery.js';
import { BASE_URL_REGEX, scrubBaseUrl } from './lmstudioUrl.js';

type ClientFactory = (baseUrl: string) => LMStudioClient;
const TASK7_LOG_MARKER = 'DEV_0000040_T07_REST_DEFAULTS_APPLIED';
const TASK1_LOG_MARKER = 'story.0000051.task01.provider_contract_applied';
const toWebSocketUrl = (value: string) => {
  if (value.startsWith('http://')) return value.replace(/^http:/i, 'ws:');
  if (value.startsWith('https://')) return value.replace(/^https:/i, 'wss:');
  return value;
};

const isChatModel = (model: { type?: string; architecture?: string }) => {
  const kind = (model.type ?? '').toLowerCase();
  return kind !== 'embedding' && kind !== 'vector';
};

export function createChatProvidersRouter({
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

  router.get(
    '/providers',
    bindCurrentTestEnvOverrides(async (_req: Request, res: Response) => {
      const env = getScopedProcessEnv();
      const codexHome =
        getScopedEnvValue('CODEINFO_CODEX_HOME') ??
        getScopedEnvValue('CODEX_HOME');
      const codexBootstrapHealthy = isProviderBootstrapHealthy('codex');
      const copilotBootstrapHealthy = isProviderBootstrapHealthy('copilot');
      const lmstudioBootstrapHealthy = isProviderBootstrapHealthy('lmstudio');
      const codex = getCodexDetection();
      const mcp = await getMcpStatus();
      const capabilities = await codexCapabilityResolver({
        consumer: 'chat_models',
      });
      const baseUrl = getScopedEnvValue('CODEINFO_LMSTUDIO_BASE_URL') ?? '';
      const safeBase = scrubBaseUrl(baseUrl);
      let lmstudioReason: string | undefined;
      let lmstudioModels: string[] = [];
      if (!BASE_URL_REGEX.test(baseUrl)) {
        lmstudioReason = 'lmstudio unavailable';
      } else {
        try {
          const client = clientFactory(toWebSocketUrl(baseUrl));
          const models = await client.system.listDownloadedModels();
          lmstudioModels = models
            .filter(isChatModel)
            .map((entry) => entry.modelKey)
            .filter((value) => typeof value === 'string' && value.trim().length);
          if (lmstudioModels.length === 0) {
            lmstudioReason = 'lmstudio unavailable';
          }
        } catch {
          lmstudioReason = 'lmstudio unavailable';
        }
      }
      const copilot = await resolveCopilotReadiness({
        createRuntime: copilotRuntimeFactory,
        env,
        toolsAvailable: mcp.available,
        toolsReason: mcp.reason,
      });

      const requestedDefaults = resolveChatDefaults({
        codexHome,
        copilotHome: getScopedEnvValue('CODEINFO_COPILOT_HOME'),
        lmstudioHome: getScopedEnvValue('CODEINFO_LMSTUDIO_HOME'),
      });
      const codexRequestedDefaults =
        requestedDefaults.provider === 'codex'
          ? await resolveCodexChatDefaults({
              codexHome,
            })
          : undefined;
      const requestedModel =
        requestedDefaults.provider === 'codex'
          ? (codexRequestedDefaults?.values.model ?? requestedDefaults.model)
          : requestedDefaults.provider === 'copilot'
            ? normalizeImplicitCopilotRequestedModel({
                models: copilot.modelsRaw,
                requestedModel: requestedDefaults.model,
                requestedModelSource: requestedDefaults.modelSource,
              })
            : requestedDefaults.model;
      const codexExternalOpenAiCompatDiscovery =
        await resolveOpenAiCompatProviderDiscovery({
          provider: 'codex',
          codexHome,
          copilotHome: getScopedEnvValue('CODEINFO_COPILOT_HOME'),
          env,
        });
      const copilotExternalOpenAiCompatDiscovery =
        await resolveOpenAiCompatProviderDiscovery({
          provider: 'copilot',
          codexHome,
          copilotHome: getScopedEnvValue('CODEINFO_COPILOT_HOME'),
          env,
        });
      const selectedProviderExternalDiscovery =
        requestedDefaults.provider === 'codex'
          ? codexExternalOpenAiCompatDiscovery
          : requestedDefaults.provider === 'copilot'
            ? copilotExternalOpenAiCompatDiscovery
            : {
                models: [],
                liveModels: [],
                warnings: [],
              };
      const resolvedRequestedModel =
        requestedDefaults.provider === 'codex' ||
        requestedDefaults.provider === 'copilot'
          ? (selectedProviderExternalDiscovery.selectedModelKey ??
            requestedModel)
          : requestedModel;
      const selectedProviderModelMetadata =
        selectedProviderExternalDiscovery.selectedModelKey &&
        (requestedDefaults.provider === 'codex' ||
          requestedDefaults.provider === 'copilot')
          ? {
              defaultModel: selectedProviderExternalDiscovery.selectedModelKey,
              defaultModelSource: 'config' as const,
              warnings: [] as string[],
            }
          : undefined;
      const copilotModelMetadata = resolveCopilotDefaultModel({
        models: copilot.modelsRaw,
        copilotHome: getScopedEnvValue('CODEINFO_COPILOT_HOME'),
      });
      const copilotAgentFlags = buildCopilotAgentFlags({
        models: copilot.modelsRaw,
        copilotHome: getScopedEnvValue('CODEINFO_COPILOT_HOME'),
      });
      const lmstudioModelMetadata = resolveProviderRuntimePreferredModel({
        provider: 'lmstudio',
        lmstudioHome: getScopedEnvValue('CODEINFO_LMSTUDIO_HOME'),
      });
      const prioritizedLmstudioProviderModel =
        prioritizeRuntimeProviderModels(lmstudioModels, requestedModel)[0] ??
        lmstudioModelMetadata.model;
      const lmstudioProviderModelMetadata =
        prioritizedLmstudioProviderModel === undefined
          ? undefined
          : {
              defaultModel: prioritizedLmstudioProviderModel,
              defaultModelSource:
                prioritizedLmstudioProviderModel === lmstudioModelMetadata.model
                  ? ('config' as const)
                  : ('hardcoded' as const),
              warnings:
                prioritizedLmstudioProviderModel !==
                  lmstudioModelMetadata.model && lmstudioModelMetadata.model
                  ? [
                      `lmstudio default model "${lmstudioModelMetadata.model}" is unavailable in the live model list; normalized to "${prioritizedLmstudioProviderModel}".`,
                    ]
                  : [],
            };
      const codexNativeAvailable = codex.available && codexBootstrapHealthy;
      const codexLiveModels = selectProviderNativeAndEndpointLiveModels({
      nativeAvailable: codexNativeAvailable,
      nativeModels: capabilities.models.map((entry) => entry.model),
      endpointModels: codexExternalOpenAiCompatDiscovery.liveModels,
    });
    const codexEndpointOnly = isCodexEndpointOnlyAvailable({
      detection: codex,
      bootstrapHealthy: codexBootstrapHealthy,
      endpointModelCount: codexExternalOpenAiCompatDiscovery.liveModels.length,
    });
    const codexAvailable = codexNativeAvailable || codexEndpointOnly;
    const codexToolsAvailable =
      mcp.available && (codexNativeAvailable || codexEndpointOnly);
    const copilotNativeAvailable =
      copilot.available && copilotBootstrapHealthy;
    const copilotLiveModels = selectProviderNativeAndEndpointLiveModels({
      nativeAvailable: copilotNativeAvailable,
      nativeModels: copilot.models,
      endpointModels: copilotExternalOpenAiCompatDiscovery.liveModels,
    });
    const copilotEndpointOnly = isCopilotEndpointOnlyAvailable({
      readiness: copilot,
      bootstrapHealthy: copilotBootstrapHealthy,
      endpointModelCount:
        copilotExternalOpenAiCompatDiscovery.liveModels.length,
    });
    const copilotAvailable = copilotNativeAvailable || copilotEndpointOnly;
    const copilotToolsAvailable =
      mcp.available && (copilotNativeAvailable || copilotEndpointOnly);

    const runtimeSelection = resolveRuntimeProviderSelection({
      requestedProvider: requestedDefaults.provider as ChatDefaultProvider,
      requestedModel: resolvedRequestedModel,
      codex: {
        available: codexAvailable,
        models: prioritizeRuntimeProviderModels(
          codexLiveModels,
          requestedDefaults.provider === 'codex'
            ? resolvedRequestedModel
            : codexRequestedDefaults?.values.model,
        ),
        reason:
          getProviderBootstrapReason('codex') ??
          codex.reason ??
          'codex unavailable',
      },
      copilot: {
        available: copilotAvailable,
        models: prioritizeRuntimeProviderModels(
          copilotLiveModels,
          requestedDefaults.provider === 'copilot'
            ? resolvedRequestedModel
            : copilotModelMetadata.defaultModel,
        ),
        reason: getProviderBootstrapReason('copilot') ?? copilot.reason,
      },
      lmstudio: {
        available: lmstudioModels.length > 0 && lmstudioBootstrapHealthy,
        models: prioritizeRuntimeProviderModels(
          lmstudioModels,
          lmstudioModelMetadata.model,
        ),
        reason: getProviderBootstrapReason('lmstudio') ?? lmstudioReason,
      },
    });
    const selectedEndpointId =
      runtimeSelection.executionProvider === 'codex'
        ? codexExternalOpenAiCompatDiscovery.models.find(
            (model) =>
              model.key === runtimeSelection.executionModel &&
              (model.endpointId ?? undefined) ===
                codexExternalOpenAiCompatDiscovery.selectedEndpointId,
          )?.endpointId
        : runtimeSelection.executionProvider === 'copilot'
          ? copilotExternalOpenAiCompatDiscovery.models.find(
              (model) =>
                model.key === runtimeSelection.executionModel &&
                (model.endpointId ?? undefined) ===
                  copilotExternalOpenAiCompatDiscovery.selectedEndpointId,
            )?.endpointId
          : undefined;

    const rawCodexWarnings = [...capabilities.warnings];
    rawCodexWarnings.push(...getProviderBootstrapWarnings('codex'));
    if (capabilities.defaults.webSearchEnabled && !codexToolsAvailable) {
      rawCodexWarnings.push(
        'Codex web search is enabled, but tools are unavailable; web search will be ignored.',
      );
    }
    const codexConfigWarnings: string[] = [];
    const codexDefaults = buildCodexCompatibilityDefaults({
      capabilities,
      codexHome,
      warnings: codexConfigWarnings,
    });
    rawCodexWarnings.push(...codexConfigWarnings);
    if (requestedDefaults.provider === 'codex') {
      rawCodexWarnings.push(...codexExternalOpenAiCompatDiscovery.warnings);
    }
    if (codexEndpointOnly) {
      rawCodexWarnings.push(buildEndpointOnlyProviderWarning('codex'));
    }
    const codexWarnings = filterUserFacingWarnings(rawCodexWarnings) ?? [];
    const copilotWarnings =
      filterUserFacingWarnings([
        ...getProviderBootstrapWarnings('copilot'),
        ...(copilotEndpointOnly
          ? [buildEndpointOnlyProviderWarning('copilot')]
          : copilot.reason
            ? [copilot.reason]
            : []),
        ...copilotAgentFlags.warnings,
        ...copilotExternalOpenAiCompatDiscovery.warnings,
      ]) ?? [];
    const lmstudioAgentFlags = buildLmStudioAgentFlags({});
    const lmstudioWarnings =
      filterUserFacingWarnings([
        ...getProviderBootstrapWarnings('lmstudio'),
        ...(lmstudioReason ? [lmstudioReason] : []),
        ...lmstudioAgentFlags.warnings,
      ]) ?? [];
    const providerMap = {
      copilot: buildProviderInfo({
        provider: 'copilot',
        available: copilotAvailable,
        toolsAvailable: copilotToolsAvailable,
        endpointOnly: copilotEndpointOnly,
        reason:
          copilotAvailable && copilotEndpointOnly
            ? undefined
            : copilotBootstrapHealthy
              ? copilot.reason
              : (getProviderBootstrapReason('copilot') ?? copilot.reason),
        copilotHome: getScopedEnvValue('CODEINFO_COPILOT_HOME'),
        warnings: copilotWarnings,
        liveModels: copilotLiveModels,
        modelMetadata:
          requestedDefaults.provider === 'copilot'
            ? selectedProviderModelMetadata
            : undefined,
        agentFlags: copilotAgentFlags.agentFlags,
      }),
      lmstudio: buildProviderInfo({
        provider: 'lmstudio',
        available: lmstudioModels.length > 0 && lmstudioBootstrapHealthy,
        toolsAvailable: lmstudioModels.length > 0 && lmstudioBootstrapHealthy,
        endpointOnly: false,
        reason: lmstudioBootstrapHealthy
          ? lmstudioReason
          : (getProviderBootstrapReason('lmstudio') ?? lmstudioReason),
        lmstudioHome: getScopedEnvValue('CODEINFO_LMSTUDIO_HOME'),
        warnings: lmstudioWarnings,
        liveModels: lmstudioModels,
        modelMetadata: lmstudioProviderModelMetadata,
        agentFlags: lmstudioAgentFlags.agentFlags,
      }),
      codex: buildProviderInfo({
        provider: 'codex',
        available: codexAvailable,
        toolsAvailable: codexToolsAvailable,
        endpointOnly: codexEndpointOnly,
        reason:
          codexAvailable && codexEndpointOnly
            ? undefined
            : codexBootstrapHealthy
              ? (codex.reason ?? (mcp.available ? undefined : mcp.reason))
              : (getProviderBootstrapReason('codex') ??
                codex.reason ??
                (mcp.available ? undefined : mcp.reason)),
        codexHome,
        warnings: codexWarnings,
        liveModels: codexLiveModels,
        modelMetadata:
          requestedDefaults.provider === 'codex'
            ? selectedProviderModelMetadata
            : undefined,
        agentFlags: buildCodexAgentFlags({
          capabilities,
          codexHome,
          defaults: codexDefaults,
        }),
        compatibility: {
          codexDefaults,
          codexWarnings: toCompatibilityCodexWarnings(codexWarnings),
        },
      }),
    } satisfies Record<
      ChatDefaultProvider,
      ReturnType<typeof buildProviderInfo>
    >;
    const response = buildProvidersResponse({
      providerMap,
      selectedProvider: runtimeSelection.executionProvider,
      selectedModel: runtimeSelection.executionModel,
      selectedEndpointId,
      fallbackApplied: runtimeSelection.fallbackApplied,
      compatibility: {
        codexDefaults,
        codexWarnings: toCompatibilityCodexWarnings(codexWarnings),
      },
      codexDefaults,
      codexWarnings,
    });

    append({
      level: 'info',
      message: TASK1_LOG_MARKER,
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        orderedProviderContract: ORDERED_CHAT_PROVIDER_CONTRACT,
        orderedProviderIds: [...ORDERED_CHAT_PROVIDER_IDS],
        surface: '/chat/providers',
      },
    });

    baseLogger.info(
      {
        requestProvider: runtimeSelection.requestedProvider,
        requestModel: runtimeSelection.requestedModel,
        executionProvider: runtimeSelection.executionProvider,
        executionModel: runtimeSelection.executionModel,
        fallbackApplied: runtimeSelection.fallbackApplied,
        orderedProviderContract: ORDERED_CHAT_PROVIDER_CONTRACT,
        provider: 'codex',
        available: codexAvailable,
        toolsAvailable: codexToolsAvailable,
        codexReason: codex.reason,
        copilotAvailable,
        copilotToolsAvailable,
        copilotReason: copilot.reason,
        copilotBlockingStage: copilot.blockingStage,
        copilotAuthSource: copilot.authSource,
        copilotModelCount: copilot.models.length,
        mcpAvailable: mcp.available,
        mcpReason: mcp.reason,
        lmstudioAvailable: lmstudioModels.length > 0,
        lmstudioReason,
        lmstudioModelCount: lmstudioModels.length,
        baseUrl: safeBase,
      },
      'chat providers resolved',
    );
    console.info(
      STORY_47_TASK_1_LOG_MARKER,
      buildDefaultsAppliedMarkerPayload({
        surface: '/chat/providers',
        requestedProvider: runtimeSelection.requestedProvider,
        requestedModel: runtimeSelection.requestedModel,
        resolvedModel: runtimeSelection.executionModel,
        runtimePath: runtimeSelection.executionPath,
        modelSource:
          requestedDefaults.provider === 'codex'
            ? toChatResolutionSource(
                codexRequestedDefaults?.sources.model ?? 'hardcoded',
              )
            : requestedDefaults.modelSource,
        codexModelSource:
          requestedDefaults.provider === 'codex'
            ? (codexRequestedDefaults?.sources.model ?? 'hardcoded')
            : undefined,
        warnings: rawCodexWarnings,
        extras: {
          ordered_provider_contract: ORDERED_CHAT_PROVIDER_CONTRACT,
        },
      }),
    );
    console.info(TASK7_LOG_MARKER, {
      surface: '/chat/providers',
      provider: 'codex',
      warningCount: rawCodexWarnings.length,
      defaults: codexDefaults,
    });

      res.json(response);
    }),
  );

  return router;
}
