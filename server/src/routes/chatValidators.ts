import { ORDERED_CHAT_PROVIDER_IDS, isChatProviderId } from '@codeinfo2/common';
import type {
  ApprovalMode,
  ModelReasoningEffort,
  SandboxMode,
} from '@openai/codex-sdk';
import { isSupportedAgentFlagKey } from '../chat/agentFlags.js';
import {
  getCodexCapabilityForModel,
  resolveCodexCapabilities,
  type CodexCapabilityResolution,
} from '../codex/capabilityResolver.js';
import {
  resolveChatDefaults,
  resolveCodexChatDefaults,
  ChatDefaultsResolutionError,
  STORY_47_TASK_1_LOG_MARKER,
  toChatResolutionSource,
  toCodexDefaultSource,
  type ChatDefaultProvider,
} from '../config/chatDefaults.js';
import { loadProviderChatDefaultsSnapshotSync } from '../config/runtimeConfig.js';
import { baseLogger } from '../logger.js';
import { validateRequestedWorkingFolder } from '../workingFolders/state.js';

type Provider = (typeof ORDERED_CHAT_PROVIDER_IDS)[number];

export type ChatRequestBody = {
  model?: unknown;
  message?: unknown;
  conversationId?: unknown;
  messages?: unknown;
  provider?: unknown;
  threadId?: unknown;
  inflightId?: unknown;
  agentFlags?: unknown;
  working_folder?: unknown;
};

export type ValidatedChatRequest = {
  model: string;
  message: string;
  conversationId: string;
  provider: Provider;
  threadId?: string;
  inflightId?: string;
  working_folder?: string;
  agentFlags: Record<string, unknown>;
  warnings: string[];
  defaultsResolution: {
    providerSource: 'request' | 'config' | 'env' | 'fallback';
    modelSource: 'request' | 'config' | 'env' | 'fallback';
    requestedProvider?: Provider;
    requestedModel?: string;
  };
};

export class ChatValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatValidationError';
  }
}

const validateRawTextInput = (params: {
  field: 'message';
  value: unknown;
  requiredMessage: string;
}) => {
  const { field, value, requiredMessage } = params;
  const isString = typeof value === 'string';
  const hasNonWhitespace = isString && value.trim().length > 0;

  baseLogger.info(
    {
      field,
      isString,
      hasNonWhitespace,
      rawLength: isString ? value.length : undefined,
    },
    'DEV-0000035:T3:raw_input_validation_evaluated',
  );

  if (!hasNonWhitespace) {
    baseLogger.info(
      {
        field,
        accepted: false,
        message: requiredMessage,
      },
      'DEV-0000035:T3:raw_input_validation_result',
    );
    throw new ChatValidationError(requiredMessage);
  }

  baseLogger.info(
    {
      field,
      accepted: true,
      rawLength: (value as string).length,
    },
    'DEV-0000035:T3:raw_input_validation_result',
  );
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const sandboxModes: SandboxMode[] = [
  'read-only',
  'workspace-write',
  'danger-full-access',
] as SandboxMode[];

export const approvalPolicies: ApprovalMode[] = [
  'never',
  'on-request',
  'untrusted',
] as ApprovalMode[];

export const modelReasoningEfforts = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly ModelReasoningEffort[];
export const copilotReasoningEfforts = ['low', 'medium', 'high'] as const;
export const codexReasoningSummaries = [
  'auto',
  'concise',
  'detailed',
  'none',
] as const;
export const codexVerbosityLevels = ['low', 'medium', 'high'] as const;
export const codexWebSearchModes = ['disabled', 'cached', 'live'] as const;
export const lmStudioContextOverflowPolicies = [
  'stopAtLimit',
  'truncateMiddle',
  'rollingWindow',
] as const;
export const toolAccessModes = ['on', 'off'] as const;
const LEGACY_TOP_LEVEL_FLAG_KEYS = [
  'sandboxMode',
  'networkAccessEnabled',
  'webSearchEnabled',
  'approvalPolicy',
  'modelReasoningEffort',
] as const;

const TASK7_LOG_MARKER = 'DEV_0000040_T07_REST_DEFAULTS_APPLIED';
const PROVIDER_VALIDATION_MESSAGE = `provider must be one of: ${ORDERED_CHAT_PROVIDER_IDS.join(', ')}`;
const DEFAULT_COPILOT_REASONING_EFFORT = 'medium';
const DEFAULT_COPILOT_TOOL_ACCESS = 'on';
const DEFAULT_LMSTUDIO_TEMPERATURE = 0.2;
const DEFAULT_LMSTUDIO_MAX_TOKENS = 4096;
const DEFAULT_LMSTUDIO_CONTEXT_OVERFLOW_POLICY = 'truncateMiddle';
const DEFAULT_LMSTUDIO_TOOL_ACCESS = 'on';
const DEFAULT_CODEX_REASONING_SUMMARY = 'auto';
const DEFAULT_CODEX_VERBOSITY = 'medium';

const parseBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new ChatValidationError(`${field} must be a boolean`);
  }
  return value;
};

