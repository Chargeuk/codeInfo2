import { ORDERED_CHAT_PROVIDER_IDS, isChatProviderId } from '@codeinfo2/common';
import type {
  ApprovalMode,
  ModelReasoningEffort,
  SandboxMode,
} from '@openai/codex-sdk';
import { isSupportedAgentFlagKey } from '../chat/agentFlags.js';
import {
  loadProviderConfigForAgentFlags,
  parseOptionalConfigString,
  ProviderRuntimeFlagError,
  resolveCopilotRuntimeAgentFlags,
  resolveLmStudioRuntimeAgentFlags,
} from '../chat/providerRuntimeFlags.js';
import {
  getCodexCapabilityForModel,
  resolveCodexCapabilities,
  type CodexCapabilityResolution,
} from '../codex/capabilityResolver.js';
import {
  buildDefaultsAppliedMarkerPayload,
  resolveChatDefaults,
  resolveCodexChatDefaults,
  ChatDefaultsResolutionError,
  STORY_47_TASK_1_LOG_MARKER,
  toChatResolutionSource,
  toCodexDefaultSource,
  type ChatDefaultProvider,
} from '../config/chatDefaults.js';
import { normalizeOpenAiCompatEndpointId } from '../config/openaiCompatEndpoints.js';
import { getProviderBootstrapStatus } from '../config/runtimeConfig.js';
import { baseLogger } from '../logger.js';
import { getScopedEnvValue } from '../test/support/testEnvOverrideScope.js';
import { validateRequestedWorkingFolder } from '../workingFolders/state.js';

type Provider = (typeof ORDERED_CHAT_PROVIDER_IDS)[number];

export type ChatRequestBody = {
  model?: unknown;
  message?: unknown;
  conversationId?: unknown;
  messages?: unknown;
  provider?: unknown;
  endpointId?: unknown;
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
  endpointId?: string;
  threadId?: string;
  inflightId?: string;
  working_folder?: string;
  rawAgentFlags: Record<string, unknown>;
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
  readonly code: 'VALIDATION_FAILED' | 'PROVIDER_UNAVAILABLE';

  constructor(
    message: string,
    code: 'VALIDATION_FAILED' | 'PROVIDER_UNAVAILABLE' = 'VALIDATION_FAILED',
  ) {
    super(message);
    this.name = 'ChatValidationError';
    this.code = code;
  }
}

const normalizeEndpointIdValidationMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^RUNTIME_CONFIG_INVALID:\s*endpointId:\s*/, '');
};

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
export const codexReasoningSummaries = [
  'auto',
  'concise',
  'detailed',
  'none',
] as const;
export const codexVerbosityLevels = ['low', 'medium', 'high'] as const;
export const codexWebSearchModes = ['disabled', 'cached', 'live'] as const;
const LEGACY_TOP_LEVEL_FLAG_KEYS = [
  'sandboxMode',
  'networkAccessEnabled',
  'webSearchEnabled',
  'approvalPolicy',
  'modelReasoningEffort',
] as const;

const TASK7_LOG_MARKER = 'DEV_0000040_T07_REST_DEFAULTS_APPLIED';
const PROVIDER_VALIDATION_MESSAGE = `provider must be one of: ${ORDERED_CHAT_PROVIDER_IDS.join(', ')}`;
const DEFAULT_CODEX_REASONING_SUMMARY = 'auto';
const DEFAULT_CODEX_VERBOSITY = 'medium';

const parseBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new ChatValidationError(`${field} must be a boolean`);
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

const resolveCopilotAgentFlags = (
  rawAgentFlags: Record<string, unknown>,
): Record<string, unknown> => {
  validateNoUnsupportedAgentFlags('copilot', rawAgentFlags);
  try {
    return resolveCopilotRuntimeAgentFlags(rawAgentFlags);
  } catch (error) {
    if (error instanceof ProviderRuntimeFlagError) {
      throw new ChatValidationError(error.message);
    }
    throw error;
  }
};

