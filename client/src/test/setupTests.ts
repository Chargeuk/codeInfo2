import { TextDecoder, TextEncoder } from 'util';
import { jest } from '@jest/globals';
import '@testing-library/jest-dom';
import { installMockWebSocket } from './support/mockWebSocket';

// React 19 uses this global to decide whether it should warn about act().
// In Jest + JSDOM the check is sensitive to where the flag is attached.
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const windowRef = (
  globalThis as unknown as {
    window?: {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
      __CODEINFO_TEST__?: boolean;
    };
  }
).window;
if (windowRef) {
  windowRef.IS_REACT_ACT_ENVIRONMENT = true;
}

(globalThis as unknown as { __CODEINFO_TEST__?: boolean }).__CODEINFO_TEST__ =
  true;
if (windowRef) {
  windowRef.__CODEINFO_TEST__ = true;
}

// Provide TextEncoder/Decoder for libraries that expect them in the JSDOM environment.
if (!global.TextEncoder) {
  // @ts-expect-error align node util types with browser globals
  global.TextEncoder = TextEncoder;
}
if (!global.TextDecoder) {
  // @ts-expect-error align node util types with browser globals
  global.TextDecoder = TextDecoder;
}

if (!global.Response) {
  class SimpleResponse {
    status: number;
    statusText: string;
    headers: Headers;
    private bodyValue: unknown;
    constructor(body?: BodyInit | null, init: ResponseInit = {}) {
      this.status = init.status ?? 200;
      this.statusText = init.statusText ?? '';
      // @ts-expect-error align with browser Headers type
      this.headers = (init.headers as Headers) ?? new Headers();
      this.bodyValue = body ?? null;
    }
    get ok() {
      return this.status >= 200 && this.status < 300;
    }
    async json() {
      if (typeof this.bodyValue === 'string') return JSON.parse(this.bodyValue);
      return this.bodyValue;
    }
    async text() {
      if (typeof this.bodyValue === 'string') return this.bodyValue;
      return JSON.stringify(this.bodyValue ?? '');
    }
    clone() {
      return new SimpleResponse(this.bodyValue as BodyInit, {
        status: this.status,
        statusText: this.statusText,
        headers: this.headers,
      });
    }
  }
  // @ts-expect-error provide minimal Response polyfill for tests
  global.Response = SimpleResponse;
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

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => {
    const normalized = query.replace(/^@media\s*/i, '').trim();
    const listeners = new Set<(event: MediaQueryListEvent) => void>();

    const computeMatches = () => {
      const maxMatch = normalized.match(/max-width:\s*([0-9.]+)px/i);
      const minMatch = normalized.match(/min-width:\s*([0-9.]+)px/i);
      const maxWidth = maxMatch ? Number(maxMatch[1]) : null;
      const minWidth = minMatch ? Number(minMatch[1]) : null;

      if (maxWidth !== null && window.innerWidth > maxWidth) {
        return false;
      }
      if (minWidth !== null && window.innerWidth < minWidth) {
        return false;
      }
      return true;
    };

    const list: MediaQueryList = {
      media: query,
      get matches() {
        return computeMatches();
      },
      onchange: null,
      addEventListener: (_type, listener) => {
        listeners.add(listener as (event: MediaQueryListEvent) => void);
      },
      removeEventListener: (_type, listener) => {
        listeners.delete(listener as (event: MediaQueryListEvent) => void);
      },
      addListener: (listener) => {
        listeners.add(listener as (event: MediaQueryListEvent) => void);
      },
      removeListener: (listener) => {
        listeners.delete(listener as (event: MediaQueryListEvent) => void);
      },
      dispatchEvent: (event) => {
        for (const listener of listeners) {
          listener(event as MediaQueryListEvent);
        }
        return true;
      },
    };

    return list;
  };
}

// Default fetch mock for tests; individual tests can override as needed.
(global.fetch as jest.Mock).mockImplementation(
  async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/chat/providers')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          providers: [
            {
              id: 'lmstudio',
              label: 'LM Studio',
              available: true,
              toolsAvailable: true,
            },
          ],
        }),
      } as Response;
    }
    if (url.includes('/chat/models')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          provider: 'lmstudio',
          available: true,
          toolsAvailable: true,
          models: [
            { key: 'm1', displayName: 'Model 1', type: 'gguf' },
            { key: 'embed', displayName: 'Embedding Model', type: 'embedding' },
          ],
        }),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ version: '0.0.0', app: 'server' }),
    } as Response;
  },
);

installMockWebSocket();
