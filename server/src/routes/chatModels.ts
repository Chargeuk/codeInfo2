import type { ChatModelInfo, ChatModelsResponse } from '@codeinfo2/common';
import type { LMStudioClient } from '@lmstudio/sdk';
import { Router } from 'express';
import {
  getCodexEnvDefaults,
  getCodexModelList,
} from '../config/codexEnvDefaults.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';
import { getCodexDetection } from '../providers/codexRegistry.js';
import { getMcpStatus } from '../providers/mcpStatus.js';

type ClientFactory = (baseUrl: string) => LMStudioClient;
const BASE_URL_REGEX = /^(https?|wss?):\/\//i;

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

export function createChatModelsRouter({
  clientFactory,
}: {
  clientFactory: ClientFactory;
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
      const codexEnv = getCodexEnvDefaults();
      const modelList = getCodexModelList();
      const toolsAvailable = detection.available && mcp.available;
      const runtimeWarnings: string[] = [];

      if (codexEnv.defaults.webSearchEnabled && !toolsAvailable) {
        runtimeWarnings.push(
          'Codex web search is enabled, but tools are unavailable; web search will be ignored.',
        );
      }

      const codexWarnings = [
        ...modelList.warnings,
        ...codexEnv.warnings,
        ...runtimeWarnings,
      ];
      const codexModels: ChatModelInfo[] = modelList.models.map((model) => ({
        key: model,
        displayName: model,
        type: 'codex',
      }));

      baseLogger.info(
        {
          modelCount: modelList.models.length,
          fallbackUsed: modelList.fallbackUsed,
          warningsCount: modelList.warnings.length,
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
        codexDefaults: codexEnv.defaults,
        codexWarnings,
      };

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
      const mapped: ChatModelInfo[] = models
        .filter(isChatModel)
        .map((model) => ({
          key: model.modelKey,
          displayName: model.displayName,
          type: model.type,
        }));

      const response: ChatModelsResponse = {
        provider: 'lmstudio',
        available: true,
        toolsAvailable: true,
        models: mapped,
      };

      append({
        level: 'info',
        message: 'chat models fetch success',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: { baseUrl: safeBase, models: mapped.length },
      });
      baseLogger.info(
        { requestId, baseUrl: safeBase, models: mapped.length },
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
