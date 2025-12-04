import type { ChatProviderInfo } from '@codeinfo2/common';
import { Router } from 'express';
import { getCodexDetection } from '../providers/codexRegistry.js';

export function createChatProvidersRouter() {
  const router = Router();

  router.get('/providers', (_req, res) => {
    const codex = getCodexDetection();

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
        toolsAvailable: false,
        reason: codex.reason,
      },
    ];

    res.json({ providers });
  });

  return router;
}
