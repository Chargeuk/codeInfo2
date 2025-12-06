import type { ChatProviderInfo } from '@codeinfo2/common';
import { Router } from 'express';
import { baseLogger } from '../logger.js';
import { getCodexDetection } from '../providers/codexRegistry.js';
import { getMcpStatus } from '../providers/mcpStatus.js';

export function createChatProvidersRouter() {
  const router = Router();

  router.get('/providers', async (_req, res) => {
    const codex = getCodexDetection();
    const mcp = await getMcpStatus();

    const providers: ChatProviderInfo[] = [
      {
        id: 'lmstudio',
        label: 'LM Studio',
        available: true,
        toolsAvailable: true,
      },
      {
        id: 'codex',
        label: 'OpenAI Codex',
        available: codex.available,
        toolsAvailable: codex.available && mcp.available,
        reason: codex.reason ?? (mcp.available ? undefined : mcp.reason),
      },
    ];

    baseLogger.info(
      {
        provider: 'codex',
        available: codex.available,
        toolsAvailable: codex.available && mcp.available,
        codexReason: codex.reason,
        mcpAvailable: mcp.available,
        mcpReason: mcp.reason,
      },
      'chat providers resolved',
    );

    res.json({ providers });
  });

  return router;
}
