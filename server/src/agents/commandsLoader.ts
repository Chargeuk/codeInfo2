import fs from 'node:fs/promises';
import path from 'node:path';

import type { AgentCommandFile } from './commandsSchema.js';
import { parseAgentCommandFile } from './commandsSchema.js';

const INVALID_DESCRIPTION = 'Invalid command file';

export async function loadAgentCommandFile(params: {
  filePath: string;
}): Promise<{ ok: true; command: AgentCommandFile } | { ok: false }> {
  const jsonText = await fs
    .readFile(params.filePath, 'utf-8')
    .catch(() => null);
  if (!jsonText) return { ok: false };

  return parseAgentCommandFile(jsonText, {
    commandName: path.parse(params.filePath).name,
  });
}

export async function loadAgentCommandSummary(params: {
  filePath: string;
  name: string;
}): Promise<{
  name: string;
  description: string;
  disabled: boolean;
  stepCount: number;
}> {
  const { filePath, name } = params;

  const parsed = await loadAgentCommandFile({ filePath });
  if (!parsed.ok) {
    return {
      name,
      description: INVALID_DESCRIPTION,
      disabled: true,
      stepCount: 1,
    };
  }

  const stepCount = parsed.command.items.length;
  if (!Number.isInteger(stepCount) || stepCount < 1) {
    return {
      name,
      description: INVALID_DESCRIPTION,
      disabled: true,
      stepCount: 1,
    };
  }

  return {
    name,
    description: parsed.command.Description,
    disabled: false,
    stepCount,
  };
}
