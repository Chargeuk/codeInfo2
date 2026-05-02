import {
  ORDERED_CHAT_PROVIDER_CONTRACT,
  ORDERED_CHAT_PROVIDER_IDS,
} from '@codeinfo2/common';
import type { LMStudioClient } from '@lmstudio/sdk';
import { Router } from 'express';
import {
  normalizeImplicitCopilotRequestedModel,
  resolveCopilotDefaultModel,
} from '../chat/copilotModelSupport.js';
import {
  resolveCodexCapabilities,
  type CodexCapabilityResolution,
} from '../codex/capabilityResolver.js';
import {
  resolveChatDefaults,
  resolveCodexChatDefaults,
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
  buildCodexAgentFlags,
  buildCodexCompatibilityDefaults,
  buildCopilotAgentFlags,
  buildLmStudioAgentFlags,
  buildProviderInfo,
  buildProvidersResponse,
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

  router.get('/providers', async (_req, res) => {
    const codex = getCodexDetection();
    const mcp = await getMcpStatus();
    const capabilities = await codexCapabilityResolver({
      consumer: 'chat_models',
    });
    const baseUrl = process.env.CODEINFO_LMSTUDIO_BASE_URL ?? '';
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
      env: process.env,
      toolsAvailable: mcp.available,
      toolsReason: mcp.reason,
    });

    const requestedDefaults = resolveChatDefaults({});
    const codexRequestedDefaults =
      requestedDefaults.provider === 'codex'
        ? await resolveCodexChatDefaults({
            codexHome: process.env.CODEX_HOME,
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
    const copilotModelMetadata = resolveCopilotDefaultModel({
      models: copilot.modelsRaw,
      copilotHome: process.env.CODEINFO_COPILOT_HOME,
    });
    const copilotAgentFlags = buildCopilotAgentFlags({
      models: copilot.modelsRaw,
      copilotHome: process.env.CODEINFO_COPILOT_HOME,
    });
    const runtimeSelection = resolveRuntimeProviderSelection({
      requestedProvider: requestedDefaults.provider as ChatDefaultProvider,
      requestedModel,
      codex: {
        available: codex.available,
        models: capabilities.models.map((entry) => entry.model),
        reason: codex.reason ?? 'codex unavailable',
      },
      copilot: {
        available: copilot.available,
        models: copilot.models,
        reason: copilot.reason,
      },
      lmstudio: {
        available: lmstudioModels.length > 0,
        models: lmstudioModels,
        reason: lmstudioReason,
      },
    });

    const codexWarnings = [...capabilities.warnings];
    if (
      capabilities.defaults.webSearchEnabled &&
      !(codex.available && mcp.available)
    ) {
      codexWarnings.push(
        'Codex web search is enabled, but tools are unavailable; web search will be ignored.',
      );
    }
    const codexConfigWarnings: string[] = [];
    const codexDefaults = buildCodexCompatibilityDefaults({
      capabilities,
      codexHome: process.env.CODEX_HOME,
      warnings: codexConfigWarnings,
    });
    codexWarnings.push(...codexConfigWarnings);
    const lmstudioAgentFlags = buildLmStudioAgentFlags({});
    const providerMap = {
      copilot: buildProviderInfo({
        provider: 'copilot',
        available: copilot.available,
        toolsAvailable: copilot.toolsAvailable,
        reason: copilot.reason,
        copilotHome: process.env.CODEINFO_COPILOT_HOME,
        warnings: [
          ...(copilot.reason ? [copilot.reason] : []),
          ...copilotAgentFlags.warnings,
        ],
        modelMetadata: {
          defaultModel: copilotModelMetadata.defaultModel,
          defaultModelSource: copilotModelMetadata.defaultModelSource,
          warnings: copilotModelMetadata.warnings,
        },
        agentFlags: copilotAgentFlags.agentFlags,
      }),
      lmstudio: buildProviderInfo({
        provider: 'lmstudio',
        available: lmstudioModels.length > 0,
        toolsAvailable: lmstudioModels.length > 0,
        reason: lmstudioReason,
        lmstudioHome: process.env.CODEINFO_LMSTUDIO_HOME,
        warnings: [
          ...(lmstudioReason ? [lmstudioReason] : []),
          ...lmstudioAgentFlags.warnings,
        ],
        agentFlags: lmstudioAgentFlags.agentFlags,
      }),
      codex: buildProviderInfo({
        provider: 'codex',
        available: codex.available,
        toolsAvailable: codex.available && mcp.available,
        reason: codex.reason ?? (mcp.available ? undefined : mcp.reason),
        codexHome: process.env.CODEX_HOME,
        warnings: codexWarnings,
        agentFlags: buildCodexAgentFlags({
          capabilities,
          codexHome: process.env.CODEX_HOME,
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
        available: codex.available,
        toolsAvailable: codex.available && mcp.available,
        codexReason: codex.reason,
        copilotAvailable: copilot.available,
        copilotToolsAvailable: copilot.toolsAvailable,
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
    console.info(STORY_47_TASK_1_LOG_MARKER, {
      surface: '/chat/providers',
      requested_provider: runtimeSelection.requestedProvider,
      requested_model: runtimeSelection.requestedModel,
      resolved_model: runtimeSelection.executionModel,
      ordered_provider_contract: ORDERED_CHAT_PROVIDER_CONTRACT,
      model_source:
        requestedDefaults.provider === 'codex'
          ? toChatResolutionSource(
              codexRequestedDefaults?.sources.model ?? 'hardcoded',
            )
          : requestedDefaults.modelSource,
      codex_model_source:
        requestedDefaults.provider === 'codex'
          ? (codexRequestedDefaults?.sources.model ?? 'hardcoded')
          : undefined,
      success: true,
      warning_count: codexWarnings.length,
    });
    console.info(TASK7_LOG_MARKER, {
      surface: '/chat/providers',
      provider: 'codex',
      warningCount: codexWarnings.length,
      defaults: codexDefaults,
    });

    res.json(response);
  });

  return router;
}
