import { setTimeout as delay } from 'node:timers/promises';

import type { OpenAiCompatEndpointConfig } from '../config/openaiCompatEndpoints.js';

const DEFAULT_TIMEOUT_MS = 1_500;

export type OpenAiCompatModelDiscoveryEndpointResult = {
  endpoint: OpenAiCompatEndpointConfig;
  modelIds: string[];
};

export type OpenAiCompatModelDiscoveryWarning = {
  endpointId?: string;
  message: string;
};

export type OpenAiCompatModelDiscoveryResult = {
  endpoints: OpenAiCompatModelDiscoveryEndpointResult[];
  warnings: OpenAiCompatModelDiscoveryWarning[];
  selectedEndpointId?: string;
};

export type OpenAiCompatEndpointRuntimeState = {
  endpointId: string;
  available: boolean;
  models: string[];
  reason?: string;
};

type DiscoveryEndpointSelection = {
  endpoint: OpenAiCompatEndpointConfig;
  source: 'env' | 'config';
};

type OpenAiModelsListResponse = {
  object?: unknown;
  data?: unknown;
};

function mergeDiscoveryEndpoints(params: {
  endpoints: readonly OpenAiCompatEndpointConfig[];
  pinnedEndpoint?: OpenAiCompatEndpointConfig;
}): {
  endpoints: DiscoveryEndpointSelection[];
  warnings: OpenAiCompatModelDiscoveryWarning[];
} {
  const warnings: OpenAiCompatModelDiscoveryWarning[] = [];
  const merged: DiscoveryEndpointSelection[] = [];
  const seen = new Set<string>();

  for (const endpoint of params.endpoints) {
    if (seen.has(endpoint.endpointId)) {
      warnings.push({
        endpointId: endpoint.endpointId,
        message: `Skipping duplicate normalized endpoint ${endpoint.endpointId}; keeping first entry`,
      });
      continue;
    }
    seen.add(endpoint.endpointId);
    merged.push({ endpoint, source: 'env' });
  }

  const pinnedEndpoint = params.pinnedEndpoint;
  if (pinnedEndpoint) {
    if (seen.has(pinnedEndpoint.endpointId)) {
      warnings.push({
        endpointId: pinnedEndpoint.endpointId,
        message: `Skipping config-pinned endpoint ${pinnedEndpoint.endpointId}; it is already present after normalization`,
      });
    } else {
      seen.add(pinnedEndpoint.endpointId);
      merged.push({ endpoint: pinnedEndpoint, source: 'config' });
    }
  }

  return { endpoints: merged, warnings };
}

async function fetchEndpointModelIds(params: {
  endpoint: OpenAiCompatEndpointConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<string[]> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const modelsUrl = new URL('models', `${params.endpoint.baseUrl}/`);

  try {
    const response = await fetchImpl(modelsUrl, {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as OpenAiModelsListResponse;
    const data = Array.isArray(payload.data) ? payload.data : null;
    if (!data) {
      throw new Error('expected data[] array in /v1/models response');
    }

    const modelIds = data.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') {
        return [];
      }
      const modelId = (entry as { id?: unknown }).id;
      if (typeof modelId !== 'string') {
        return [];
      }
      const trimmed = modelId.trim();
      return trimmed ? [trimmed] : [];
    });

    if (modelIds.length === 0) {
      throw new Error('expected at least one model id in /v1/models response');
    }

    return [...new Set(modelIds)];
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    await delay(0);
  }
}

export async function discoverOpenAiCompatEndpointModels(params: {
  endpoints: readonly OpenAiCompatEndpointConfig[];
  pinnedEndpoint?: OpenAiCompatEndpointConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<OpenAiCompatModelDiscoveryResult> {
  const merged = mergeDiscoveryEndpoints({
    endpoints: params.endpoints,
    pinnedEndpoint: params.pinnedEndpoint,
  });
  const warnings = [...merged.warnings];

  const endpointResults = await Promise.all(
    merged.endpoints.map(async ({ endpoint }) => {
      try {
        const modelIds = await fetchEndpointModelIds({
          endpoint,
          fetchImpl: params.fetchImpl,
          timeoutMs: params.timeoutMs,
        });
        return {
          endpoint,
          modelIds,
          warnings: [] as OpenAiCompatModelDiscoveryWarning[],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          endpoint,
          modelIds: [],
          warnings: [
            {
              endpointId: endpoint.endpointId,
              message: `Failed to discover external models at ${endpoint.endpointId}: ${message}`,
            },
          ] as OpenAiCompatModelDiscoveryWarning[],
        };
      }
    }),
  );

  return {
    endpoints: endpointResults.map(({ endpoint, modelIds }) => ({
      endpoint,
      modelIds,
    })),
    warnings: [
      ...warnings,
      ...endpointResults.flatMap((result) => result.warnings),
    ],
    selectedEndpointId: params.pinnedEndpoint?.endpointId,
  };
}

export async function resolveOpenAiCompatEndpointRuntimeState(params: {
  endpoint: OpenAiCompatEndpointConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<OpenAiCompatEndpointRuntimeState> {
  const discovery = await discoverOpenAiCompatEndpointModels({
    endpoints: [params.endpoint],
    fetchImpl: params.fetchImpl,
    timeoutMs: params.timeoutMs,
  });
  const endpointResult = discovery.endpoints[0];
  const modelIds = endpointResult?.modelIds ?? [];
  const available = modelIds.length > 0;
  return {
    endpointId: params.endpoint.endpointId,
    available,
    models: modelIds,
    ...(available
      ? {}
      : {
          reason:
            discovery.warnings[0]?.message ??
            `Failed to discover external models at ${params.endpoint.endpointId}`,
        }),
  };
}
