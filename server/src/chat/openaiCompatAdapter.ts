import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type { OpenAiCompatEndpointConfig } from '../config/openaiCompatEndpoints.js';
import { normalizeOpenAiCompatEndpointId } from '../config/openaiCompatEndpoints.js';
import { resolveServerPort } from '../config/serverPort.js';
import { resolveExternalOpenAiCompatEndpoints } from '../config/startupEnv.js';
import {
  computeExponentialDelayMs,
  resolveRetryAfterMs,
} from '../ingest/providers/openaiRetry.js';

const OPENAI_COMPAT_PROXY_SECRET = crypto.randomBytes(18).toString('hex');
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const DEFAULT_PROXY_DISCOVERY_HEADER_TIMEOUT_MS = 10_000;
const DEFAULT_PROXY_INFERENCE_HEADER_TIMEOUT_MS = 60_000;
const DEFAULT_PROXY_MAX_ATTEMPTS = 3;

export type OpenAiCompatAdapterConsumer = 'codex' | 'copilot';

export type CanonicalOpenAiCompatModel = {
  id: string;
  rawEntry: Record<string, unknown>;
  supportedParameters: string[];
};

type OpenAiModelsListResponse = {
  object?: unknown;
  data?: unknown;
  models?: unknown;
};

type OpenAiModelEntry = {
  id?: unknown;
  slug?: unknown;
  supported_parameters?: unknown;
};

type FetchWithRetryParams = {
  url: URL;
  init: RequestInit;
  headerTimeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
};

function isOpenRouterEndpoint(
  endpoint: Pick<OpenAiCompatEndpointConfig, 'baseUrl' | 'endpointId'>,
): boolean {
  try {
    const parsed = new URL(endpoint.baseUrl || endpoint.endpointId);
    return /(^|\.)openrouter\.ai$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function supportsCodexToolUse(model: CanonicalOpenAiCompatModel): boolean {
  return (
    model.supportedParameters.includes('tools') ||
    model.supportedParameters.includes('tool_choice')
  );
}

function normalizeSupportedParameters(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    typeof entry === 'string' && entry.trim().length > 0 ? [entry.trim()] : [],
  );
}

function coerceRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function buildCodexModelCatalogEntry(modelId: string): Record<string, unknown> {
  const supportedReasoningEfforts = [
    ['none', 'No reasoning'],
    ['minimal', 'Minimal reasoning'],
    ['low', 'Low reasoning'],
    ['medium', 'Balanced reasoning'],
    ['high', 'High reasoning'],
    ['xhigh', 'Maximum reasoning'],
  ].map(([effort, description]) => ({
    effort,
    description,
  }));

  return {
    slug: modelId,
    display_name: modelId,
    description: `External OpenAI-compatible model ${modelId}`,
    default_reasoning_level: 'medium',
    supported_reasoning_levels: supportedReasoningEfforts,
    shell_type: 'shell_command',
    visibility: 'list',
    supported_in_api: true,
    priority: 1,
    additional_speed_tiers: [],
    service_tiers: [],
    default_service_tier: null,
    availability_nux: null,
    upgrade: null,
    base_instructions: '',
    model_messages: null,
    supports_reasoning_summaries: false,
    default_reasoning_summary: 'auto',
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: null,
    web_search_tool_type: 'text',
    truncation_policy: {
      mode: 'bytes',
      limit: 10_000,
    },
    supports_parallel_tool_calls: false,
    supports_image_detail_original: false,
    context_window: null,
    max_context_window: null,
    auto_compact_token_limit: null,
    comp_hash: null,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    input_modalities: ['text', 'image'],
    supports_search_tool: false,
    use_responses_lite: false,
    auto_review_model_override: null,
    tool_mode: null,
    multi_agent_version: null,
  };
}

function sanitizeModelsForConsumer(params: {
  endpoint: Pick<OpenAiCompatEndpointConfig, 'baseUrl' | 'endpointId'>;
  consumer?: 'codex' | 'copilot' | 'discovery';
  models: CanonicalOpenAiCompatModel[];
}): CanonicalOpenAiCompatModel[] {
  if (params.consumer !== 'codex' || !isOpenRouterEndpoint(params.endpoint)) {
    return params.models;
  }
  return params.models.filter(supportsCodexToolUse);
}

function resolveEndpointApiKey(
  endpoint: Pick<OpenAiCompatEndpointConfig, 'endpointId'>,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return resolveExternalOpenAiCompatEndpoints({
    env,
  }).apiKeysByEndpointId.get(endpoint.endpointId);
}

function buildHeaders(
  endpoint: Pick<OpenAiCompatEndpointConfig, 'endpointId'>,
  params?: {
    baseHeaders?: HeadersInit;
    env?: NodeJS.ProcessEnv;
  },
): Headers {
  const headers = new Headers(params?.baseHeaders);
  const apiKey = resolveEndpointApiKey(endpoint, params?.env);
  if (apiKey) {
    headers.set('authorization', `Bearer ${apiKey}`);
  }
  if (!headers.has('accept')) {
    headers.set('accept', 'application/json');
  }
  return headers;
}

function isRetryableTransportError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name =
    typeof (error as { name?: unknown }).name === 'string'
      ? (error as { name: string }).name
      : '';
  if (name === 'AbortError' || name === 'TypeError') {
    return true;
  }
  const code =
    typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : '';
  return (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'ETIMEDOUT'
  );
}

