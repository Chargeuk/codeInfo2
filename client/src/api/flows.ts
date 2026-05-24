import { createLogger } from '../logging/logger';
import { getApiBaseUrl } from './baseUrl';

export type FlowSummary = {
  name: string;
  description?: string;
  disabled?: boolean;
  error?: string;
  warnings?: string[];
  sourceId?: string;
  sourceLabel?: string;
};

export type FlowWarningDetails = {
  code: string;
  message: string;
  providerId?: string;
  fallbackProviderId?: string;
};

export type FlowDisabledReason = {
  code: string;
  message: string;
  providerId?: string;
};

export type FlowDetails = {
  name: string;
  description?: string;
  disabled: boolean;
  warnings: FlowWarningDetails[];
  disabledReason?: FlowDisabledReason;
  sourceId?: string;
  sourceLabel?: string;
};

export type FlowApiErrorDetails = {
  status: number;
  code?: string;
  message: string;
};

export class FlowApiError extends Error {
  status: number;
  code?: string;

  constructor(details: FlowApiErrorDetails) {
    super(details.message);
    this.name = 'FlowApiError';
    this.status = details.status;
    this.code = details.code;
  }
}

function isJsonContentType(contentType: string | null | undefined) {
  if (!contentType) return false;
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes('application/json') || normalized.includes('+json')
  );
}

async function parseFlowApiErrorResponse(res: Response): Promise<{
  code?: string;
  message?: string;
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
          code:
            typeof record.code === 'string'
              ? record.code
              : typeof record.error === 'string'
                ? record.error
                : undefined,
          message:
            typeof record.message === 'string'
              ? record.message
              : typeof record.reason === 'string'
                ? record.reason
                : undefined,
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

async function throwFlowApiError(
  res: Response,
  baseMessage: string,
): Promise<never> {
  const parsed = await parseFlowApiErrorResponse(res);
  const message =
    parsed.message ?? `${baseMessage}${parsed.text ? `: ${parsed.text}` : ''}`;
  throw new FlowApiError({
    status: res.status,
    code: parsed.code,
    message,
  });
}

const serverBase = getApiBaseUrl();
const log = createLogger('client-flows');

export async function listFlows(): Promise<{ flows: FlowSummary[] }> {
  log('info', 'flows.api.list');
  const res = await fetch(new URL('/flows', serverBase).toString());
  if (!res.ok) {
    throw new Error(`Failed to load flows (${res.status})`);
  }
  const data = (await res.json()) as { flows?: unknown };
  const flows = Array.isArray(data.flows) ? (data.flows as unknown[]) : [];
  return {
    flows: flows
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const name = typeof record.name === 'string' ? record.name : undefined;
        if (!name) return null;
        return {
          name,
          description:
            typeof record.description === 'string'
              ? record.description
              : undefined,
          disabled:
            typeof record.disabled === 'boolean' ? record.disabled : undefined,
          error: typeof record.error === 'string' ? record.error : undefined,
          warnings: Array.isArray(record.warnings)
            ? (record.warnings.filter((w) => typeof w === 'string') as string[])
            : undefined,
          sourceId:
            typeof record.sourceId === 'string' ? record.sourceId : undefined,
          sourceLabel:
            typeof record.sourceLabel === 'string'
              ? record.sourceLabel
              : undefined,
        } satisfies FlowSummary;
      })
      .filter(Boolean) as FlowSummary[],
  };
}

