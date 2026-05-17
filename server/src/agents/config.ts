import type { ChatProviderId } from '@codeinfo2/common';
import {
  extractRuntimeConfigAppMetadata,
  readAndNormalizeRuntimeTomlConfig,
  RuntimeConfigResolutionError,
  resolveAgentRuntimeConfig,
  validateRuntimeConfig,
  type RuntimeTomlConfig,
} from '../config/runtimeConfig.js';

const T05_SUCCESS_LOG =
  '[DEV-0000037][T05] event=shared_runtime_resolver_used_by_entrypoints result=success';
const T05_ERROR_LOG =
  '[DEV-0000037][T05] event=shared_runtime_resolver_used_by_entrypoints result=error';

export type AgentRuntimeExecutionConfig = {
  runtimeConfig: RuntimeTomlConfig;
  modelId?: string;
  providerId: ChatProviderId;
  requestedProviderId?: string;
  warnings: string[];
};

export type AgentRequestedProviderMetadata = {
  providerId: ChatProviderId;
  requestedProviderId?: string;
  warnings: string[];
};

const isChatProviderId = (value: string): value is ChatProviderId =>
  value === 'codex' || value === 'copilot' || value === 'lmstudio';

export async function readAgentRequestedProviderMetadata(params: {
  configPath: string;
}): Promise<AgentRequestedProviderMetadata> {
  const rawAgentConfig = await readAndNormalizeRuntimeTomlConfig(
    params.configPath,
    { required: true },
  );
  const warnings: { path: string; message: string }[] = [];
  const requestedProviderId = rawAgentConfig
    ? extractRuntimeConfigAppMetadata({
        config: rawAgentConfig,
        surface: 'agent',
        warnings,
        pathLabel: params.configPath,
      }).codeinfoProvider
    : undefined;
  const providerId =
    requestedProviderId && isChatProviderId(requestedProviderId)
      ? requestedProviderId
      : 'codex';
  const sanitizedAgentConfig = Object.fromEntries(
    Object.entries(rawAgentConfig ?? {}).filter(
      ([key]) => !key.startsWith('codeinfo_'),
    ),
  ) as RuntimeTomlConfig;
  let validatedAgentConfig;
  try {
    validatedAgentConfig = validateRuntimeConfig(sanitizedAgentConfig, {
      pathLabel: 'agent',
    });
  } catch (error) {
    if (error instanceof RuntimeConfigResolutionError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new RuntimeConfigResolutionError({
      code: 'RUNTIME_CONFIG_VALIDATION_FAILED',
      configPath: params.configPath,
      surface: 'agent',
      message: `RUNTIME_CONFIG_VALIDATION_FAILED: ${message}`,
    });
  }
  return {
    providerId,
    requestedProviderId,
    warnings: [
      ...warnings.map((warning) => warning.message),
      ...validatedAgentConfig.warnings.map((warning) => warning.message),
    ],
  };
}

export async function resolveAgentRuntimeExecutionConfig(params: {
  configPath: string;
  entrypoint: 'agents.service' | 'flows.service';
  codexHome?: string;
}): Promise<AgentRuntimeExecutionConfig> {
  try {
    const requestedMetadata = await readAgentRequestedProviderMetadata({
      configPath: params.configPath,
    });
    const { config, warnings } = await resolveAgentRuntimeConfig({
      provider: requestedMetadata.providerId,
      codexHome: params.codexHome,
      agentConfigPath: params.configPath,
    });
    const modelId =
      typeof config.model === 'string' && config.model.trim().length > 0
        ? config.model.trim()
        : undefined;
    console.info(T05_SUCCESS_LOG, {
      entrypoint: params.entrypoint,
      configPath: params.configPath,
      hasModelId: Boolean(modelId),
      providerId: requestedMetadata.providerId,
      requestedProviderId: requestedMetadata.requestedProviderId,
    });
    return {
      runtimeConfig: config,
      modelId,
      providerId: requestedMetadata.providerId,
      requestedProviderId: requestedMetadata.requestedProviderId,
      warnings: [
        ...requestedMetadata.warnings,
        ...warnings.map((warning) => warning.message),
      ],
    };
  } catch (error) {
    const code =
      error instanceof RuntimeConfigResolutionError
        ? error.code
        : 'UNKNOWN_ERROR';
    console.error(
      `${T05_ERROR_LOG} entrypoint=${params.entrypoint} code=${code}`,
    );
    throw error;
  }
}
