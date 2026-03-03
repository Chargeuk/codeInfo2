import type { LMStudioClient } from '@lmstudio/sdk';
import type { ChatProviderInfo } from '@codeinfo2/common';
import { Router } from 'express';
import {
  resolveCodexCapabilities,
  type CodexCapabilityResolution,
} from '../codex/capabilityResolver.js';
import {
  resolveChatDefaults,
  resolveRuntimeProviderSelection,
  type ChatDefaultProvider,
} from '../config/chatDefaults.js';
import { baseLogger } from '../logger.js';
import { getCodexDetection } from '../providers/codexRegistry.js';
import { getMcpStatus } from '../providers/mcpStatus.js';
import { BASE_URL_REGEX, scrubBaseUrl } from './lmstudioUrl.js';

type ClientFactory = (baseUrl: string) => LMStudioClient;
const TASK7_LOG_MARKER = 'DEV_0000040_T07_REST_DEFAULTS_APPLIED';

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
}: {
  clientFactory: ClientFactory;
  codexCapabilityResolver?: (options: {
    consumer: 'chat_models' | 'chat_validation';
  }) => Promise<CodexCapabilityResolution>;
}) {
  const router = Router();

  router.get('/providers', async (_req, res) => {
    const codex = getCodexDetection();
    const mcp = await getMcpStatus();
    const capabilities = await codexCapabilityResolver({
      consumer: 'chat_models',
    });
    const baseUrl = process.env.LMSTUDIO_BASE_URL ?? '';
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

    const requestedDefaults = resolveChatDefaults({});
    const runtimeSelection = resolveRuntimeProviderSelection({
      requestedProvider: requestedDefaults.provider as ChatDefaultProvider,
      requestedModel: requestedDefaults.model,
      codex: {
        available: codex.available,
        models: capabilities.models.map((entry) => entry.model),
        reason: codex.reason ?? 'codex unavailable',
      },
      lmstudio: {
        available: lmstudioModels.length > 0,
        models: lmstudioModels,
        reason: lmstudioReason,
      },
    });

    const providerMap: Record<ChatDefaultProvider, ChatProviderInfo> = {
      lmstudio: {
        id: 'lmstudio',
        label: 'LM Studio',
        available: lmstudioModels.length > 0,
        toolsAvailable: lmstudioModels.length > 0,
        reason: lmstudioReason,
      },
      codex: {
        id: 'codex',
        label: 'OpenAI Codex',
        available: codex.available,
        toolsAvailable: codex.available && mcp.available,
        reason: codex.reason ?? (mcp.available ? undefined : mcp.reason),
      },
    };
    const orderedIds: ChatDefaultProvider[] = [
      runtimeSelection.executionProvider,
      runtimeSelection.executionProvider === 'codex' ? 'lmstudio' : 'codex',
    ];
    const providers: ChatProviderInfo[] = orderedIds.map(
      (id) => providerMap[id],
    );

    baseLogger.info(
      {
        requestProvider: runtimeSelection.requestedProvider,
        requestModel: runtimeSelection.requestedModel,
        executionProvider: runtimeSelection.executionProvider,
        executionModel: runtimeSelection.executionModel,
        fallbackApplied: runtimeSelection.fallbackApplied,
        provider: 'codex',
        available: codex.available,
        toolsAvailable: codex.available && mcp.available,
        codexReason: codex.reason,
        mcpAvailable: mcp.available,
        mcpReason: mcp.reason,
        lmstudioAvailable: lmstudioModels.length > 0,
        lmstudioReason,
        lmstudioModelCount: lmstudioModels.length,
        baseUrl: safeBase,
      },
      'chat providers resolved',
    );

    const codexWarnings = [...capabilities.warnings];
    if (
      capabilities.defaults.webSearchEnabled &&
      !(codex.available && mcp.available)
    ) {
      codexWarnings.push(
        'Codex web search is enabled, but tools are unavailable; web search will be ignored.',
      );
    }
    console.info(TASK7_LOG_MARKER, {
      surface: '/chat/providers',
      provider: 'codex',
      warningCount: codexWarnings.length,
      defaults: capabilities.defaults,
    });

    res.json({
      providers,
      codexDefaults: capabilities.defaults,
      codexWarnings,
    });
  });

  return router;
}
