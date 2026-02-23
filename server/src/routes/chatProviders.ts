import type { LMStudioClient } from '@lmstudio/sdk';
import type { ChatProviderInfo } from '@codeinfo2/common';
import { Router } from 'express';
import { getCodexModelList } from '../config/codexEnvDefaults.js';
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
}: {
  clientFactory: ClientFactory;
}) {
  const router = Router();

  router.get('/providers', async (_req, res) => {
    const codex = getCodexDetection();
    const mcp = await getMcpStatus();
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
        models: getCodexModelList().models,
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

    res.json({ providers });
  });

  return router;
}
