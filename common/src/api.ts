import type { LmStudioStatusResponse } from './lmstudio.js';
import type { VersionInfo } from './versionInfo.js';

type HttpError = Error & { status?: number; body?: unknown };

export const ORDERED_CHAT_PROVIDER_IDS = [
  'codex',
  'copilot',
  'lmstudio',
] as const;

export type ChatProviderId = (typeof ORDERED_CHAT_PROVIDER_IDS)[number];

export const DEFAULT_CHAT_PROVIDER_ID: ChatProviderId =
  ORDERED_CHAT_PROVIDER_IDS[0];

export const ORDERED_CHAT_PROVIDER_CONTRACT =
  ORDERED_CHAT_PROVIDER_IDS.join('>');

export function isChatProviderId(value: string): value is ChatProviderId {
  return ORDERED_CHAT_PROVIDER_IDS.includes(value as ChatProviderId);
}

export const ORDERED_PROVIDER_AUTH_PROVIDER_IDS = ['codex', 'copilot'] as const;

export type ProviderAuthProviderId =
  (typeof ORDERED_PROVIDER_AUTH_PROVIDER_IDS)[number];

export const ORDERED_PROVIDER_AUTH_STATES = [
  'verification_ready',
  'completion_pending',
  'completed',
  'already_authenticated',
  'failed',
  'unavailable_before_start',
] as const;

export type ProviderAuthState = (typeof ORDERED_PROVIDER_AUTH_STATES)[number];

export type CodexDeviceAuthRequest = Record<string, never>;

export type ProviderAuthVerificationReadyResponse<
  TProvider extends ProviderAuthProviderId = ProviderAuthProviderId,
> = {
  provider: TProvider;
  state: 'verification_ready';
  verificationUrl: string;
  userCode: string;
  displayOutput?: string;
};

export type ProviderAuthCompletionPendingResponse<
  TProvider extends ProviderAuthProviderId = ProviderAuthProviderId,
> = {
  provider: TProvider;
  state: 'completion_pending';
  verificationUrl?: string;
  userCode?: string;
  displayOutput?: string;
};

export type ProviderAuthCompletedResponse<
  TProvider extends ProviderAuthProviderId = ProviderAuthProviderId,
> = {
  provider: TProvider;
  state: 'completed';
};

export type ProviderAuthAlreadyAuthenticatedResponse<
  TProvider extends ProviderAuthProviderId = ProviderAuthProviderId,
> = {
  provider: TProvider;
  state: 'already_authenticated';
};

export type ProviderAuthFailedResponse<
  TProvider extends ProviderAuthProviderId = ProviderAuthProviderId,
> = {
  provider: TProvider;
  state: 'failed';
  reason: string;
  displayOutput?: string;
};

export type ProviderAuthUnavailableBeforeStartResponse<
  TProvider extends ProviderAuthProviderId = ProviderAuthProviderId,
> = {
  provider: TProvider;
  state: 'unavailable_before_start';
  reason: string;
};

export type CodexDeviceAuthInvalidRequestResponse = {
  error: 'invalid_request';
  message: string;
};

export type ProviderAuthResponseFor<TProvider extends ProviderAuthProviderId> =
  | ProviderAuthVerificationReadyResponse<TProvider>
  | ProviderAuthCompletionPendingResponse<TProvider>
  | ProviderAuthCompletedResponse<TProvider>
  | ProviderAuthAlreadyAuthenticatedResponse<TProvider>
  | ProviderAuthFailedResponse<TProvider>
  | ProviderAuthUnavailableBeforeStartResponse<TProvider>;

export type ProviderAuthResponse = {
  [TProvider in ProviderAuthProviderId]: ProviderAuthResponseFor<TProvider>;
}[ProviderAuthProviderId];

export type CodexDeviceAuthSuccessResponse = Extract<
  ProviderAuthResponse,
  { provider: 'codex' }
>;

export type CodexDeviceAuthResponse =
  | CodexDeviceAuthSuccessResponse
  | CodexDeviceAuthInvalidRequestResponse;

export async function fetchServerVersion(
  serverBaseUrl: string,
  fetchImpl = globalThis.fetch,
): Promise<VersionInfo> {
  const res = await fetchImpl(new URL('/version', serverBaseUrl).toString());
  if (!res.ok) {
    const error: HttpError = new Error(`version failed: ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

export async function fetchLmStudioStatus({
  serverBaseUrl,
  lmBaseUrl,
  fetchImpl = globalThis.fetch,
}: {
  serverBaseUrl: string;
  lmBaseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<LmStudioStatusResponse> {
  const url = new URL('/lmstudio/status', serverBaseUrl);
  if (lmBaseUrl) url.searchParams.set('baseUrl', lmBaseUrl);
  const res = await fetchImpl(url.toString());
  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    const error: HttpError = new Error(`lmstudio status failed: ${res.status}`);
    error.status = res.status;
    if (parsed) {
      error.body = parsed;
    }
    throw error;
  }
  return res.json();
}
