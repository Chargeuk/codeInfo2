import { TextDecoder, TextEncoder } from 'util';
import { jest } from '@jest/globals';
import '@testing-library/jest-dom';
import {
  asFetchImplementation,
  getFetchMock,
  mockJsonResponse,
} from './support/fetchMock';
import {
  SimpleHeaders,
  SimpleRequest,
  SimpleResponse,
} from './support/fetchPolyfills';
import { installMockWebSocket } from './support/mockWebSocket';

// React 19 uses this global to decide whether it should warn about act().
// In Jest + JSDOM the check is sensitive to where the flag is attached.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const windowRef = globalThis.window;
if (windowRef) {
  windowRef.IS_REACT_ACT_ENVIRONMENT = true;
}

globalThis.__CODEINFO_TEST__ = true;
if (windowRef) {
  windowRef.__CODEINFO_TEST__ = true;
}

const nodeGlobals = globalThis as typeof globalThis & {
  TextEncoder?: typeof globalThis.TextEncoder;
  TextDecoder?: typeof globalThis.TextDecoder;
  Response?: typeof Response;
  Headers?: typeof Headers;
  Request?: typeof Request;
};

// Provide TextEncoder/Decoder for libraries that expect them in the JSDOM environment.
if (!nodeGlobals.TextEncoder) {
  nodeGlobals.TextEncoder =
    TextEncoder as unknown as typeof globalThis.TextEncoder;
}
if (!nodeGlobals.TextDecoder) {
  nodeGlobals.TextDecoder =
    TextDecoder as unknown as typeof globalThis.TextDecoder;
}

if (!nodeGlobals.Response) {
  nodeGlobals.Response = SimpleResponse as unknown as typeof Response;
}

if (!nodeGlobals.Headers) {
  nodeGlobals.Headers = SimpleHeaders as unknown as typeof Headers;
}

if (!nodeGlobals.Request) {
  nodeGlobals.Request = SimpleRequest as unknown as typeof Request;
}

if (!globalThis.fetch || !('mockImplementation' in globalThis.fetch)) {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: jest.fn<typeof fetch>(),
  });
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  const allLists = new Set<MediaQueryList>();
  let resizeListenerInstalled = false;

  window.matchMedia = (query: string) => {
    const normalized = query.replace(/^@media\s*/i, '').trim();
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    let lastMatches: boolean | null = null;

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
      addEventListener: (
        _type: string,
        listener: EventListenerOrEventListenerObject,
      ) => {
        if (typeof listener === 'function') {
          listeners.add(listener as (event: MediaQueryListEvent) => void);
        }
      },
      removeEventListener: (
        _type: string,
        listener: EventListenerOrEventListenerObject,
      ) => {
        if (typeof listener === 'function') {
          listeners.delete(listener as (event: MediaQueryListEvent) => void);
        }
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

    const dispatchChangeIfNeeded = () => {
      const next = computeMatches();
      if (lastMatches === null) {
        lastMatches = next;
        return;
      }
      if (next === lastMatches) return;
      lastMatches = next;

      const event = { matches: next, media: query } as MediaQueryListEvent;
      list.dispatchEvent(event);
      if (typeof list.onchange === 'function') {
        list.onchange(event);
      }
    };

    if (!resizeListenerInstalled) {
      resizeListenerInstalled = true;
      window.addEventListener('resize', () => {
        for (const list of allLists) {
          (
            list as unknown as { __dispatchChangeIfNeeded?: () => void }
          ).__dispatchChangeIfNeeded?.();
        }
      });
    }

    (
      list as unknown as { __dispatchChangeIfNeeded?: () => void }
    ).__dispatchChangeIfNeeded = dispatchChangeIfNeeded;
    allLists.add(list);
    dispatchChangeIfNeeded();

    return list;
  };
}

// Default fetch mock for tests; individual tests can override as needed.
getFetchMock().mockImplementation(
  asFetchImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/chat/providers')) {
      return mockJsonResponse({
        providers: [
          {
            id: 'lmstudio',
            label: 'LM Studio',
            available: true,
            toolsAvailable: true,
          },
        ],
      });
    }
    if (url.includes('/chat/models')) {
      return mockJsonResponse({
        provider: 'lmstudio',
        available: true,
        toolsAvailable: true,
        models: [
          { key: 'm1', displayName: 'Model 1', type: 'gguf' },
          { key: 'embed', displayName: 'Embedding Model', type: 'embedding' },
        ],
      });
    }
    return mockJsonResponse({ version: '0.0.0', app: 'server' });
  }),
);

installMockWebSocket();
