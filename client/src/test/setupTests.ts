import { TextDecoder, TextEncoder } from 'util';
import { jest } from '@jest/globals';
import '@testing-library/jest-dom';

// Provide TextEncoder/Decoder for libraries that expect them in the JSDOM environment.
if (!global.TextEncoder) {
  // @ts-expect-error align node util types with browser globals
  global.TextEncoder = TextEncoder;
}
if (!global.TextDecoder) {
  // @ts-expect-error align node util types with browser globals
  global.TextDecoder = TextDecoder;
}

if (!global.Headers) {
  class SimpleHeaders {
    private store = new Map<string, string>();
    append(key: string, value: string) {
      this.store.set(key.toLowerCase(), value);
    }
    get(key: string) {
      return this.store.get(key.toLowerCase()) ?? null;
    }
  }
  // @ts-expect-error minimal polyfill for tests
  global.Headers = SimpleHeaders;
}

if (!global.Request) {
  class SimpleRequest {
    url: string;
    method: string;
    headers: Headers;
    body: unknown;
    constructor(input: RequestInfo | URL, init: RequestInit = {}) {
      this.url = typeof input === 'string' ? input : input.toString();
      this.method = init.method ?? 'GET';
      this.headers = (init.headers as Headers) ?? new Headers();
      this.body = init.body;
    }
    clone() {
      return this;
    }
  }
  // @ts-expect-error minimal polyfill for tests
  global.Request = SimpleRequest;
}

if (!global.fetch) {
  global.fetch = jest.fn();
}

// Default fetch mock for tests; individual tests can override as needed.
(global.fetch as jest.Mock).mockImplementation(async () => ({
  ok: true,
  json: async () => ({ version: '0.0.0', app: 'server' }),
}));
