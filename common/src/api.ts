import type { LmStudioStatusResponse } from './lmstudio.js';
import type { VersionInfo } from './versionInfo.js';

export async function fetchServerVersion(
  serverBaseUrl: string,
  fetchImpl = globalThis.fetch,
): Promise<VersionInfo> {
  const res = await fetchImpl(new URL('/version', serverBaseUrl).toString());
  if (!res.ok) {
    throw new Error(`version failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchLmStudioStatus({
  serverBaseUrl,
  lmBaseUrl,
  fetchImpl = globalThis.fetch,
}: {
  serverBaseUrl: string;
  lmBaseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<LmStudioStatusResponse> {
  const url = new URL('/lmstudio/status', serverBaseUrl);
  if (lmBaseUrl) url.searchParams.set('baseUrl', lmBaseUrl);
  const res = await fetchImpl(url.toString());
  if (!res.ok) throw new Error(`lmstudio status failed: ${res.status}`);
  return res.json();
}
