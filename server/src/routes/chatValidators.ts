import type {
  ApprovalMode,
  ModelReasoningEffort,
  SandboxMode,
} from '@openai/codex-sdk';

const DEFAULT_PROVIDER = 'lmstudio';
const DEFAULT_SANDBOX_MODE: SandboxMode = 'workspace-write';
const DEFAULT_NETWORK_ACCESS_ENABLED = true;
const DEFAULT_WEB_SEARCH_ENABLED = true;
const DEFAULT_APPROVAL_POLICY: ApprovalMode = 'on-failure';
const DEFAULT_MODEL_REASONING_EFFORT: ModelReasoningEffort = 'high';

export type AppModelReasoningEffort = ModelReasoningEffort | 'xhigh';

type Provider = 'codex' | 'lmstudio';

export type ChatRequestBody = {
  model?: unknown;
  message?: unknown;
  conversationId?: unknown;
  messages?: unknown;
  provider?: unknown;
  threadId?: unknown;
  inflightId?: unknown;
  sandboxMode?: unknown;
  networkAccessEnabled?: unknown;
  webSearchEnabled?: unknown;
  approvalPolicy?: unknown;
  modelReasoningEffort?: unknown;
};

export type ValidatedChatRequest = {
  model: string;
  message: string;
  conversationId: string;
  provider: Provider;
  threadId?: string;
  inflightId?: string;
  codexFlags: {
    sandboxMode?: SandboxMode;
    networkAccessEnabled?: boolean;
    webSearchEnabled?: boolean;
    approvalPolicy?: ApprovalMode;
    modelReasoningEffort?: AppModelReasoningEffort;
  };
  warnings: string[];
};

export class ChatValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatValidationError';
  }
}

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
  'on-failure',
  'untrusted',
] as ApprovalMode[];

export const modelReasoningEfforts: AppModelReasoningEffort[] = [
  'low',
  'medium',
  'high',
  'xhigh',
] as AppModelReasoningEffort[];

