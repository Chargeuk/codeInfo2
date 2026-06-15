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
  displayLabel?: string;
  authLookupKey?: string;
  supportsBuiltInWebSearch?: boolean;
};

type ParseEndpointPathLabel = {
  pathLabel?: string;
};

export type OpenAiCompatEndpointListResolution = {
  endpoints: OpenAiCompatEndpointConfig[];
  warnings: string[];
};

export type OpenAiCompatEndpointAuthResolution = OpenAiCompatEndpointListResolution & {
  apiKeysByAuthLookupKey: ReadonlyMap<string, string>;
  apiKeysByEndpointId: ReadonlyMap<string, string>;
};

export type OpenAiCompatEndpointKeyEntry = {
  authLookupKey: string;
  apiKey: string;
};

const UNSLOTH_API_KEY_PREFIX = 'sk-unsloth-';

export type OpenAiCompatEndpointKeyListResolution = {
  keys: OpenAiCompatEndpointKeyEntry[];
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

export function normalizeOpenAiCompatEndpointLabelKey(
  value: string,
  params: ParseEndpointPathLabel = {},
): string {
  const pathLabel = params.pathLabel ?? 'label';
  const trimmed = value.trim();
  if (!trimmed) {
    throw makeInvalidEndpointError(pathLabel, 'endpoint label is required');
  }

  const normalized = trimmed.toLowerCase().replace(/\s+/g, '-');
  if (!normalized) {
    throw makeInvalidEndpointError(pathLabel, 'endpoint label is required');
  }

  return normalized;
}

export function normalizeOpenAiCompatEndpointId(
  value: string,
  params: ParseEndpointPathLabel = {},
): string {
  const pathLabel = params.pathLabel ?? 'endpointId';
  return normalizeBaseUrl(value, pathLabel);
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

export function describeOpenAiCompatEndpoint(
  endpoint: Pick<OpenAiCompatEndpointConfig, 'displayLabel' | 'endpointId'>,
): string {
  return endpoint.displayLabel?.trim() || endpoint.endpointId;
}

function parseOpenAiCompatEndpointListEntry(
  value: string,
  params: ParseEndpointPathLabel = {},
): OpenAiCompatEndpointConfig {
  const pathLabel = params.pathLabel ?? 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS';
  const trimmed = value.trim();
  if (!trimmed) {
    throw makeInvalidEndpointError(
      pathLabel,
      'expected <Label>,<baseUrl>|<capability[,capability...]> or legacy <baseUrl>|<capability[,capability...]>',
    );
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return parseOpenAiCompatEndpointConfig(trimmed, { pathLabel });
  }

  const delimiterIndex = trimmed.indexOf(',');
  if (delimiterIndex <= 0) {
    if (trimmed.includes('|')) {
      return parseOpenAiCompatEndpointConfig(trimmed, { pathLabel });
    }
    throw makeInvalidEndpointError(
      pathLabel,
      'expected <Label>,<baseUrl>|<capability[,capability...]>',
    );
  }

  const displayLabel = trimmed.slice(0, delimiterIndex).trim();
  const remainder = trimmed.slice(delimiterIndex + 1);
  if (!displayLabel) {
    throw makeInvalidEndpointError(pathLabel, 'endpoint label is required');
  }

  const parsed = parseOpenAiCompatEndpointConfig(remainder, { pathLabel });
  return {
    ...parsed,
    displayLabel,
    authLookupKey: normalizeOpenAiCompatEndpointLabelKey(displayLabel, {
      pathLabel,
    }),
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
  const seenLabels = new Set<string>();

  for (const [index, segment] of rawValue.split(';').entries()) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }

    const parsed = parseOpenAiCompatEndpointListEntry(trimmed, {
      pathLabel: `${pathLabel}[${index + 1}]`,
    });
    if (parsed.authLookupKey) {
      if (seenLabels.has(parsed.authLookupKey)) {
        throw makeInvalidEndpointError(
          `${pathLabel}[${index + 1}]`,
          `duplicate normalized endpoint label "${parsed.authLookupKey}"`,
        );
      }
      seenLabels.add(parsed.authLookupKey);
    }
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

function parseOpenAiCompatEndpointKeyEntry(
  value: string,
  params: ParseEndpointPathLabel = {},
): OpenAiCompatEndpointKeyEntry {
  const pathLabel = params.pathLabel ?? 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS';
  const trimmed = value.trim();
  if (!trimmed) {
    throw makeInvalidEndpointError(pathLabel, 'expected <Label>,<raw key>');
  }

  const delimiterIndex = trimmed.indexOf(',');
  if (delimiterIndex <= 0) {
    throw makeInvalidEndpointError(pathLabel, 'expected <Label>,<raw key>');
  }

  const label = trimmed.slice(0, delimiterIndex);
  const rawKey = trimmed.slice(delimiterIndex + 1).trim();
  const authLookupKey = normalizeOpenAiCompatEndpointLabelKey(label, {
    pathLabel,
  });
  if (!rawKey) {
    throw makeInvalidEndpointError(pathLabel, 'endpoint key value is required');
  }

  return {
    authLookupKey,
    apiKey: rawKey,
  };
}

export function resolveOpenAiCompatEndpointKeysFromList(params: {
  value?: string;
  pathLabel?: string;
}): OpenAiCompatEndpointKeyListResolution {
  const pathLabel = params.pathLabel ?? 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS';
  const rawValue = params.value?.trim() ?? '';
  if (!rawValue) {
    return {
      keys: [],
      warnings: [],
    };
  }

  const warnings: string[] = [];
  const keys: OpenAiCompatEndpointKeyEntry[] = [];
  const seenLabels = new Set<string>();

  for (const [index, segment] of rawValue.split(';').entries()) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }
    const parsed = parseOpenAiCompatEndpointKeyEntry(trimmed, {
      pathLabel: `${pathLabel}[${index + 1}]`,
    });
    if (seenLabels.has(parsed.authLookupKey)) {
      throw makeInvalidEndpointError(
        `${pathLabel}[${index + 1}]`,
        `duplicate normalized endpoint label "${parsed.authLookupKey}"`,
      );
    }
    seenLabels.add(parsed.authLookupKey);
    keys.push(parsed);
  }

  return {
    keys,
    warnings,
  };
}

export function attachOpenAiCompatEndpointKeys(params: {
  endpoints: readonly OpenAiCompatEndpointConfig[];
  keys: readonly OpenAiCompatEndpointKeyEntry[];
  warnings?: readonly string[];
}): OpenAiCompatEndpointAuthResolution {
  const apiKeysByAuthLookupKey = new Map(
    params.keys.map((entry) => [entry.authLookupKey, entry.apiKey] as const),
  );
  const matchedLookupKeys = new Set<string>();
  const apiKeysByEndpointId = new Map<string, string>();

  const endpoints = params.endpoints.map((endpoint) => {
    if (!endpoint.authLookupKey) {
      return endpoint;
    }
    const apiKey = apiKeysByAuthLookupKey.get(endpoint.authLookupKey);
    if (!apiKey) {
      return endpoint;
    }
    matchedLookupKeys.add(endpoint.authLookupKey);
    apiKeysByEndpointId.set(endpoint.endpointId, apiKey);
    return {
      ...endpoint,
      supportsBuiltInWebSearch:
        apiKey.trim().toLowerCase().startsWith(UNSLOTH_API_KEY_PREFIX),
    };
  });

  const warnings = [...(params.warnings ?? [])];
  for (const entry of params.keys) {
    if (matchedLookupKeys.has(entry.authLookupKey)) {
      continue;
    }
    warnings.push(
      `Ignoring CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS entry "${entry.authLookupKey}" because it does not match any labeled external endpoint`,
    );
  }

  return {
    endpoints,
    warnings,
    apiKeysByAuthLookupKey,
    apiKeysByEndpointId,
  };
}

export function supportsOpenAiCompatBuiltInWebSearch(
  endpoint?: Pick<OpenAiCompatEndpointConfig, 'supportsBuiltInWebSearch'> | null,
): boolean {
  return endpoint?.supportsBuiltInWebSearch === true;
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
