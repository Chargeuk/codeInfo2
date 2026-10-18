import { gunzipSync } from 'node:zlib';

export function decodeJsonBody(init?: RequestInit) {
  const body = init?.body;
  if (body == null) throw new Error('Expected a JSON request body');
  if (new Headers(init?.headers).get('content-encoding') === 'gzip') {
    return JSON.parse(
      gunzipSync(Buffer.from(body as ArrayBuffer)).toString('utf8'),
    );
  }
  return JSON.parse(String(body));
}
