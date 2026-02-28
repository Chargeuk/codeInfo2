import { resolveAgentRuntimeConfig } from '../config/runtimeConfig.js';

export async function readAgentModelId(
  configPath: string,
): Promise<string | undefined> {
  const { config } = await resolveAgentRuntimeConfig({
    agentConfigPath: configPath,
  });
  const modelId = config.model;
  if (typeof modelId !== 'string') return undefined;
  const normalized = modelId.trim();
  return normalized || undefined;
}
