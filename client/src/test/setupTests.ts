import { TextDecoder, TextEncoder } from 'util';
import { jest } from '@jest/globals';
import '@testing-library/jest-dom';

// React 19 uses this global to decide whether it should warn about act().
// In Jest + JSDOM the check is sensitive to where the flag is attached.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
(globalThis as unknown as { window?: { IS_REACT_ACT_ENVIRONMENT?: boolean } }).window &&
  (((globalThis as unknown as { window: { IS_REACT_ACT_ENVIRONMENT?: boolean } }).window.IS_REACT_ACT_ENVIRONMENT =
    true));

(globalThis as unknown as { __CODEINFO_TEST__?: boolean }).__CODEINFO_TEST__ = true;
(globalThis as unknown as { window?: { __CODEINFO_TEST__?: boolean } }).window &&
  (((globalThis as unknown as { window: { __CODEINFO_TEST__?: boolean } }).window.__CODEINFO_TEST__ =
    true));

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

// WebSocket mock for client WS-driven chat tests.
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: MockWebSocket[] = [];

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  sent: string[] = [];

  private pendingInbound: string[] = [];
  private messageHandler: ((event: { data: unknown }) => void) | null = null;

  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  set onmessage(handler: ((event: { data: unknown }) => void) | null) {
    this.messageHandler = handler;
    if (!handler) return;
    const pending = this.pendingInbound.splice(0);
    pending.forEach((payload) => handler({ data: payload }));
  }

  get onmessage() {
    return this.messageHandler;
  }

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);

    setTimeout(() => {
      if (this.readyState !== MockWebSocket.CONNECTING) return;
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.({});
    }, 0);
  }

  send(data: unknown) {
    this.sent.push(String(data));
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  }

  _receive(data: unknown) {
    const payload =
      typeof data === 'string' ? data : JSON.stringify(data ?? null);
    const handler = this.messageHandler;
    if (!handler) {
      this.pendingInbound.push(payload);
      return;
    }
    handler({ data: payload });
  }
}

// @ts-expect-error override JSDOM WebSocket with deterministic mock
global.WebSocket = MockWebSocket;

(globalThis as unknown as { __wsMock?: unknown }).__wsMock = {
  instances: MockWebSocket.instances,
  reset: () => {
    MockWebSocket.instances.length = 0;
  },
  last: () => MockWebSocket.instances.at(-1) ?? null,
};
