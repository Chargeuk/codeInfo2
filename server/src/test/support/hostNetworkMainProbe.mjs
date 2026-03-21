import { existsSync } from 'node:fs';

const DEFAULT_CLASSIC_MCP_PORT = 5010;
const DEFAULT_CHAT_MCP_PORT = 5011;
const DEFAULT_AGENTS_MCP_PORT = 5012;
const DEFAULT_PLAYWRIGHT_MCP_PORT = 8932;

const DEFAULT_JSON_RPC_REQUEST = {
  jsonrpc: '2.0',
  id: 'codeinfo2-host-network-probe',
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'codeinfo2-host-network-probe',
      version: '1.0.0',
    },
  },
};

const parseJsonRpcPayload = (rawBody) => {
  const trimmed = rawBody.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue below for SSE-style envelopes.
  }

  const sseDataLine = trimmed
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('data:'));
  if (!sseDataLine) {
    return null;
  }

  const payload = sseDataLine.slice('data:'.length).trim();
  if (payload.length === 0) {
    return null;
  }

  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

const trimToUndefined = (value) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const resolveMainStackProbeHost = (env = process.env) => {
  const explicitHost = trimToUndefined(env.CODEINFO_HOST_NETWORK_PROBE_HOST);
  if (explicitHost) {
    return explicitHost;
  }

  if (env.CODEINFO_TEST_RUNNING_IN_CONTAINER || existsSync('/.dockerenv')) {
    return 'host.docker.internal';
  }

  return '127.0.0.1';
};

const buildHttpUrl = (host, port, pathname = '/') =>
  `http://${host}:${port}${pathname}`;

export const resolveMainStackProbeEndpoints = (env = process.env) => {
  const host = resolveMainStackProbeHost(env);

  return {
    classicMcp: {
      label: 'classicMcp',
      url:
        trimToUndefined(env.CODEINFO_MAIN_STACK_CLASSIC_MCP_URL) ??
        buildHttpUrl(host, DEFAULT_CLASSIC_MCP_PORT, '/mcp'),
    },
    chatMcp: {
      label: 'chatMcp',
      url:
        trimToUndefined(env.CODEINFO_MAIN_STACK_CHAT_MCP_URL) ??
        buildHttpUrl(host, DEFAULT_CHAT_MCP_PORT, '/'),
    },
    agentsMcp: {
      label: 'agentsMcp',
      url:
        trimToUndefined(env.CODEINFO_MAIN_STACK_AGENTS_MCP_URL) ??
        buildHttpUrl(host, DEFAULT_AGENTS_MCP_PORT, '/'),
    },
    playwrightMcp: {
      label: 'playwrightMcp',
      url:
        trimToUndefined(env.CODEINFO_MAIN_STACK_PLAYWRIGHT_MCP_URL) ??
        buildHttpUrl(host, DEFAULT_PLAYWRIGHT_MCP_PORT, '/mcp'),
    },
  };
};

export const createMainStackProbeMarkerContext = (result) => ({
  classicMcp: result.endpoints.classicMcp.reachable
    ? 'reachable'
    : 'unreachable',
  chatMcp: result.endpoints.chatMcp.reachable ? 'reachable' : 'unreachable',
  agentsMcp: result.endpoints.agentsMcp.reachable ? 'reachable' : 'unreachable',
  playwrightMcp: result.endpoints.playwrightMcp.reachable
    ? 'reachable'
    : 'unreachable',
  result: result.result,
});

const defaultJsonRpcProbe = async ({ endpoint, fetchImpl = fetch }) => {
  const response = await fetchImpl(endpoint.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(DEFAULT_JSON_RPC_REQUEST),
  });

  const rawBody = await response.text();
  const parsedBody = parseJsonRpcPayload(rawBody);
  if (rawBody.trim().length > 0 && parsedBody === null) {
    return {
      reachable: false,
      httpStatus: response.status,
      detail: `invalid JSON response from ${endpoint.url}`,
    };
  }

  if (!response.ok) {
    return {
      reachable: false,
      httpStatus: response.status,
      detail: `HTTP ${response.status} from ${endpoint.url}`,
    };
  }

  if (parsedBody && typeof parsedBody === 'object' && 'error' in parsedBody) {
    const message =
      typeof parsedBody.error?.message === 'string'
        ? parsedBody.error.message
        : 'JSON-RPC error';
    return {
      reachable: false,
      httpStatus: response.status,
      detail: message,
    };
  }

  if (
    !parsedBody ||
    typeof parsedBody !== 'object' ||
    !('result' in parsedBody)
  ) {
    return {
      reachable: false,
      httpStatus: response.status,
      detail: `missing JSON-RPC result from ${endpoint.url}`,
    };
  }

  return {
    reachable: true,
    httpStatus: response.status,
    detail: `HTTP ${response.status}`,
  };
};

export const probeMainStackEndpoints = async ({
  endpoints = resolveMainStackProbeEndpoints(),
  probeJsonRpc = defaultJsonRpcProbe,
  fetchImpl = fetch,
} = {}) => {
  const endpointEntries = Object.entries(endpoints);
  const endpointResults = {};
  const failures = [];

  for (const [name, endpoint] of endpointEntries) {
    try {
      const probeResult = await probeJsonRpc({ endpoint, fetchImpl });
      endpointResults[name] = {
        url: endpoint.url,
        reachable: Boolean(probeResult?.reachable),
        httpStatus:
          typeof probeResult?.httpStatus === 'number'
            ? probeResult.httpStatus
            : null,
        detail:
          typeof probeResult?.detail === 'string'
            ? probeResult.detail
            : probeResult?.reachable
              ? 'reachable'
              : 'probe failed',
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      endpointResults[name] = {
        url: endpoint.url,
        reachable: false,
        httpStatus: null,
        detail,
      };
    }

    if (!endpointResults[name].reachable) {
      failures.push(name);
    }
  }

  return {
    result: failures.length === 0 ? 'passed' : 'failed',
    endpoints: endpointResults,
    failures,
  };
};

export const renderMainStackProbeReport = (result) => {
  const lines = [
    'Main-stack host-network probe summary:',
    `- result: ${result.result}`,
  ];

  for (const [name, endpoint] of Object.entries(result.endpoints)) {
    const status = endpoint.reachable ? 'reachable' : 'unreachable';
    const suffix =
      endpoint.httpStatus === null
        ? endpoint.detail
        : `HTTP ${endpoint.httpStatus}; ${endpoint.detail}`;
    lines.push(`- ${name}: ${status} (${endpoint.url}) ${suffix}`);
  }

  if (result.failures.length > 0) {
    lines.push(`- failing endpoints: ${result.failures.join(', ')}`);
  }

  return lines.join('\n');
};