const resolveLmStudioAgentFlags = (
  rawAgentFlags: Record<string, unknown>,
): Record<string, unknown> => {
  validateNoUnsupportedAgentFlags('lmstudio', rawAgentFlags);
  try {
    return resolveLmStudioRuntimeAgentFlags(rawAgentFlags);
  } catch (error) {
    if (error instanceof ProviderRuntimeFlagError) {
      throw new ChatValidationError(error.message);
    }
    throw error;
  }
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
  const codexHome =
    getScopedEnvValue('CODEINFO_CODEX_HOME') ?? getScopedEnvValue('CODEX_HOME');
  const defaults = await resolveCodexChatDefaults({
    codexHome,
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

export async function resolveChatAgentFlagsForProvider(params: {
  provider: Provider;
  rawAgentFlags: Record<string, unknown>;
  model: string;
  codexCapabilities?: CodexCapabilityResolution;
  codexCapabilityResolver?: (options: {
    consumer: 'chat_models' | 'chat_validation';
  }) => Promise<CodexCapabilityResolution>;
}): Promise<{
  agentFlags: Record<string, unknown>;
  warnings: string[];
}> {
  if (params.provider === 'codex') {
    const codexCapabilities =
      params.codexCapabilities ??
      (await (params.codexCapabilityResolver ?? resolveCodexCapabilities)({
        consumer: 'chat_validation',
      }));
    const selectedModelCapability = getCodexCapabilityForModel(
      codexCapabilities,
      params.model,
    );
    return {
      agentFlags: await resolveCodexAgentFlags({
        rawAgentFlags: params.rawAgentFlags,
        model: params.model,
        codexCapabilities,
        selectedModelCapability,
      }),
      warnings: [...codexCapabilities.warnings],
    };
  }

  if (params.provider === 'copilot') {
    return {
      agentFlags: resolveCopilotAgentFlags(params.rawAgentFlags),
      warnings: [],
    };
  }

  return {
    agentFlags: resolveLmStudioAgentFlags(params.rawAgentFlags),
    warnings: [],
  };
}

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
          codexHome:
            getScopedEnvValue('CODEINFO_CODEX_HOME') ??
            getScopedEnvValue('CODEX_HOME'),
        })
      : undefined;
  const model =
    provider === 'codex' && requestedModel === undefined
      ? (codexRequestedDefaults?.values.model ?? resolvedDefaults.model)
      : resolvedDefaults.model;

  const rawEndpointId = body.endpointId;
  let endpointId: string | undefined;
  if (rawEndpointId !== undefined) {
    if (typeof rawEndpointId !== 'string' || rawEndpointId.trim().length === 0) {
      throw new ChatValidationError('endpointId must be a non-empty string');
    }
    try {
      endpointId = normalizeOpenAiCompatEndpointId(rawEndpointId, {
        pathLabel: 'endpointId',
      });
    } catch (error) {
      throw new ChatValidationError(
        `endpointId is invalid: ${normalizeEndpointIdValidationMessage(error)}`,
      );
    }
  }
  if (endpointId && provider === 'lmstudio') {
    throw new ChatValidationError(
      'endpointId is not supported for provider "lmstudio"',
    );
  }

  const warnings: string[] = [...resolvedDefaults.warnings];
  const bootstrapStatus = getProviderBootstrapStatus(provider);
  if (bootstrapStatus.warnings.length > 0) {
    warnings.push(...bootstrapStatus.warnings);
  }
  if (!bootstrapStatus.healthy && requestedProvider !== undefined) {
    throw new ChatValidationError(
      bootstrapStatus.reason ??
        `Provider "${provider}" is unavailable because startup bootstrap degraded.`,
      'PROVIDER_UNAVAILABLE',
    );
  }
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
  if (threadId && requestedProvider !== undefined && provider !== 'codex') {
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
  const resolvedAgentFlags = await resolveChatAgentFlagsForProvider({
    provider,
    rawAgentFlags,
    model,
    codexCapabilityResolver: options?.codexCapabilityResolver,
  });
  warnings.push(...resolvedAgentFlags.warnings);
  const agentFlags = resolvedAgentFlags.agentFlags;

  console.info(
    STORY_47_TASK_1_LOG_MARKER,
    buildDefaultsAppliedMarkerPayload({
      surface: 'chat_validation',
      requestedProvider: (requestedProvider ?? provider) as ChatDefaultProvider,
      requestedModel: requestedModel ?? model,
      resolvedModel: model,
      modelSource,
      codexModelSource:
        provider === 'codex' ? toCodexDefaultSource(modelSource) : undefined,
      warnings,
      extras: {
        defaultedFlags: Object.keys(agentFlags).filter(
          (key) => rawAgentFlags[key] === undefined,
        ),
      },
    }),
  );
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
    endpointId,
    threadId,
    inflightId,
    working_folder,
    rawAgentFlags,
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