export function validateChatRequest(
  body: ChatRequestBody | unknown,
): ValidatedChatRequest {
  if (!isPlainObject(body)) {
    throw new ChatValidationError('request body must be an object');
  }

  if (body.messages !== undefined) {
    throw new ChatValidationError(
      'conversationId required; history is loaded server-side',
    );
  }

  const model = body.model;
  if (typeof model !== 'string' || model.trim().length === 0) {
    throw new ChatValidationError('model is required');
  }

  const message = body.message;
  if (typeof message !== 'string' || message.trim().length === 0) {
    throw new ChatValidationError('message is required');
  }

  const conversationId = body.conversationId;
  if (
    typeof conversationId !== 'string' ||
    conversationId.trim().length === 0
  ) {
    throw new ChatValidationError('conversationId is required');
  }

  const rawProvider = body.provider;
  let provider: Provider = DEFAULT_PROVIDER;
  if (typeof rawProvider === 'string' && rawProvider.length > 0) {
    if (rawProvider !== 'codex' && rawProvider !== 'lmstudio') {
      throw new ChatValidationError('provider must be "codex" or "lmstudio"');
    }
    provider = rawProvider;
  }

  const warnings: string[] = [];

  const threadId =
    typeof body.threadId === 'string' && body.threadId.length > 0
      ? body.threadId
      : undefined;

  const inflightId =
    typeof body.inflightId === 'string' && body.inflightId.length > 0
      ? body.inflightId
      : undefined;

  if (body.inflightId !== undefined && inflightId === undefined) {
    throw new ChatValidationError('inflightId must be a non-empty string');
  }

  const codexFlags: ValidatedChatRequest['codexFlags'] = {};

  // Example payloads for juniors:
  // { provider: 'codex', model: 'gpt-5.1-codex', messages: [{ role: 'user', content: 'Hi' }], sandboxMode: 'danger-full-access', networkAccessEnabled: false, webSearchEnabled: false, approvalPolicy: 'never', modelReasoningEffort: 'medium' }
  // { provider: 'lmstudio', model: 'llama-3', messages: [{ role: 'user', content: 'Hi' }], sandboxMode: 'read-only', networkAccessEnabled: true, webSearchEnabled: true, approvalPolicy: 'on-failure', modelReasoningEffort: 'high' } // Codex flags are ignored with warnings

  const sandboxMode = body.sandboxMode;
  if (sandboxMode !== undefined) {
    if (
      typeof sandboxMode !== 'string' ||
      !sandboxModes.includes(sandboxMode as SandboxMode)
    ) {
      throw new ChatValidationError(
        `sandboxMode must be one of: ${sandboxModes.join(', ')}`,
      );
    }
    if (provider !== 'codex') {
      warnings.push(
        `sandboxMode is Codex-only and was ignored for provider "${provider}"`,
      );
    } else {
      codexFlags.sandboxMode = sandboxMode as SandboxMode;
    }
  } else if (provider === 'codex') {
    codexFlags.sandboxMode = DEFAULT_SANDBOX_MODE;
  }

  const networkAccessEnabled = body.networkAccessEnabled;
  if (networkAccessEnabled !== undefined) {
    if (typeof networkAccessEnabled !== 'boolean') {
      throw new ChatValidationError('networkAccessEnabled must be a boolean');
    }
    if (provider !== 'codex') {
      warnings.push(
        `networkAccessEnabled is Codex-only and was ignored for provider "${provider}"`,
      );
    } else {
      codexFlags.networkAccessEnabled = networkAccessEnabled;
    }
  } else if (provider === 'codex') {
    codexFlags.networkAccessEnabled = DEFAULT_NETWORK_ACCESS_ENABLED;
  }

  const webSearchEnabled = body.webSearchEnabled;
  if (webSearchEnabled !== undefined) {
    if (typeof webSearchEnabled !== 'boolean') {
      throw new ChatValidationError('webSearchEnabled must be a boolean');
    }
    if (provider !== 'codex') {
      warnings.push(
        `webSearchEnabled is Codex-only and was ignored for provider "${provider}"`,
      );
    } else {
      codexFlags.webSearchEnabled = webSearchEnabled;
    }
  } else if (provider === 'codex') {
    codexFlags.webSearchEnabled = DEFAULT_WEB_SEARCH_ENABLED;
  }

  const approvalPolicy = body.approvalPolicy;
  if (approvalPolicy !== undefined) {
    if (
      typeof approvalPolicy !== 'string' ||
      !approvalPolicies.includes(approvalPolicy as ApprovalMode)
    ) {
      throw new ChatValidationError(
        `approvalPolicy must be one of: ${approvalPolicies.join(', ')}`,
      );
    }
    if (provider !== 'codex') {
      warnings.push(
        `approvalPolicy is Codex-only and was ignored for provider "${provider}"`,
      );
    } else {
      codexFlags.approvalPolicy = approvalPolicy as ApprovalMode;
    }
  } else if (provider === 'codex') {
    codexFlags.approvalPolicy = DEFAULT_APPROVAL_POLICY;
  }

  const modelReasoningEffort = body.modelReasoningEffort;
  if (modelReasoningEffort !== undefined) {
    if (
      typeof modelReasoningEffort !== 'string' ||
      !modelReasoningEfforts.includes(
        modelReasoningEffort as AppModelReasoningEffort,
      )
    ) {
      throw new ChatValidationError(
        `modelReasoningEffort must be one of: ${modelReasoningEfforts.join(', ')}`,
      );
    }
    if (provider !== 'codex') {
      warnings.push(
        `modelReasoningEffort is Codex-only and was ignored for provider "${provider}"`,
      );
    } else {
      codexFlags.modelReasoningEffort =
        modelReasoningEffort as AppModelReasoningEffort;
    }
  } else if (provider === 'codex') {
    codexFlags.modelReasoningEffort = DEFAULT_MODEL_REASONING_EFFORT;
  }

  return {
    model,
    message,
    conversationId,
    provider,
    threadId,
    inflightId,
    codexFlags,
    warnings,
  };
}
