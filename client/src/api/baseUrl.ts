type RuntimeConfig = {
  apiBaseUrl?: string;
  apiPort?: string;
};

type Env = { [key: string]: string | undefined };

function readEnv(): Env {
  const metaEnv =
    typeof import.meta !== 'undefined'
      ? (((import.meta as unknown as { env?: Env }).env ?? {}) as Env)
      : {};
  const processEnv = typeof process !== 'undefined' ? (process.env as Env) : {};
  return { ...processEnv, ...metaEnv };
}

function readRuntimeConfig(): RuntimeConfig {
  const config = (
    globalThis as unknown as { __CODEINFO_CONFIG__?: RuntimeConfig }
  ).__CODEINFO_CONFIG__;
  if (!config || typeof config !== 'object') {
    return {};
  }
  return config;
}

function buildBaseFromPort(port?: string): string | undefined {
  if (!port) return undefined;
  if (typeof window === 'undefined' || !window.location) return undefined;
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:${port}`;
}

export function getApiBaseUrl(): string {
  const runtime = readRuntimeConfig();
  if (runtime.apiBaseUrl) return runtime.apiBaseUrl;
  const runtimeBase = buildBaseFromPort(runtime.apiPort);
  if (runtimeBase) return runtimeBase;

  const env = readEnv();
  if (env.VITE_API_URL) return env.VITE_API_URL;
  const envBase = buildBaseFromPort(env.VITE_API_PORT);
  if (envBase) return envBase;

  if (typeof window !== 'undefined' && window.location) {
    return window.location.origin;
  }
  return '';
}

export type { RuntimeConfig };
