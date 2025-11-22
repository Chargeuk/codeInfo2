export async function fetchServerVersion(
  serverBaseUrl: string,
  fetchImpl = globalThis.fetch,
) {
  const res = await fetchImpl(new URL('/version', serverBaseUrl).toString());
  if (!res.ok) {
    throw new Error(`version failed: ${res.status}`);
  }
  return res.json();
}
