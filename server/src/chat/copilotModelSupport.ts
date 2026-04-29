import type { ChatProviderDefaultsSource } from '@codeinfo2/common';
import type { ModelInfo } from '@github/copilot-sdk';

import { loadProviderChatDefaultsSnapshotSync } from '../config/runtimeConfig.js';

const DEFAULT_COPILOT_MODEL = 'copilot-gpt-5';

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeReasoningEfforts = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  const normalized = value
    .map((entry) => normalizeString(entry))
    .filter((entry): entry is string => entry !== undefined);

  return [...new Set(normalized)];
};

const resolveConfiguredCopilotModel = (copilotHome?: string) => {
  const snapshot = loadProviderChatDefaultsSnapshotSync({
    provider: 'copilot',
    copilotHome,
  });
  return normalizeString(snapshot.config?.model);
};

export type CopilotResolvedDefaultModel = {
  defaultModel: string;
  defaultModelSource: ChatProviderDefaultsSource;
  warnings: string[];
};

export function listRunnableCopilotModelKeys(models: ModelInfo[]): string[] {
  const keys: string[] = [];

  for (const model of models) {
    const key = normalizeString(model.id);
    const displayName = normalizeString(model.name);
    if (!key || !displayName) continue;
    if (!keys.includes(key)) {
      keys.push(key);
    }
  }

  return keys;
}

export function findRunnableCopilotModel(
  models: ModelInfo[],
  requestedModel: string | undefined,
): string | undefined {
  const runnableModels = listRunnableCopilotModelKeys(models);
  const preferredModel = normalizeString(requestedModel);
  if (preferredModel && runnableModels.includes(preferredModel)) {
    return preferredModel;
  }
  return runnableModels[0];
}

export function resolveCopilotDefaultModel(params: {
  models: ModelInfo[];
  copilotHome?: string;
}): CopilotResolvedDefaultModel {
  const warnings: string[] = [];
  let configuredModel: string | undefined;

  try {
    configuredModel = resolveConfiguredCopilotModel(params.copilotHome);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warnings.push(
      `copilot/chat/config.toml could not be used for default model resolution (${reason}).`,
    );
  }

  const requestedModel = configuredModel ?? DEFAULT_COPILOT_MODEL;
  const resolvedModel =
    findRunnableCopilotModel(params.models, requestedModel) ?? requestedModel;

  if (resolvedModel !== requestedModel) {
    warnings.push(
      `Copilot default model "${requestedModel}" is unavailable in the live SDK model list; normalized to "${resolvedModel}".`,
    );
  }

  return {
    defaultModel: resolvedModel,
    defaultModelSource: configuredModel ? 'config' : 'hardcoded',
    warnings,
  };
}

export function normalizeImplicitCopilotRequestedModel(params: {
  models: ModelInfo[];
  requestedModel: string;
  requestedModelSource: 'request' | 'config' | 'env' | 'fallback';
}): string {
  if (params.requestedModelSource === 'request') {
    return params.requestedModel;
  }
  return (
    findRunnableCopilotModel(params.models, params.requestedModel) ??
    params.requestedModel
  );
}

export function copilotModelSupportsReasoningEffort(
  models: ModelInfo[],
  model: string,
): boolean {
  const targetModel = normalizeString(model);
  if (!targetModel) return false;

  const matchedModel = models.find(
    (entry) => normalizeString(entry.id) === targetModel,
  );
  if (!matchedModel) return false;

  const supportedReasoningEfforts = normalizeReasoningEfforts(
    matchedModel.supportedReasoningEfforts,
  );
  if (supportedReasoningEfforts.length > 0) {
    return true;
  }

  return normalizeString(matchedModel.defaultReasoningEffort) !== undefined;
}