export async function getFlowDetails(params: {
  flowName: string;
  sourceId?: string;
}): Promise<{ flow: FlowDetails }> {
  const url = new URL(
    `/flows/${encodeURIComponent(params.flowName)}`,
    serverBase,
  );
  if (params.sourceId?.trim()) {
    url.searchParams.set('sourceId', params.sourceId.trim());
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    await throwFlowApiError(res, `Failed to load flow details (${res.status})`);
  }

  const data = (await res.json()) as { flow?: unknown; flows?: unknown[] };
  let record: Record<string, unknown> | undefined;
  if (data.flow && typeof data.flow === 'object') {
    record = data.flow as Record<string, unknown>;
  } else if (Array.isArray(data.flows)) {
    const found = data.flows.find(
      (f: unknown) =>
        f &&
        typeof f === 'object' &&
        (f as Record<string, unknown>).name === params.flowName,
    );
    if (found && typeof found === 'object') {
      record = found as Record<string, unknown>;
    }
  }
  if (!record) {
    throw new Error('Invalid flow details response');
  }
  const name = typeof record.name === 'string' ? record.name : undefined;
  if (!name) {
    throw new Error('Invalid flow details response');
  }
  if (typeof record.disabled !== 'boolean') {
    throw new Error('Invalid flow details response');
  }

  const warnings = Array.isArray(record.warnings)
    ? record.warnings
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const warning = item as Record<string, unknown>;
          const code =
            typeof warning.code === 'string' ? warning.code : undefined;
          const message =
            typeof warning.message === 'string' ? warning.message : undefined;
          if (!code || !message) return null;
          return {
            code,
            message,
            providerId:
              typeof warning.providerId === 'string'
                ? warning.providerId
                : undefined,
            fallbackProviderId:
              typeof warning.fallbackProviderId === 'string'
                ? warning.fallbackProviderId
                : undefined,
          } satisfies FlowWarningDetails;
        })
        .filter(Boolean)
    : [];

  const disabledReason =
    record.disabledReason && typeof record.disabledReason === 'object'
      ? {
          code:
            typeof (record.disabledReason as Record<string, unknown>).code ===
            'string'
              ? ((record.disabledReason as Record<string, unknown>)
                  .code as string)
              : 'provider_unavailable',
          message:
            typeof (record.disabledReason as Record<string, unknown>)
              .message === 'string'
              ? ((record.disabledReason as Record<string, unknown>)
                  .message as string)
              : 'Flow unavailable',
          providerId:
            typeof (record.disabledReason as Record<string, unknown>)
              .providerId === 'string'
              ? ((record.disabledReason as Record<string, unknown>)
                  .providerId as string)
              : undefined,
        }
      : undefined;

  return {
    flow: {
      name,
      description:
        typeof record.description === 'string' ? record.description : undefined,
      disabled: record.disabled,
      warnings: warnings as FlowWarningDetails[],
      disabledReason,
      sourceId:
        typeof record.sourceId === 'string' ? record.sourceId : undefined,
      sourceLabel:
        typeof record.sourceLabel === 'string' ? record.sourceLabel : undefined,
    },
  };
}

export async function runFlow(params: {
  flowName: string;
  sourceId?: string;
  conversationId?: string;
  retryOwnershipId?: string;
  customTitle?: string;
  isNewConversation?: boolean;
  mode?: 'run' | 'resume';
  working_folder?: string;
  resumeStepPath?: number[];
  signal?: AbortSignal;
}): Promise<{
  status: 'started';
  flowName: string;
  conversationId: string;
  inflightId: string;
  providerId: string;
  modelId: string;
  warnings?: string[];
}> {
  log('info', 'flows.api.run', { flowName: params.flowName });
  const trimmedCustomTitle = params.customTitle?.trim();
  const shouldIncludeCustomTitle =
    Boolean(trimmedCustomTitle) &&
    params.isNewConversation === true &&
    (params.mode ?? 'run') === 'run';
  const shouldIncludeRetryOwnershipId =
    Boolean(params.retryOwnershipId?.trim()) &&
    params.isNewConversation === true &&
    (params.mode ?? 'run') === 'run';

  log('info', 'flows.run.payload.custom_title_included', {
    included: shouldIncludeCustomTitle,
    isNewConversation: params.isNewConversation === true,
  });

  const res = await fetch(
    new URL(
      `/flows/${encodeURIComponent(params.flowName)}/run`,
      serverBase,
    ).toString(),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(params.conversationId
          ? { conversationId: params.conversationId }
          : {}),
        ...(shouldIncludeRetryOwnershipId
          ? { retryOwnershipId: params.retryOwnershipId!.trim() }
          : {}),
        ...(params.sourceId?.trim() ? { sourceId: params.sourceId } : {}),
        ...(shouldIncludeCustomTitle
          ? { customTitle: trimmedCustomTitle }
          : {}),
        ...(params.working_folder?.trim()
          ? { working_folder: params.working_folder }
          : {}),
        ...(Array.isArray(params.resumeStepPath)
          ? { resumeStepPath: params.resumeStepPath }
          : {}),
      }),
      signal: params.signal,
    },
  );

  if (!res.ok) {
    await throwFlowApiError(res, `Failed to run flow (${res.status})`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const status = typeof data.status === 'string' ? data.status : '';
  const flowName = typeof data.flowName === 'string' ? data.flowName : '';
  const conversationId =
    typeof data.conversationId === 'string' ? data.conversationId : '';
  const inflightId = typeof data.inflightId === 'string' ? data.inflightId : '';
  const providerId = typeof data.providerId === 'string' ? data.providerId : '';
  const modelId = typeof data.modelId === 'string' ? data.modelId : '';
  const warnings = Array.isArray(data.warnings)
    ? data.warnings.filter(
        (warning): warning is string =>
          typeof warning === 'string' && warning.trim().length > 0,
      )
    : [];
  if (
    status !== 'started' ||
    !flowName ||
    !conversationId ||
    !inflightId ||
    !providerId ||
    !modelId
  ) {
    throw new Error('Invalid flow run response');
  }
  return {
    status: 'started',
    flowName,
    conversationId,
    inflightId,
    providerId,
    modelId,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
