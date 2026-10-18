export async function fetchJson(
  url: string | URL,
  init: RequestInit & { body: string },
): Promise<Response> {
  const { signal } = init;
  if (signal?.aborted) throw signal.reason;
  if (typeof CompressionStream === 'undefined') return fetch(url, init);

  const bytes = new TextEncoder().encode(init.body);
  const chunks: Uint8Array[] = [];
  let size = 0;
  await new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  })
    .pipeThrough(new CompressionStream('gzip'))
    .pipeTo(
      new WritableStream<Uint8Array>({
        write(chunk) {
          chunks.push(chunk);
          size += chunk.byteLength;
        },
      }),
      { signal: signal ?? undefined },
    );

  if (signal?.aborted) throw signal.reason;
  if (size >= bytes.byteLength) return fetch(url, init);

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  headers.set('Content-Encoding', 'gzip');
  return fetch(url, { ...init, headers, body: body.buffer });
}
