import type {
  CodexDeviceAuthSuccessResponse,
  ProviderAuthProviderId,
  ProviderAuthResponseFor,
} from '@codeinfo2/common';
import { ORDERED_PROVIDER_AUTH_STATES } from '@codeinfo2/common';

import { createLogger } from '../logging/logger';
import { getApiBaseUrl } from './baseUrl';

export type CodexDeviceAuthResponse = CodexDeviceAuthSuccessResponse;
export type ProviderDeviceAuthResponse<
  TProvider extends ProviderAuthProviderId = ProviderAuthProviderId,
> = ProviderAuthResponseFor<TProvider>;

export type ProviderDeviceAuthApiErrorDetails = {
  status: number;
  message: string;
  error?: string;
};

export class ProviderDeviceAuthApiError extends Error {
  status: number;
  error?: string;

  constructor(details: ProviderDeviceAuthApiErrorDetails) {
    super(details.message);
    this.name = 'ProviderDeviceAuthApiError';
    this.status = details.status;
    this.error = details.error;
  }
}

export class CodexDeviceAuthApiError extends ProviderDeviceAuthApiError {}

function isJsonContentType(contentType: string | null | undefined) {
  if (!contentType) return false;
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes('application/json') || normalized.includes('+json')
  );
}

async function parseProviderDeviceAuthErrorResponse(res: Response): Promise<{
  error?: string;
  message?: string;
  reason?: string;
  text?: string;
}> {
  const contentType =
    typeof res.headers?.get === 'function'
      ? res.headers.get('content-type')
      : null;

  if (isJsonContentType(contentType)) {
    try {
      const data = (await res.json()) as unknown;
      if (data && typeof data === 'object') {
        const record = data as Record<string, unknown>;
        return {
          error: typeof record.error === 'string' ? record.error : undefined,
          message:
            typeof record.message === 'string' ? record.message : undefined,
          reason: typeof record.reason === 'string' ? record.reason : undefined,
        };
      }
      return {};
    } catch {
      return {};
    }
  }

  const text = await res.text().catch(() => '');
  return { text: text || undefined };
}

const serverBase = getApiBaseUrl();
const log = createLogger('codex-device-auth-api');
const T14_SUCCESS_LOG =
  '[DEV-0000037][T14] event=client_device_auth_contract_consumed result=success';
const T14_ERROR_LOG =
  '[DEV-0000037][T14] event=client_device_auth_contract_consumed result=error';
const T26_SUCCESS_LOG =
  '[DEV-0000037][T26] event=codex_device_auth_api_signature_aligned result=success';
const T26_ERROR_LOG =
  '[DEV-0000037][T26] event=codex_device_auth_api_signature_aligned result=error';

async function throwCodexDeviceAuthError(
  res: Response,
  baseMessage: string,
): Promise<never> {
  const parsed = await parseProviderDeviceAuthErrorResponse(res);
  const message =
    parsed.message ??
    parsed.reason ??
    `${baseMessage}${parsed.text ? `: ${parsed.text}` : ''}`;

  log('error', 'DEV-0000031:T5:codex_device_auth_api_error', {
    status: res.status,
    error: parsed.error ?? parsed.reason ?? parsed.message ?? baseMessage,
  });
  log('error', T14_ERROR_LOG, {
    status: res.status,
    error: parsed.error ?? parsed.reason ?? parsed.message ?? baseMessage,
  });
  log('error', T26_ERROR_LOG, {
    status: res.status,
    error: parsed.error ?? parsed.reason ?? parsed.message ?? baseMessage,
  });

  throw new ProviderDeviceAuthApiError({
    status: res.status,
    message,
    error: parsed.error,
  });
}

export async function postProviderDeviceAuth<
  TProvider extends ProviderAuthProviderId,
>(provider: TProvider): Promise<ProviderDeviceAuthResponse<TProvider>> {
  log('info', 'DEV-0000031:T5:provider_device_auth_api_request', { provider });

  const res = await fetch(
    new URL(`/${provider}/device-auth`, serverBase).toString(),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    },
  );

  if (!res.ok) {
    await throwCodexDeviceAuthError(
      res,
      `Failed to run ${provider} device auth (${res.status})`,
    );
  }

  log('info', 'DEV-0000031:T5:provider_device_auth_api_response', {
    provider,
    status: res.status,
  });

  const data = (await res.json()) as Record<string, unknown>;
  const responseProvider = data.provider;
  const state = data.state;

  if (
    responseProvider !== provider ||
    typeof state !== 'string' ||
    !ORDERED_PROVIDER_AUTH_STATES.includes(
      state as (typeof ORDERED_PROVIDER_AUTH_STATES)[number],
    )
  ) {
    log('error', T14_ERROR_LOG, {
      provider,
      status: res.status,
      error: 'invalid_success_response_shape',
    });
    log('error', T26_ERROR_LOG, {
      provider,
      status: res.status,
      error: 'invalid_success_response_shape',
    });
    throw new Error(`Invalid ${provider} device auth response`);
  }

  log('info', T14_SUCCESS_LOG, {
    provider,
    status: res.status,
    responseState: state,
  });
  log('info', T26_SUCCESS_LOG, {
    provider,
    status: res.status,
    responseState: state,
  });

  return data as ProviderDeviceAuthResponse<TProvider>;
}

export async function postCodexDeviceAuth(): Promise<CodexDeviceAuthResponse> {
  return postProviderDeviceAuth('codex');
}
