import {
  RuntimeConfigResolutionError,
  resolveAgentRuntimeConfig,
  type RuntimeTomlConfig,
} from '../config/runtimeConfig.js';

const T05_SUCCESS_LOG =
  '[DEV-0000037][T05] event=shared_runtime_resolver_used_by_entrypoints result=success';
const T05_ERROR_LOG =
  '[DEV-0000037][T05] event=shared_runtime_resolver_used_by_entrypoints result=error';

export type AgentRuntimeExecutionConfig = {
  runtimeConfig: RuntimeTomlConfig;
  modelId?: string;
};

export async function resolveAgentRuntimeExecutionConfig(params: {
  configPath: string;
  entrypoint: 'agents.service' | 'flows.service';
  codexHome?: string;
}): Promise<AgentRuntimeExecutionConfig> {
  try {
    const { config } = await resolveAgentRuntimeConfig({
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
    });
    return {
      runtimeConfig: config,
      modelId,
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
