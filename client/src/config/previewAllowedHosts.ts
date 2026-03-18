const DEFAULT_PREVIEW_ALLOWED_HOSTS = [
  'host.docker.internal',
  'localhost',
  '127.0.0.1',
  '::1',
] as const;

function normalizeHosts(rawValue: string | undefined): string[] {
  if (!rawValue) {
    return [];
  }
  return rawValue
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
}

export function resolvePreviewAllowedHosts(
  rawValue: string | undefined,
): true | string[] {
  const configuredHosts = normalizeHosts(rawValue);
  const allowAll = configuredHosts.some(
    (host) => host.toUpperCase() === 'ALL',
  );
  if (allowAll) {
    return true;
  }
  return Array.from(
    new Set([...DEFAULT_PREVIEW_ALLOWED_HOSTS, ...configuredHosts]),
  );
}

export function describePreviewAllowedHosts(
  resolvedValue: true | string[],
): string {
  return resolvedValue === true
    ? 'allow-all'
    : `allowlist:${resolvedValue.join(',')}`;
}

export { DEFAULT_PREVIEW_ALLOWED_HOSTS };
