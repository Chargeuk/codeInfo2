import { type ChatModelsResponse } from '@codeinfo2/common';
import type { LMStudioClient } from '@lmstudio/sdk';
import { Router } from 'express';
import { resolveChatDefaults } from '../config/chatDefaults.js';
import {
  resolveCodexCapabilities,
  type CodexCapabilityResolution,
} from '../codex/capabilityResolver.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';
import { getCodexDetection } from '../providers/codexRegistry.js';
import { getMcpStatus } from '../providers/mcpStatus.js';

type ClientFactory = (baseUrl: string) => LMStudioClient;
const BASE_URL_REGEX = /^(https?|wss?):\/\//i;
const TASK12_LOG_SUCCESS =
  '[DEV-0000037][T12] event=chat_models_codex_capabilities_returned result=success';
const TASK12_LOG_ERROR =
  '[DEV-0000037][T12] event=chat_models_codex_capabilities_returned result=error';

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

export function createChatModelsRouter({
  clientFactory,
  codexCapabilityResolver = resolveCodexCapabilities,
}: {
  clientFactory: ClientFactory;
  codexCapabilityResolver?: (options: {
    consumer: 'chat_models' | 'chat_validation';
  }) => CodexCapabilityResolution;
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
      const capabilities = codexCapabilityResolver({ consumer: 'chat_models' });
      const toolsAvailable = detection.available && mcp.available;
      const runtimeWarnings: string[] = [];

      if (capabilities.defaults.webSearchEnabled && !toolsAvailable) {
        runtimeWarnings.push(
          'Codex web search is enabled, but tools are unavailable; web search will be ignored.',
        );
      }

      const codexWarnings = [...capabilities.warnings, ...runtimeWarnings];
      const preferredDefaults = resolveChatDefaults({});
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
        preferredDefaults.provider === 'codex'
          ? preferredDefaults.model
          : undefined,
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

    const baseUrl = process.env.LMSTUDIO_BASE_URL ?? '';
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