const parseFiniteNumber = (
  value: unknown,
  field: string,
  options?: { min?: number; max?: number; integer?: boolean },
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ChatValidationError(`${field} must be a number`);
  }
  if (options?.integer && !Number.isInteger(value)) {
    throw new ChatValidationError(`${field} must be an integer`);
  }
  if (options?.min !== undefined && value < options.min) {
    throw new ChatValidationError(`${field} must be at least ${options.min}`);
  }
  if (options?.max !== undefined && value > options.max) {
    throw new ChatValidationError(`${field} must be at most ${options.max}`);
  }
  return value;
};

const parseChoice = <T extends string>(
  value: unknown,
  field: string,
  choices: readonly T[],
): T => {
  if (typeof value !== 'string') {
    throw new ChatValidationError(
      `${field} must be one of: ${choices.join(', ')}`,
    );
  }
  const trimmed = value.trim();
  if (!trimmed || !choices.includes(trimmed as T)) {
    throw new ChatValidationError(
      `${field} must be one of: ${choices.join(', ')}`,
    );
  }
  return trimmed as T;
};

const parseOptionalConfigString = <T extends string>(
  value: unknown,
  choices: readonly T[],
): T | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return choices.includes(trimmed as T) ? (trimmed as T) : undefined;
};

const parseOptionalPositiveInteger = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return value;
};

const parseOptionalFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const normalizeAgentFlagsObject = (
  rawAgentFlags: unknown,
): Record<string, unknown> => {
  if (rawAgentFlags === undefined) return {};
  if (!isPlainObject(rawAgentFlags)) {
    throw new ChatValidationError('agentFlags must be an object');
  }
  return rawAgentFlags;
};

const validateNoLegacyTopLevelFlags = (body: Record<string, unknown>) => {
  for (const key of LEGACY_TOP_LEVEL_FLAG_KEYS) {
    if (body[key] !== undefined) {
      throw new ChatValidationError(
        `legacy top-level chat flag "${key}" is no longer supported; use agentFlags.${key}`,
      );
    }
  }
};

const validateNoUnsupportedAgentFlags = (
  provider: Provider,
  agentFlags: Record<string, unknown>,
) => {
  for (const key of Object.keys(agentFlags)) {
    if (!isSupportedAgentFlagKey(provider, key)) {
      throw new ChatValidationError(
        `agentFlags.${key} is not supported for provider "${provider}"`,
      );
    }
  }
};

