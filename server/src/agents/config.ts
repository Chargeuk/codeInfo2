import fs from 'node:fs/promises';

export async function readAgentModelId(
  configPath: string,
): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch {
    return undefined;
  }

  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^\s*model\s*=\s*(['"])(.*?)\1\s*(#.*)?$/u);
    if (!match) continue;

    const modelId = (match[2] ?? '').trim();
    if (!modelId) return undefined;
    return modelId;
  }

  return undefined;
}
