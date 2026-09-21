import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  cleanupMixedShapeCanonicalOpenAiRoot,
  MIXED_SHAPE_RUNTIME_BRIDGE_NAME,
  seedMixedShapeCanonicalOpenAiRoot,
} from './mixedShapeRuntimeBridge.js';

const DEFAULT_CLASSIC_MCP_PORT = 5010;
const DEFAULT_CHAT_MCP_PORT = 5011;
const DEFAULT_AGENTS_MCP_PORT = 5012;
const DEFAULT_WEB_MCP_PORT = 5013;
const DEFAULT_PLAYWRIGHT_MCP_PORT = 8932;
const DEFAULT_CHROMA_PORT = 8300;
const MIXED_SHAPE_RUNTIME_BRIDGE_RELATIVE_PATH =
  'codeInfoTmp/manual-testing/0000055/task199-mixed-shape-runtime-bridge';

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

const setScopedEnvValue = (name, value) => {
  if (typeof globalThis.setScopedTestEnvValue !== 'function') {
    throw new Error('Scoped test env helpers are not installed.');
  }
  globalThis.setScopedTestEnvValue(name, value);
};

const clearScopedEnvValue = (name) => {
  if (typeof globalThis.clearScopedTestEnvValue !== 'function') {
    throw new Error('Scoped test env helpers are not installed.');
  }
  globalThis.clearScopedTestEnvValue(name);
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

const parseEnabledFlag = (value) => {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  );
};

export const resolveMainStackProbeRestBaseUrl = (env = process.env) => {
  const explicitUrl = trimToUndefined(env.CODEINFO_MAIN_STACK_REST_URL);
  if (explicitUrl) {
    return explicitUrl.replace(/\/+$/, '');
  }

  return buildHttpUrl(
    resolveMainStackProbeHost(env),
    DEFAULT_CLASSIC_MCP_PORT,
    '',
  );
};

export const resolveMixedShapeRuntimeBridgeRoot = (env = process.env) => {
  const explicitRoot = trimToUndefined(
    env.CODEINFO_MAIN_STACK_MIXED_SHAPE_ROOT,
  );
  if (explicitRoot) {
    return explicitRoot;
  }

  return path.resolve(process.cwd(), MIXED_SHAPE_RUNTIME_BRIDGE_RELATIVE_PATH);
};

const defaultMixedShapeRuntimeBridgeProbe = async ({
  env = process.env,
  fetchImpl = fetch,
  seedRoot = seedMixedShapeCanonicalOpenAiRoot,
} = {}) => {
  const host = resolveMainStackProbeHost(env);
  const restBaseUrl = resolveMainStackProbeRestBaseUrl(env);
  const rootsUrl = `${restBaseUrl}/ingest/roots`;
  const rootPath = resolveMixedShapeRuntimeBridgeRoot(env);
  const preserveSeed = parseEnabledFlag(
    env.CODEINFO_MAIN_STACK_KEEP_MIXED_SHAPE_SEED,
  );
  const previousChromaUrl = process.env.CODEINFO_CHROMA_URL;
  setScopedEnvValue(
    'CODEINFO_CHROMA_URL',
    buildHttpUrl(host, DEFAULT_CHROMA_PORT, ''),
  );

  try {
    await seedRoot({
      rootPath,
      name: MIXED_SHAPE_RUNTIME_BRIDGE_NAME,
    });

    const response = await fetchImpl(rootsUrl, {
      headers: { accept: 'application/json' },
    });
    const body = await response.json();
    const roots = Array.isArray(body?.roots) ? body.roots : [];
    const bridgeRoot = roots.find(
      (root) => root && typeof root === 'object' && root.path === rootPath,
    );

    if (!response.ok) {
      return {
        rootPath,
        restBaseUrl,
        seeded: true,
        observed: false,
        cleaned: false,
        preserved: preserveSeed,
        httpStatus: response.status,
        detail: `HTTP ${response.status} from ${rootsUrl}`,
      };
    }

    if (!bridgeRoot) {
      return {
        rootPath,
        restBaseUrl,
        seeded: true,
        observed: false,
        cleaned: false,
        preserved: preserveSeed,
        httpStatus: response.status,
        detail: `seeded row missing from ${rootsUrl}`,
      };
    }

    if (bridgeRoot.embeddingProvider !== 'openai') {
      return {
        rootPath,
        restBaseUrl,
        seeded: true,
        observed: false,
        cleaned: false,
        preserved: preserveSeed,
        httpStatus: response.status,
        detail:
          'seeded row was visible on /ingest/roots but lost the expected OpenAI provider identity',
      };
    }

    return {
      rootPath,
      restBaseUrl,
      seeded: true,
      observed: true,
      cleaned: false,
      preserved: preserveSeed,
      httpStatus: response.status,
      detail: `HTTP ${response.status}; observed seeded row at ${rootsUrl} with runtime-facing root metadata`,
    };
  } finally {
    if (previousChromaUrl === undefined) {
      clearScopedEnvValue('CODEINFO_CHROMA_URL');
    } else {
      setScopedEnvValue('CODEINFO_CHROMA_URL', previousChromaUrl);
    }
  }
};

