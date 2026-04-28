import type { ChatAgentFlagKey, ChatProviderId } from '@codeinfo2/common';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const PROVIDER_AGENT_FLAG_KEYS: Record<
  ChatProviderId,
  readonly ChatAgentFlagKey[]
> = {
  codex: [
    'sandboxMode',
    'approvalPolicy',
    'modelReasoningEffort',
    'modelReasoningSummary',
    'modelVerbosity',
    'networkAccessEnabled',
    'webSearchMode',
  ],
  copilot: ['modelReasoningEffort', 'toolAccess'],
  lmstudio: ['temperature', 'maxTokens', 'contextOverflowPolicy', 'toolAccess'],
};

const PROVIDER_AGENT_FLAG_KEY_SET: Record<
  ChatProviderId,
  ReadonlySet<ChatAgentFlagKey>
> = {
  codex: new Set(PROVIDER_AGENT_FLAG_KEYS.codex),
  copilot: new Set(PROVIDER_AGENT_FLAG_KEYS.copilot),
  lmstudio: new Set(PROVIDER_AGENT_FLAG_KEYS.lmstudio),
};

export function isSupportedAgentFlagKey(
  provider: ChatProviderId,
  key: string,
): key is ChatAgentFlagKey {
  return PROVIDER_AGENT_FLAG_KEY_SET[provider].has(key as ChatAgentFlagKey);
}

export function sanitizeAgentFlagsForProvider(
  provider: ChatProviderId,
  agentFlags: unknown,
): Record<string, unknown> {
  if (!isPlainObject(agentFlags)) return {};
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(agentFlags)) {
    if (!isSupportedAgentFlagKey(provider, key) || value === undefined) {
      continue;
    }
    next[key] = value;
  }
  return next;
}

export function sanitizeConversationFlagsForProvider(
  provider: ChatProviderId,
  flags: unknown,
  options?: { preserveFlowState?: boolean },
): Record<string, unknown> {
  if (!isPlainObject(flags)) return {};
  const next: Record<string, unknown> = {};

  if (typeof flags.workingFolder === 'string' && flags.workingFolder.trim()) {
    next.workingFolder = flags.workingFolder.trim();
  }

  if (options?.preserveFlowState !== false) {
    if (isPlainObject(flags.flow)) {
      next.flow = flags.flow;
    }
    if (isPlainObject(flags.flowChild)) {
      next.flowChild = flags.flowChild;
    }
  }

  const agentFlags = sanitizeAgentFlagsForProvider(provider, flags.agentFlags);
  if (Object.keys(agentFlags).length > 0) {
    next.agentFlags = agentFlags;
  }

  if (
    provider === 'codex' &&
    typeof flags.threadId === 'string' &&
    flags.threadId.trim()
  ) {
    next.threadId = flags.threadId.trim();
  }

  return next;
}

export function buildConversationFlags(params: {
  provider: ChatProviderId;
  currentFlags?: unknown;
  agentFlags?: Record<string, unknown>;
  workingFolder?: string;
  threadId?: string | null;
  preserveFlowState?: boolean;
}): Record<string, unknown> {
  const next = sanitizeConversationFlagsForProvider(
    params.provider,
    params.currentFlags,
    { preserveFlowState: params.preserveFlowState },
  );

  const sanitizedAgentFlags = sanitizeAgentFlagsForProvider(
    params.provider,
    params.agentFlags,
  );
  if (Object.keys(sanitizedAgentFlags).length > 0) {
    next.agentFlags = sanitizedAgentFlags;
  } else {
    delete next.agentFlags;
  }

  const trimmedWorkingFolder = params.workingFolder?.trim();
  if (trimmedWorkingFolder) {
    next.workingFolder = trimmedWorkingFolder;
  } else {
    delete next.workingFolder;
  }

  if (params.provider === 'codex' && params.threadId?.trim()) {
    next.threadId = params.threadId.trim();
  } else {
    delete next.threadId;
  }

  return next;
}
