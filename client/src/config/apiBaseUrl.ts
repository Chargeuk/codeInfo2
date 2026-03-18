const BROWSER_HOST_DIRECTIVE = 'USE_BROWSER_HOST';

export type ApiBaseUrlResolutionMode =
  | 'literal_url'
  | 'browser_host'
  | 'fallback';

type ApiBaseUrlDirectiveResolution = {
  value: string | undefined;
  mode: ApiBaseUrlResolutionMode;
  directivePort?: string;
  diagnosticReason?: 'invalid_browser_host_directive';
};

function buildBrowserHostUrl(browserOrigin: string, port: string) {
  const url = new URL(browserOrigin);
  url.port = port;
  return url.toString().replace(/\/$/, '');
}

export function resolveBrowserHostApiBaseUrl(
  rawValue: string | undefined,
  browserOrigin: string,
): ApiBaseUrlDirectiveResolution | undefined {
  if (typeof rawValue !== 'string') {
    return undefined;
  }
  const trimmed = rawValue.trim();
  if (!trimmed.toUpperCase().startsWith(`${BROWSER_HOST_DIRECTIVE}:`)) {
    return undefined;
  }
  const port = trimmed.slice(trimmed.indexOf(':') + 1).trim();
  if (!/^\d+$/.test(port) || Number(port) <= 0 || Number(port) > 65535) {
    return {
      value: undefined,
      mode: 'fallback',
      directivePort: port,
      diagnosticReason: 'invalid_browser_host_directive',
    };
  }
  if (!browserOrigin) {
    return {
      value: undefined,
      mode: 'fallback',
      directivePort: port,
      diagnosticReason: 'invalid_browser_host_directive',
    };
  }
  return {
    value: buildBrowserHostUrl(browserOrigin, port),
    mode: 'browser_host',
    directivePort: port,
  };
}

export { BROWSER_HOST_DIRECTIVE };
