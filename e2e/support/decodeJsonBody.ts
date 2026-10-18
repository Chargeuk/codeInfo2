import { gunzipSync } from 'node:zlib';
import type { Request } from '@playwright/test';

export function decodeJsonBody(request: Request) {
  const body = request.postDataBuffer();
  if (!body) return null;
  const bytes =
    request.headers()['content-encoding'] === 'gzip' ? gunzipSync(body) : body;
  return JSON.parse(bytes.toString('utf8'));
}
