import type { ChatProviderId } from '@codeinfo2/common';

export const OPENAI_COMPAT_ENDPOINT_CAPABILITIES = [
  'responses',
  'completions',
] as const;

export type OpenAiCompatEndpointCapability =
  (typeof OPENAI_COMPAT_ENDPOINT_CAPABILITIES)[number];

export type OpenAiCompatEndpointConfig = {
  endpointId: string;
  baseUrl: string;
  capabilities: readonly OpenAiCompatEndpointCapability[];
};

type ParseEndpointPathLabel = {
  pathLabel?: string;
};

export type OpenAiCompatEndpointListResolution = {
  endpoints: OpenAiCompatEndpointConfig[];
  warnings: string[];
};

const INVALID_PREFIX = 'RUNTIME_CONFIG_INVALID';
const VALIDATION_FAILED_PREFIX = 'RUNTIME_CONFIG_VALIDATION_FAILED';
const SUPPORTED_CAPABILITIES = new Set<OpenAiCompatEndpointCapability>(
  OPENAI_COMPAT_ENDPOINT_CAPABILITIES,
);

function makeInvalidEndpointError(
  pathLabel: string,
  message: string,
): Error {
  return new Error(`${INVALID_PREFIX}: ${pathLabel}: ${message}`);
}

function makeValidationFailedEndpointError(
  pathLabel: string,
  message: string,
): Error {
  return new Error(`${VALIDATION_FAILED_PREFIX}: ${pathLabel}: ${message}`);
}

function normalizeBaseUrl(value: string, pathLabel: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw makeInvalidEndpointError(
      pathLabel,
      'expected an explicit http or https /v1 base URL',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw makeInvalidEndpointError(
      pathLabel,
      'expected an explicit http or https /v1 base URL',
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw makeInvalidEndpointError(
      pathLabel,
      'expected an explicit http or https /v1 base URL',
    );
  }

  if (parsed.search.length > 0) {
    throw makeInvalidEndpointError(
      pathLabel,
      'query strings are not allowed on OpenAI-compatible endpoint URLs',
    );
  }

  if (parsed.hash.length > 0) {
    throw makeInvalidEndpointError(
      pathLabel,
      'fragments are not allowed on OpenAI-compatible endpoint URLs',
    );
  }

  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw makeInvalidEndpointError(
      pathLabel,
      'credentials are not allowed on OpenAI-compatible endpoint URLs',
    );
  }

  if (!/\/v1\/?$/.test(parsed.pathname)) {
    throw makeInvalidEndpointError(
      pathLabel,
      'the endpoint path must end at /v1',
    );
  }

  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function normalizeCapabilities(
  value: string,
  pathLabel: string,
): OpenAiCompatEndpointCapability[] {
  const normalized: OpenAiCompatEndpointCapability[] = [];
  const seen = new Set<OpenAiCompatEndpointCapability>();

  for (const entry of value.split(',')) {
    const trimmed = entry.trim().toLowerCase();
    if (!trimmed) {
      continue;
    }
    if (!SUPPORTED_CAPABILITIES.has(trimmed as OpenAiCompatEndpointCapability)) {
      throw makeInvalidEndpointError(
        pathLabel,
        `unsupported capability "${trimmed}"`,
      );
    }
    const capability = trimmed as OpenAiCompatEndpointCapability;
    if (seen.has(capability)) {
      continue;
    }
    seen.add(capability);
    normalized.push(capability);
  }

  if (normalized.length === 0) {
    throw makeInvalidEndpointError(
      pathLabel,
      'at least one supported capability is required',
    );
  }

  return normalized;
}

export function parseOpenAiCompatEndpointConfig(
  value: string,
  params: ParseEndpointPathLabel = {},
): OpenAiCompatEndpointConfig {
  const pathLabel = params.pathLabel ?? 'codeinfo_openai_endpoint';
  const trimmed = value.trim();

  if (!trimmed) {
    throw makeInvalidEndpointError(
      pathLabel,
      'expected an explicit http or https /v1 base URL',
    );
  }

  const pieces = trimmed.split('|');
  if (pieces.length !== 2) {
    throw makeInvalidEndpointError(
      pathLabel,
      'expected the format <baseUrl>|<capability[,capability...]>',
    );
  }

  const [baseUrlValue, capabilityValue] = pieces;
  const baseUrl = normalizeBaseUrl(baseUrlValue ?? '', pathLabel);
  const capabilities = normalizeCapabilities(capabilityValue ?? '', pathLabel);

  return {
    endpointId: baseUrl,
    baseUrl,
    capabilities,
  };
}

export function resolveOpenAiCompatEndpointConfigsFromList(params: {
  value?: string;
  pathLabel?: string;
}): OpenAiCompatEndpointListResolution {
  const pathLabel = params.pathLabel ?? 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS';
  const rawValue = params.value?.trim() ?? '';
  if (!rawValue) {
    return {
      endpoints: [],
      warnings: [],
    };
  }

  const warnings: string[] = [];
  const endpoints: OpenAiCompatEndpointConfig[] = [];
  const seen = new Set<string>();

  for (const [index, segment] of rawValue.split(';').entries()) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }

    const parsed = parseOpenAiCompatEndpointConfig(trimmed, {
      pathLabel: `${pathLabel}[${index + 1}]`,
    });
    if (seen.has(parsed.endpointId)) {
      warnings.push(
        `${pathLabel}[${index + 1}] duplicates normalized endpoint ${parsed.endpointId}; keeping first entry`,
      );
      continue;
    }
    seen.add(parsed.endpointId);
    endpoints.push(parsed);
  }

  return {
    endpoints,
    warnings,
  };
}

export function validateOpenAiCompatEndpointConfigForProvider(params: {
  endpoint: OpenAiCompatEndpointConfig;
  provider: ChatProviderId;
  pathLabel?: string;
}): void {
  const pathLabel = params.pathLabel ?? 'codeinfo_openai_endpoint';
  const { endpoint, provider } = params;
  const supportsResponses = endpoint.capabilities.includes('responses');
  const supportsCompletions = endpoint.capabilities.includes('completions');

  if (provider === 'lmstudio') {
    throw makeValidationFailedEndpointError(
      pathLabel,
      'codeinfo_openai_endpoint is only supported for codex and copilot runtime configs',
    );
  }

  if (provider === 'codex' && !supportsResponses) {
    throw makeValidationFailedEndpointError(
      pathLabel,
      'Codex requires responses support on codeinfo_openai_endpoint',
    );
  }

  if (provider === 'copilot' && !supportsCompletions) {
    throw makeValidationFailedEndpointError(
      pathLabel,
      'Copilot requires completions support on codeinfo_openai_endpoint',
    );
  }
}
