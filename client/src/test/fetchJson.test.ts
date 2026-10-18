import {
  CompressionStream as NativeCompressionStream,
  ReadableStream as NativeReadableStream,
  TransformStream as NativeTransformStream,
  WritableStream as NativeWritableStream,
} from 'node:stream/web';
import { gunzipSync } from 'node:zlib';
import { fetchJson } from '../api/fetchJson';
import { decodeJsonBody } from './support/decodeJsonBody';
import { getFetchMock, mockJsonResponse } from './support/fetchMock';

const globals = {
  CompressionStream: NativeCompressionStream,
  ReadableStream: NativeReadableStream,
  WritableStream: NativeWritableStream,
};
let descriptors: Record<string, PropertyDescriptor | undefined>;

beforeEach(() => {
  descriptors = Object.fromEntries(
    [...Object.keys(globals), 'fetch'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  getFetchMock().mockReset();
  getFetchMock().mockResolvedValue(mockJsonResponse({ accepted: true }));
});

afterEach(() => {
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

it('buffers native gzip bytes and roundtrips JSON and Unicode', async () => {
  const payload = { text: 'Hello 世界 🌍 '.repeat(200), nested: { value: 42 } };
  const body = JSON.stringify(payload);
  const response = await fetchJson('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const [, sent] = getFetchMock().mock.calls[0];
  expect(sent?.body).toBeInstanceOf(ArrayBuffer);
  const bytes = Buffer.from(sent!.body as ArrayBuffer);
  expect(bytes.byteLength).toBeLessThan(
    new TextEncoder().encode(body).byteLength,
  );
  expect(gunzipSync(bytes).toString('utf8')).toBe(body);
  expect(decodeJsonBody(sent)).toEqual(payload);
  expect(new Headers(sent?.headers).get('content-encoding')).toBe('gzip');
  expect(new Headers(sent?.headers).get('content-type')).toBe(
    'application/json',
  );
  expect(await response.json()).toEqual({ accepted: true });
  expect(getFetchMock()).toHaveBeenCalledTimes(1);
});

it('compares UTF-8 byte sizes rather than JavaScript string lengths', async () => {
  const body = JSON.stringify('漢'.repeat(12));
  await fetchJson('/chat', { method: 'POST', body });
  const sent = getFetchMock().mock.calls[0][1]!;
  const size = (sent.body as ArrayBuffer).byteLength;
  expect(size).toBeGreaterThan(body.length);
  expect(size).toBeLessThan(new TextEncoder().encode(body).byteLength);
  expect(decodeJsonBody(sent)).toBe('漢'.repeat(12));
});

it('sends the original JSON when native gzip would be larger', async () => {
  const init = { method: 'POST', body: '{}' };
  await fetchJson('/flows/daily/run', init);
  expect(getFetchMock()).toHaveBeenCalledWith('/flows/daily/run', init);
  expect(getFetchMock().mock.calls[0][1]).toBe(init);
});

it('sends original JSON when CompressionStream is unsupported', async () => {
  Object.defineProperty(globalThis, 'CompressionStream', { value: undefined });
  const init = {
    method: 'POST',
    body: JSON.stringify({ text: 'a'.repeat(500) }),
  };
  await fetchJson('/logs', init);
  expect(getFetchMock().mock.calls[0][1]).toBe(init);
});

it.each<{ headers: HeadersInit }>([
  { headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'test' } },
  {
    headers: [
      ['Content-Type', 'application/json'],
      ['X-Request-Id', 'test'],
    ],
  },
  {
    headers: new Headers({
      'Content-Type': 'application/json',
      'X-Request-Id': 'test',
    }),
  },
])(
  'preserves headers, options, URL and signal with gzip (%#)',
  async ({ headers }) => {
    const controller = new AbortController();
    const url = new URL('http://localhost/chat');
    const init: RequestInit & { body: string } = {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'a'.repeat(500) }),
      signal: controller.signal,
      credentials: 'include',
      cache: 'no-store',
      mode: 'cors',
      redirect: 'error',
      keepalive: true,
    };
    await fetchJson(url, init);
    const [sentUrl, sent] = getFetchMock().mock.calls[0];
    expect(sentUrl).toBe(url);
    expect(sent).toEqual({
      ...init,
      body: expect.any(ArrayBuffer),
      headers: expect.anything(),
    });
    expect(new Headers(sent?.headers).get('x-request-id')).toBe('test');
    expect(new Headers(sent?.headers).get('content-type')).toBe(
      'application/json',
    );
    expect(new Headers(headers).has('content-encoding')).toBe(false);
  },
);

it('rejects an already cancelled request before compression or fetch', async () => {
  const controller = new AbortController();
  const reason = new Error('cancelled before compression');
  controller.abort(reason);
  await expect(
    fetchJson('/chat', {
      body: '{}',
      signal: controller.signal,
    }),
  ).rejects.toBe(reason);
  expect(getFetchMock()).not.toHaveBeenCalled();
});

it('cancels during compression without submitting a request', async () => {
  let start!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  Object.defineProperty(globalThis, 'CompressionStream', {
    value: class {
      private stream = new NativeTransformStream({
        async transform(chunk, controller) {
          start();
          await gate;
          controller.enqueue(chunk);
        },
      });
      readable = this.stream.readable;
      writable = this.stream.writable;
    },
  });
  const controller = new AbortController();
  const reason = new Error('cancelled during compression');
  const result = fetchJson('/chat', {
    body: '"pending"',
    signal: controller.signal,
  });
  const rejected = expect(result).rejects.toBe(reason);
  try {
    await started;
    controller.abort(reason);
  } finally {
    release();
    await rejected;
  }
  expect(getFetchMock()).not.toHaveBeenCalled();
});

it('propagates compression errors without sending or retrying', async () => {
  const error = new Error('compression failed');
  Object.defineProperty(globalThis, 'CompressionStream', {
    value: class {
      constructor() {
        throw error;
      }
    },
  });
  await expect(fetchJson('/chat', { body: '{}' })).rejects.toBe(error);
  expect(getFetchMock()).not.toHaveBeenCalled();
});

it('propagates fetch errors without retrying a submission', async () => {
  const error = new Error('network failed');
  getFetchMock().mockRejectedValue(error);
  await expect(
    fetchJson('/chat', { body: JSON.stringify('a'.repeat(500)) }),
  ).rejects.toBe(error);
  expect(getFetchMock()).toHaveBeenCalledTimes(1);
});