const loadProviderConfigForAgentFlags = (
  provider: Provider,
): Record<string, unknown> => {
  try {
    const snapshot = loadProviderChatDefaultsSnapshotSync({ provider });
    return snapshot.config ?? {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ChatValidationError(
      `${provider}/chat/config.toml could not be loaded for agentFlags resolution (${message})`,
    );
  }
};

const resolveCopilotAgentFlags = (
  rawAgentFlags: Record<string, unknown>,
): Record<string, unknown> => {
  validateNoUnsupportedAgentFlags('copilot', rawAgentFlags);
  const config = loadProviderConfigForAgentFlags('copilot');
  const configReasoningEffort =
    parseOptionalConfigString(
      config.reasoning_effort,
      copilotReasoningEfforts,
    ) ?? DEFAULT_COPILOT_REASONING_EFFORT;
  const configToolAccess =
    parseOptionalConfigString(config.tool_access, toolAccessModes) ??
    DEFAULT_COPILOT_TOOL_ACCESS;

  const agentFlags: Record<string, unknown> = {
    modelReasoningEffort:
      rawAgentFlags.modelReasoningEffort !== undefined
        ? parseChoice(
            rawAgentFlags.modelReasoningEffort,
            'agentFlags.modelReasoningEffort',
            copilotReasoningEfforts,
          )
        : configReasoningEffort,
    toolAccess:
      rawAgentFlags.toolAccess !== undefined
        ? parseChoice(
            rawAgentFlags.toolAccess,
            'agentFlags.toolAccess',
            toolAccessModes,
          )
        : configToolAccess,
  };

  return agentFlags;
};

const resolveLmStudioAgentFlags = (
  rawAgentFlags: Record<string, unknown>,
): Record<string, unknown> => {
  validateNoUnsupportedAgentFlags('lmstudio', rawAgentFlags);
  const config = loadProviderConfigForAgentFlags('lmstudio');
  const configTemperature =
    parseOptionalFiniteNumber(config.temperature) ??
    DEFAULT_LMSTUDIO_TEMPERATURE;
  const configMaxTokens =
    parseOptionalPositiveInteger(config.max_tokens) ??
    DEFAULT_LMSTUDIO_MAX_TOKENS;
  const configContextOverflowPolicy =
    parseOptionalConfigString(
      config.context_overflow_policy,
      lmStudioContextOverflowPolicies,
    ) ?? DEFAULT_LMSTUDIO_CONTEXT_OVERFLOW_POLICY;
  const configToolAccess =
    parseOptionalConfigString(config.tool_access, toolAccessModes) ??
    DEFAULT_LMSTUDIO_TOOL_ACCESS;

  return {
    temperature:
      rawAgentFlags.temperature !== undefined
        ? parseFiniteNumber(
            rawAgentFlags.temperature,
            'agentFlags.temperature',
            {
              min: 0,
              max: 2,
            },
          )
        : configTemperature,
    maxTokens:
      rawAgentFlags.maxTokens !== undefined
        ? parseFiniteNumber(rawAgentFlags.maxTokens, 'agentFlags.maxTokens', {
            min: 1,
            integer: true,
          })
        : configMaxTokens,
    contextOverflowPolicy:
      rawAgentFlags.contextOverflowPolicy !== undefined
        ? parseChoice(
            rawAgentFlags.contextOverflowPolicy,
            'agentFlags.contextOverflowPolicy',
            lmStudioContextOverflowPolicies,
          )
        : configContextOverflowPolicy,
    toolAccess:
      rawAgentFlags.toolAccess !== undefined
        ? parseChoice(
            rawAgentFlags.toolAccess,
            'agentFlags.toolAccess',
            toolAccessModes,
          )
        : configToolAccess,
  };
};

const resolveCodexAgentFlags = async (params: {
  rawAgentFlags: Record<string, unknown>;
  model: string;
  codexCapabilities: CodexCapabilityResolution;
  selectedModelCapability?:
    | ReturnType<typeof getCodexCapabilityForModel>
    | undefined;
}): Promise<Record<string, unknown>> => {
  validateNoUnsupportedAgentFlags('codex', params.rawAgentFlags);
  const defaults = await resolveCodexChatDefaults({
    codexHome: process.env.CODEX_HOME,
  });
  const config = loadProviderConfigForAgentFlags('codex');
  const supportedReasoningEfforts =
    params.selectedModelCapability?.supportedReasoningEfforts ??
    modelReasoningEfforts;

  return {
    sandboxMode:
      params.rawAgentFlags.sandboxMode !== undefined
        ? parseChoice(
            params.rawAgentFlags.sandboxMode,
            'agentFlags.sandboxMode',
            sandboxModes,
          )
        : defaults.values.sandboxMode,
    approvalPolicy:
      params.rawAgentFlags.approvalPolicy !== undefined
        ? parseChoice(
            params.rawAgentFlags.approvalPolicy,
            'agentFlags.approvalPolicy',
            approvalPolicies,
          )
        : defaults.values.approvalPolicy === 'on-failure'
          ? 'on-request'
          : defaults.values.approvalPolicy,
    modelReasoningEffort:
      params.rawAgentFlags.modelReasoningEffort !== undefined
        ? parseChoice(
            params.rawAgentFlags.modelReasoningEffort,
            'agentFlags.modelReasoningEffort',
            supportedReasoningEfforts,
          )
        : (params.selectedModelCapability?.defaultReasoningEffort ??
          defaults.values.modelReasoningEffort),
    modelReasoningSummary:
      params.rawAgentFlags.modelReasoningSummary !== undefined
        ? parseChoice(
            params.rawAgentFlags.modelReasoningSummary,
            'agentFlags.modelReasoningSummary',
            codexReasoningSummaries,
          )
        : (parseOptionalConfigString(
            config.model_reasoning_summary,
            codexReasoningSummaries,
          ) ?? DEFAULT_CODEX_REASONING_SUMMARY),
    modelVerbosity:
      params.rawAgentFlags.modelVerbosity !== undefined
        ? parseChoice(
            params.rawAgentFlags.modelVerbosity,
            'agentFlags.modelVerbosity',
            codexVerbosityLevels,
          )
        : (parseOptionalConfigString(
            config.model_verbosity,
            codexVerbosityLevels,
          ) ?? DEFAULT_CODEX_VERBOSITY),
    networkAccessEnabled:
      params.rawAgentFlags.networkAccessEnabled !== undefined
        ? parseBoolean(
            params.rawAgentFlags.networkAccessEnabled,
            'agentFlags.networkAccessEnabled',
          )
        : params.codexCapabilities.defaults.networkAccessEnabled,
    webSearchMode:
      params.rawAgentFlags.webSearchMode !== undefined
        ? parseChoice(
            params.rawAgentFlags.webSearchMode,
            'agentFlags.webSearchMode',
            codexWebSearchModes,
          )
        : defaults.values.webSearch,
  };
};

export async function validateChatRequest(
  body: ChatRequestBody | unknown,
  options?: {
    knownRepositoryPathsState?: import('../workingFolders/state.js').KnownRepositoryPathsState;
    codexCapabilityResolver?: (options: {
      consumer: 'chat_models' | 'chat_validation';
    }) => Promise<CodexCapabilityResolution>;
  },
): Promise<ValidatedChatRequest> {
  if (!isPlainObject(body)) {
    throw new ChatValidationError('request body must be an object');
  }

  validateNoLegacyTopLevelFlags(body);

  if (body.messages !== undefined) {
    throw new ChatValidationError(
      'conversationId required; history is loaded server-side',
    );
  }

  const rawModel = body.model;
  let requestedModel: string | undefined;
  if (rawModel !== undefined) {
    if (typeof rawModel !== 'string' || rawModel.trim().length === 0) {
      throw new ChatValidationError('model must be a non-empty string');
    }
    requestedModel = rawModel.trim();
  }

  const message = body.message;
  validateRawTextInput({
    field: 'message',
    value: message,
    requiredMessage:
      'message must contain at least one non-whitespace character',
  });
  const validatedMessage = message as string;

  const conversationId = body.conversationId;
  if (
    typeof conversationId !== 'string' ||
    conversationId.trim().length === 0
  ) {
    throw new ChatValidationError('conversationId is required');
  }

  const rawProvider = body.provider;
  let requestedProvider: Provider | undefined;
  if (rawProvider !== undefined) {
    if (typeof rawProvider !== 'string' || rawProvider.trim().length === 0) {
      throw new ChatValidationError(PROVIDER_VALIDATION_MESSAGE);
    }
    const normalizedProvider = rawProvider.trim();
    if (!isChatProviderId(normalizedProvider)) {
      throw new ChatValidationError(PROVIDER_VALIDATION_MESSAGE);
    }
    requestedProvider = normalizedProvider as Provider;
  }

  let resolvedDefaults;
  try {
    resolvedDefaults = resolveChatDefaults({
      requestProvider: requestedProvider as ChatDefaultProvider | undefined,
      requestModel: requestedModel,
    });
  } catch (error) {
    if (error instanceof ChatDefaultsResolutionError) {
      throw new ChatValidationError(error.message);
    }
    throw error;
  }
  const provider: Provider = resolvedDefaults.provider;
  const codexRequestedDefaults =
    provider === 'codex' && requestedModel === undefined
      ? await resolveCodexChatDefaults({
          codexHome: process.env.CODEX_HOME,
        })
      : undefined;
  const model =
    provider === 'codex' && requestedModel === undefined
      ? (codexRequestedDefaults?.values.model ?? resolvedDefaults.model)
      : resolvedDefaults.model;

  const warnings: string[] = [...resolvedDefaults.warnings];
  const modelSource =
    requestedModel !== undefined
      ? 'request'
      : provider === 'codex' && codexRequestedDefaults
        ? toChatResolutionSource(codexRequestedDefaults.sources.model)
        : resolvedDefaults.modelSource;

  const threadId =
    typeof body.threadId === 'string' && body.threadId.length > 0
      ? body.threadId
      : undefined;
  if (body.threadId !== undefined && threadId === undefined) {
    throw new ChatValidationError('threadId must be a non-empty string');
  }
  if (threadId && provider !== 'codex') {
    throw new ChatValidationError(
      `threadId is not supported for provider "${provider}"`,
    );
  }

  const inflightId =
    typeof body.inflightId === 'string' && body.inflightId.length > 0
      ? body.inflightId
      : undefined;

  if (body.inflightId !== undefined && inflightId === undefined) {
    throw new ChatValidationError('inflightId must be a non-empty string');
  }

  const rawWorkingFolder = body.working_folder;
  if (rawWorkingFolder !== undefined && rawWorkingFolder !== null) {
    if (typeof rawWorkingFolder !== 'string') {
      throw new ChatValidationError('working_folder must be a string');
    }
  }
  let working_folder: string | undefined;
  try {
    working_folder = await validateRequestedWorkingFolder({
      workingFolder:
        typeof rawWorkingFolder === 'string' &&
        rawWorkingFolder.trim().length > 0
          ? rawWorkingFolder
          : undefined,
      knownRepositoryPathsState: options?.knownRepositoryPathsState,
    });
  } catch (error) {
    const err = error as { code?: unknown; reason?: unknown };
    if (
      err.code === 'WORKING_FOLDER_UNAVAILABLE' ||
      err.code === 'WORKING_FOLDER_REPOSITORY_UNAVAILABLE'
    ) {
      throw error;
    }
    throw new ChatValidationError(
      typeof err.reason === 'string'
        ? err.reason
        : 'working_folder validation failed',
    );
  }

  const rawAgentFlags = normalizeAgentFlagsObject(body.agentFlags);
  const codexCapabilities =
    provider === 'codex'
      ? await (options?.codexCapabilityResolver ?? resolveCodexCapabilities)({
          consumer: 'chat_validation',
        })
      : undefined;
  const selectedModelCapability =
    provider === 'codex' && codexCapabilities
      ? getCodexCapabilityForModel(codexCapabilities, model)
      : undefined;
  if (codexCapabilities?.warnings.length) {
    warnings.push(...codexCapabilities.warnings);
  }
  const agentFlags =
    provider === 'codex'
      ? await resolveCodexAgentFlags({
          rawAgentFlags,
          model,
          codexCapabilities:
            codexCapabilities ??
            (await resolveCodexCapabilities({ consumer: 'chat_validation' })),
          selectedModelCapability,
        })
      : provider === 'copilot'
        ? resolveCopilotAgentFlags(rawAgentFlags)
        : resolveLmStudioAgentFlags(rawAgentFlags);

  console.info(STORY_47_TASK_1_LOG_MARKER, {
    surface: 'chat_validation',
    requested_provider: requestedProvider ?? provider,
    requested_model: requestedModel ?? model,
    resolved_model: model,
    model_source: modelSource,
    codex_model_source:
      provider === 'codex' ? toCodexDefaultSource(modelSource) : undefined,
    success: true,
    warning_count: warnings.length,
    defaultedFlags: Object.keys(agentFlags).filter(
      (key) => rawAgentFlags[key] === undefined,
    ),
  });
  console.info(TASK7_LOG_MARKER, {
    surface: 'chat_validation',
    provider,
    warningCount: warnings.length,
    defaultedFlags: Object.keys(agentFlags).filter(
      (key) => rawAgentFlags[key] === undefined,
    ),
    resolvedModel: model,
  });

  return {
    model,
    message: validatedMessage,
    conversationId,
    provider,
    threadId,
    inflightId,
    working_folder,
    agentFlags,
    warnings,
    defaultsResolution: {
      providerSource: resolvedDefaults.providerSource,
      modelSource,
      requestedProvider,
      requestedModel,
    },
  };
}
