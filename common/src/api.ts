import type { LmStudioStatusResponse } from './lmstudio.js';
import type { VersionInfo } from './versionInfo.js';

type HttpError = Error & { status?: number; body?: unknown };

export async function fetchServerVersion(
  serverBaseUrl: string,
  fetchImpl = globalThis.fetch,
): Promise<VersionInfo> {
  const res = await fetchImpl(new URL('/version', serverBaseUrl).toString());
  if (!res.ok) {
    const error: HttpError = new Error(`version failed: ${res.status}`);
    error.status = res.status;
    throw error;
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
  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    const error: HttpError = new Error(`lmstudio status failed: ${res.status}`);
    error.status = res.status;
    if (parsed) {
      error.body = parsed;
    }
    throw error;
  }
  return res.json();
}
