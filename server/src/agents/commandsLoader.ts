import fs from 'node:fs/promises';

import { parseAgentCommandFile } from './commandsSchema.js';

const INVALID_DESCRIPTION = 'Invalid command file';

export async function loadAgentCommandSummary(params: {
  filePath: string;
  name: string;
}): Promise<{ name: string; description: string; disabled: boolean }> {
  const { filePath, name } = params;

  const jsonText = await fs.readFile(filePath, 'utf-8').catch(() => null);
  if (!jsonText) {
    return { name, description: INVALID_DESCRIPTION, disabled: true };
  }

  const parsed = parseAgentCommandFile(jsonText);
  if (!parsed.ok) {
    return { name, description: INVALID_DESCRIPTION, disabled: true };
  }

  return { name, description: parsed.command.Description, disabled: false };
}
