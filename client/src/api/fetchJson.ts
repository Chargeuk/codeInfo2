export async function fetchJson(
  url: string | URL,
  init: RequestInit & { body: string },
): Promise<Response> {
  const { signal } = init;
  if (signal?.aborted) throw signal.reason;
  if (typeof CompressionStream === 'undefined') return fetch(url, init);

  const original = new Blob([init.body]);
  const compressed = original
    .stream()
    .pipeThrough(new CompressionStream('gzip'), {
      signal: signal ?? undefined,
    });
  const body = await new Response(compressed).arrayBuffer();

  if (signal?.aborted) throw signal.reason;
  if (body.byteLength >= original.size) return fetch(url, init);
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  headers.set('Content-Encoding', 'gzip');
  return fetch(url, { ...init, headers, body });
}
