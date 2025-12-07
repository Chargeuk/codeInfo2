import type { SandboxMode } from '@openai/codex-sdk';

const DEFAULT_PROVIDER = 'lmstudio';
const DEFAULT_SANDBOX_MODE: SandboxMode = 'workspace-write';
const DEFAULT_NETWORK_ACCESS_ENABLED = true;
const DEFAULT_WEB_SEARCH_ENABLED = true;

type Provider = 'codex' | 'lmstudio';

export type ChatRequestBody = {
  model?: unknown;
  messages?: unknown;
  provider?: unknown;
  threadId?: unknown;
  sandboxMode?: unknown;
  networkAccessEnabled?: unknown;
  webSearchEnabled?: unknown;
  approvalPolicy?: unknown;
  modelReasoningEffort?: unknown;
};

export type ValidatedChatRequest = {
  model: string;
  messages: unknown[];
  provider: Provider;
  threadId?: string;
  codexFlags: {
    sandboxMode?: SandboxMode;
    networkAccessEnabled?: boolean;
    webSearchEnabled?: boolean;
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

const sandboxModes: SandboxMode[] = [
  'read-only',
  'workspace-write',
  'danger-full-access',
] as SandboxMode[];

export function validateChatRequest(
  body: ChatRequestBody | unknown,
): ValidatedChatRequest {
  if (!isPlainObject(body)) {
    throw new ChatValidationError('request body must be an object');
  }

  const model = body.model;
  if (typeof model !== 'string' || model.trim().length === 0) {
    throw new ChatValidationError('model is required');
  }

  const messages = body.messages;
  if (!Array.isArray(messages)) {
    throw new ChatValidationError('messages must be an array');
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

  const codexFlags: ValidatedChatRequest['codexFlags'] = {};

  // Example payloads for juniors:
  // { provider: 'codex', model: 'gpt-5.1-codex', messages: [{ role: 'user', content: 'Hi' }], sandboxMode: 'danger-full-access', networkAccessEnabled: false, webSearchEnabled: false }
  // { provider: 'lmstudio', model: 'llama-3', messages: [{ role: 'user', content: 'Hi' }], sandboxMode: 'read-only', networkAccessEnabled: true, webSearchEnabled: true } // Codex flags are ignored with warnings

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

  return {
    model,
    messages,
    provider,
    threadId,
    codexFlags,
    warnings,
  };
}