export const resolveMainStackProbeEndpoints = (env = process.env) => {
  const host = resolveMainStackProbeHost(env);
  const webMcpHost =
    trimToUndefined(env.CODEINFO_MAIN_STACK_WEB_MCP_HOST) ?? '127.0.0.1';

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
    webMcp: {
      label: 'webMcp',
      url:
        trimToUndefined(env.CODEINFO_MAIN_STACK_WEB_MCP_URL) ??
        buildHttpUrl(webMcpHost, DEFAULT_WEB_MCP_PORT, '/'),
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
  webMcp: result.endpoints.webMcp.reachable ? 'reachable' : 'unreachable',
  playwrightMcp: result.endpoints.playwrightMcp.reachable
    ? 'reachable'
    : 'unreachable',
  mixedShapeBridge: result.mixedShapeBridge.observed ? 'observed' : 'failed',
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
  probeMixedShapeRuntimeBridge = defaultMixedShapeRuntimeBridgeProbe,
  env = process.env,
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

  let mixedShapeBridge = await probeMixedShapeRuntimeBridge({
    env,
    fetchImpl,
  });
  if (!mixedShapeBridge.preserved) {
    try {
      const host = resolveMainStackProbeHost(env);
      const previousChromaUrl = process.env.CODEINFO_CHROMA_URL;
      setScopedEnvValue(
        'CODEINFO_CHROMA_URL',
        buildHttpUrl(host, DEFAULT_CHROMA_PORT, ''),
      );
      try {
        await cleanupMixedShapeCanonicalOpenAiRoot({
          rootPath: mixedShapeBridge.rootPath,
        });
        mixedShapeBridge = {
          ...mixedShapeBridge,
          cleaned: true,
        };
      } finally {
        if (previousChromaUrl === undefined) {
          clearScopedEnvValue('CODEINFO_CHROMA_URL');
        } else {
          setScopedEnvValue('CODEINFO_CHROMA_URL', previousChromaUrl);
        }
      }
    } catch (error) {
      mixedShapeBridge = {
        ...mixedShapeBridge,
        cleaned: false,
        detail: `${mixedShapeBridge.detail}; cleanup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  if (
    !mixedShapeBridge.observed ||
    (!mixedShapeBridge.cleaned && !mixedShapeBridge.preserved)
  ) {
    failures.push('mixedShapeBridge');
  }

  return {
    result: failures.length === 0 ? 'passed' : 'failed',
    endpoints: endpointResults,
    mixedShapeBridge,
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

  lines.push(
    `- mixedShapeBridge: ${
      result.mixedShapeBridge.observed ? 'observed' : 'missing'
    } (${result.mixedShapeBridge.rootPath}) ${result.mixedShapeBridge.detail}`,
  );
  lines.push(
    `- mixedShapeBridge cleanup: ${
      result.mixedShapeBridge.preserved
        ? 'preserved for later inspection'
        : result.mixedShapeBridge.cleaned
          ? 'cleaned'
          : 'not cleaned'
    }`,
  );

  if (result.failures.length > 0) {
    lines.push(`- failing endpoints: ${result.failures.join(', ')}`);
  }

  return lines.join('\n');
};
