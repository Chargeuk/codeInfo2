export type MainStackProbeEndpoint = {
  label: string;
  url: string;
};

export type MainStackProbeEndpoints = {
  classicMcp: MainStackProbeEndpoint;
  chatMcp: MainStackProbeEndpoint;
  agentsMcp: MainStackProbeEndpoint;
  playwrightMcp: MainStackProbeEndpoint;
};

export type MainStackProbeEndpointResult = {
  url: string;
  reachable: boolean;
  httpStatus: number | null;
  detail: string;
};

export type MainStackProbeResult = {
  result: 'passed' | 'failed';
  endpoints: {
    classicMcp: MainStackProbeEndpointResult;
    chatMcp: MainStackProbeEndpointResult;
    agentsMcp: MainStackProbeEndpointResult;
    playwrightMcp: MainStackProbeEndpointResult;
  };
  mixedShapeBridge: {
    rootPath: string;
    restBaseUrl: string;
    seeded: boolean;
    observed: boolean;
    cleaned: boolean;
    preserved: boolean;
    httpStatus: number | null;
    detail: string;
  };
  failures: string[];
};

export function resolveMainStackProbeHost(env?: NodeJS.ProcessEnv): string;

export function resolveMainStackProbeEndpoints(
  env?: NodeJS.ProcessEnv,
): MainStackProbeEndpoints;

export function resolveMainStackProbeRestBaseUrl(
  env?: NodeJS.ProcessEnv,
): string;

export function resolveMixedShapeRuntimeBridgeRoot(
  env?: NodeJS.ProcessEnv,
): string;

export function createMainStackProbeMarkerContext(
  result: MainStackProbeResult,
): {
  classicMcp: 'reachable' | 'unreachable';
  chatMcp: 'reachable' | 'unreachable';
  agentsMcp: 'reachable' | 'unreachable';
  playwrightMcp: 'reachable' | 'unreachable';
  mixedShapeBridge: 'observed' | 'failed';
  result: 'passed' | 'failed';
};

export function probeMainStackEndpoints(params?: {
  endpoints?: MainStackProbeEndpoints;
  probeJsonRpc?: (params: {
    endpoint: MainStackProbeEndpoint;
    fetchImpl?: typeof fetch;
  }) => Promise<{
    reachable?: boolean;
    httpStatus?: number | null;
    detail?: string;
  }>;
  probeMixedShapeRuntimeBridge?: (params: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
  }) => Promise<{
    rootPath: string;
    restBaseUrl: string;
    seeded: boolean;
    observed: boolean;
    cleaned: boolean;
    preserved: boolean;
    httpStatus: number | null;
    detail: string;
  }>;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}): Promise<MainStackProbeResult>;

export function renderMainStackProbeReport(
  result: MainStackProbeResult,
): string;