function resolveEndpointToken(endpointId: string): string {
  return Buffer.from(endpointId, 'utf8').toString('base64url');
}

function decodeEndpointToken(token: string): string {
  try {
    return Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    throw new Error('invalid endpoint token');
  }
}

function sameSecret(value: string): boolean {
  const expected = Buffer.from(OPENAI_COMPAT_PROXY_SECRET, 'utf8');
  const actual = Buffer.from(value, 'utf8');
  if (expected.length !== actual.length) {
    return false;
  }
  return crypto.timingSafeEqual(expected, actual);
}

export function isValidOpenAiCompatProxySecret(secret: string): boolean {
  return sameSecret(secret);
}

export function buildOpenAiCompatProxyBaseUrl(params: {
  endpoint: Pick<OpenAiCompatEndpointConfig, 'endpointId'>;
  consumer: OpenAiCompatAdapterConsumer;
  env?: NodeJS.ProcessEnv;
}): string {
  const port = resolveServerPort(params.env);
  return [
    `http://localhost:${port}`,
    'internal',
    'openai-compat',
    OPENAI_COMPAT_PROXY_SECRET,
    params.consumer,
    resolveEndpointToken(params.endpoint.endpointId),
    'v1',
  ].join('/');
}

export function resolveOpenAiCompatEndpointFromProxyToken(params: {
  endpointToken: string;
  env?: NodeJS.ProcessEnv;
}): OpenAiCompatEndpointConfig {
  const decodedEndpointId = decodeEndpointToken(params.endpointToken);
  const normalizedEndpointId = normalizeOpenAiCompatEndpointId(decodedEndpointId, {
    pathLabel: 'openaiCompatEndpointToken',
  });
  const matched = resolveExternalOpenAiCompatEndpoints({
    env: params.env ?? process.env,
  }).endpoints.find((endpoint) => endpoint.endpointId === normalizedEndpointId);
  if (matched) {
    return matched;
  }
  throw new Error('invalid endpoint token');
}

