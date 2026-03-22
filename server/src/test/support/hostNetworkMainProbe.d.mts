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
  failures: string[];
};

export function resolveMainStackProbeHost(env?: NodeJS.ProcessEnv): string;

export function resolveMainStackProbeEndpoints(
  env?: NodeJS.ProcessEnv,
): MainStackProbeEndpoints;

export function createMainStackProbeMarkerContext(
  result: MainStackProbeResult,
): {
  classicMcp: 'reachable' | 'unreachable';
  chatMcp: 'reachable' | 'unreachable';
  agentsMcp: 'reachable' | 'unreachable';
  playwrightMcp: 'reachable' | 'unreachable';
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
  fetchImpl?: typeof fetch;
}): Promise<MainStackProbeResult>;

export function renderMainStackProbeReport(
  result: MainStackProbeResult,
): string;
