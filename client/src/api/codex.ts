import { createLogger } from '../logging/logger';
import { getApiBaseUrl } from './baseUrl';

export type CodexDeviceAuthTarget = 'chat' | 'agent';

export type CodexDeviceAuthRequest = {
  target: CodexDeviceAuthTarget;
  agentName?: string;
};

export type CodexDeviceAuthResponse = {
  status: string;
  rawOutput: string;
  target: CodexDeviceAuthTarget;
  agentName?: string;
};

export type CodexDeviceAuthApiErrorDetails = {
  status: number;
  message: string;
  error?: string;
};

export class CodexDeviceAuthApiError extends Error {
  status: number;
  error?: string;

  constructor(details: CodexDeviceAuthApiErrorDetails) {
    super(details.message);
    this.name = 'CodexDeviceAuthApiError';
    this.status = details.status;
    this.error = details.error;
  }
}

function isJsonContentType(contentType: string | null | undefined) {
  if (!contentType) return false;
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes('application/json') || normalized.includes('+json')
  );
}

async function parseCodexDeviceAuthErrorResponse(res: Response): Promise<{
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

async function throwCodexDeviceAuthError(
  res: Response,
  baseMessage: string,
): Promise<never> {
  const parsed = await parseCodexDeviceAuthErrorResponse(res);
  const message =
    parsed.message ??
    parsed.reason ??
    `${baseMessage}${parsed.text ? `: ${parsed.text}` : ''}`;

  log('error', 'DEV-0000031:T5:codex_device_auth_api_error', {
    status: res.status,
    error: parsed.error ?? parsed.reason ?? parsed.message ?? baseMessage,
  });

  throw new CodexDeviceAuthApiError({
    status: res.status,
    message,
    error: parsed.error,
  });
}

export async function postCodexDeviceAuth(
  params: CodexDeviceAuthRequest,
): Promise<CodexDeviceAuthResponse> {
  log('info', 'DEV-0000031:T5:codex_device_auth_api_request', {
    target: params.target,
    agentNamePresent: Boolean(params.agentName?.trim()),
  });

  const trimmedAgentName = params.agentName?.trim();
  const res = await fetch(
    new URL('/codex/device-auth', serverBase).toString(),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        target: params.target,
        ...(trimmedAgentName ? { agentName: trimmedAgentName } : {}),
      }),
    },
  );

  if (!res.ok) {
    await throwCodexDeviceAuthError(
      res,
      `Failed to run Codex device auth (${res.status})`,
    );
  }

  log('info', 'DEV-0000031:T5:codex_device_auth_api_response', {
    status: res.status,
  });

  const data = (await res.json()) as Record<string, unknown>;
  const status = typeof data.status === 'string' ? data.status : '';
  const rawOutput = typeof data.rawOutput === 'string' ? data.rawOutput : '';
  const target = typeof data.target === 'string' ? data.target : '';
  const agentName =
    typeof data.agentName === 'string' ? data.agentName : undefined;

  if (!status || !rawOutput || (target !== 'chat' && target !== 'agent')) {
    throw new Error('Invalid codex device auth response');
  }

  return {
    status,
    rawOutput,
    target: target as CodexDeviceAuthTarget,
    agentName,
  };
}