async function fetchWithRetry(
  params: FetchWithRetryParams,
): Promise<Response> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const maxAttempts = params.maxAttempts ?? DEFAULT_PROXY_MAX_ATTEMPTS;
  const headerTimeoutMs =
    params.headerTimeoutMs ?? DEFAULT_PROXY_DISCOVERY_HEADER_TIMEOUT_MS;

  let attempt = 0;
  let lastError: unknown;
  while (attempt < maxAttempts) {
    attempt += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), headerTimeoutMs);
    try {
      const response = await fetchImpl(params.url, {
        ...params.init,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (
        RETRYABLE_STATUS_CODES.has(response.status) &&
        attempt < maxAttempts
      ) {
        const retryAfterMs = resolveRetryAfterMs(response.headers);
        await response.arrayBuffer().catch(() => undefined);
        await delay(
          typeof retryAfterMs === 'number'
            ? retryAfterMs
            : computeExponentialDelayMs(attempt),
        );
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (!isRetryableTransportError(error) || attempt >= maxAttempts) {
        throw error;
      }
      await delay(computeExponentialDelayMs(attempt));
    }
  }
  throw lastError ?? new Error('OpenAI-compatible request failed');
}

export function normalizeOpenAiCompatModelsPayload(
  payload: unknown,
): CanonicalOpenAiCompatModel[] {
  const response = coerceRecord(payload) as OpenAiModelsListResponse | null;
  const rawEntries = Array.isArray(response?.data)
    ? response?.data
    : Array.isArray(response?.models)
      ? response?.models
      : null;
  if (!rawEntries) {
    throw new Error('expected data[] or models[] array in /v1/models response');
  }
  const models = rawEntries.flatMap((entry) => {
    const record = coerceRecord(entry);
    if (!record) return [];
    const modelEntry = record as OpenAiModelEntry;
    const rawId = modelEntry.id ?? modelEntry.slug;
    if (typeof rawId !== 'string' || rawId.trim().length === 0) {
      return [];
    }
    return [
      {
        id: rawId.trim(),
        rawEntry: record,
        supportedParameters: normalizeSupportedParameters(
          modelEntry.supported_parameters,
        ),
      } satisfies CanonicalOpenAiCompatModel,
    ];
  });
  if (models.length === 0) {
    throw new Error('expected at least one model id in /v1/models response');
  }
  return models;
}

export async function fetchOpenAiCompatModels(params: {
  endpoint: OpenAiCompatEndpointConfig;
  consumer?: 'codex' | 'copilot' | 'discovery';
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<CanonicalOpenAiCompatModel[]> {
  const response = await fetchWithRetry({
    url: new URL('models', `${params.endpoint.baseUrl}/`),
    init: {
      method: 'GET',
      headers: buildHeaders(params.endpoint, { env: params.env }),
    },
    fetchImpl: params.fetchImpl,
    headerTimeoutMs: params.timeoutMs,
    maxAttempts: params.maxAttempts,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = (await response.json()) as OpenAiModelsListResponse;
  return sanitizeModelsForConsumer({
    endpoint: params.endpoint,
    consumer: params.consumer,
    models: normalizeOpenAiCompatModelsPayload(payload),
  });
}

export function serializeOpenAiCompatModelsForConsumer(params: {
  endpoint: Pick<OpenAiCompatEndpointConfig, 'baseUrl' | 'endpointId'>;
  consumer: OpenAiCompatAdapterConsumer;
  models: CanonicalOpenAiCompatModel[];
}): Record<string, unknown> {
  const models = sanitizeModelsForConsumer({
    endpoint: params.endpoint,
    consumer: params.consumer,
    models: params.models,
  });
  if (params.consumer === 'codex') {
    return {
      models: models.map((model) => buildCodexModelCatalogEntry(model.id)),
    };
  }
  return {
    object: 'list',
    data: models.map((model) => ({
      ...model.rawEntry,
      id: model.id,
    })),
  };
}

export async function forwardOpenAiCompatProxyRequest(params: {
  endpoint: OpenAiCompatEndpointConfig;
  method: 'POST';
  path: 'responses' | 'chat/completions';
  bodyText?: string;
  contentType?: string;
  accept?: string;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  headerTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<Response> {
  return await fetchWithRetry({
    url: new URL(params.path, `${params.endpoint.baseUrl}/`),
    init: {
      method: params.method,
      headers: buildHeaders(params.endpoint, {
        baseHeaders: {
          ...(params.contentType ? { 'content-type': params.contentType } : {}),
          ...(params.accept ? { accept: params.accept } : {}),
        },
        env: params.env,
      }),
      ...(params.bodyText !== undefined ? { body: params.bodyText } : {}),
    },
    fetchImpl: params.fetchImpl,
    headerTimeoutMs:
      params.headerTimeoutMs ?? DEFAULT_PROXY_INFERENCE_HEADER_TIMEOUT_MS,
    maxAttempts: params.maxAttempts ?? 1,
  });
}
