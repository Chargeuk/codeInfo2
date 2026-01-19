import { createLogger } from '../logging/logger';
import { getApiBaseUrl } from './baseUrl';

export type FlowSummary = {
  name: string;
  description?: string;
  disabled?: boolean;
  error?: string;
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
          code: typeof record.code === 'string' ? record.code : undefined,
          message:
            typeof record.message === 'string' ? record.message : undefined,
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
        } satisfies FlowSummary;
      })
      .filter(Boolean) as FlowSummary[],
  };
}

export async function runFlow(params: {
  flowName: string;
  conversationId?: string;
  working_folder?: string;
  resumeStepPath?: number[];
  signal?: AbortSignal;
}): Promise<{
  status: 'started';
  flowName: string;
  conversationId: string;
  inflightId: string;
  modelId: string;
}> {
  log('info', 'flows.api.run', { flowName: params.flowName });
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
  const modelId = typeof data.modelId === 'string' ? data.modelId : '';
  if (
    status !== 'started' ||
    !flowName ||
    !conversationId ||
    !inflightId ||
    !modelId
  ) {
    throw new Error('Invalid flow run response');
  }
  return { status: 'started', flowName, conversationId, inflightId, modelId };
}
