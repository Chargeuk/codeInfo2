import { TextDecoder, TextEncoder } from 'util';
import { jest } from '@jest/globals';
import '@testing-library/jest-dom';

beforeEach(() => {
  process.env.MODE = 'test';
});

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

if (!global.WebSocket) {
  class SimpleWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    url: string;
    readyState = SimpleWebSocket.CONNECTING;
    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    onclose: ((ev: CloseEvent) => void) | null = null;

    constructor(url: string) {
      this.url = url;
    }

    send() {}
    close() {
      this.readyState = SimpleWebSocket.CLOSED;
      this.onclose?.({} as CloseEvent);
    }
  }

  // @ts-expect-error minimal polyfill for tests
  global.WebSocket = SimpleWebSocket;
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
