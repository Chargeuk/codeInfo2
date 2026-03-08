import { mockJsonResponse } from './support/fetchMock';
import {
  SimpleHeaders,
  SimpleRequest,
  SimpleResponse,
} from './support/fetchPolyfills';

describe('fetch polyfills', () => {
  it('supports standard Headers init and mutator semantics used by test helpers', () => {
    const headers = new SimpleHeaders({
      'content-type': 'text/plain',
      'x-test': '1',
    });

    expect(headers.has('content-type')).toBe(true);
    expect(headers.get('content-type')).toBe('text/plain');

    headers.set('x-test', '2');
    expect(headers.get('x-test')).toBe('2');

    headers.append('x-list', 'one');
    headers.append('x-list', 'two');
    expect(headers.get('x-list')).toBe('one, two');
  });

  it('lets mockJsonResponse work when the test polyfills back Headers and Response', async () => {
    const originalHeaders = globalThis.Headers;
    const originalResponse = globalThis.Response;

    globalThis.Headers = SimpleHeaders as unknown as typeof Headers;
    globalThis.Response = SimpleResponse as unknown as typeof Response;

    try {
      const response = mockJsonResponse(
        { ok: true },
        { headers: { 'x-test': '1' } },
      );

      expect(response.headers.get('content-type')).toBe('application/json');
      expect(response.headers.get('x-test')).toBe('1');
      await expect(response.json()).resolves.toEqual({ ok: true });
    } finally {
      globalThis.Headers = originalHeaders;
      globalThis.Response = originalResponse;
    }
  });

  it('normalizes Request headers through the same polyfill path', () => {
    const request = new SimpleRequest('https://example.test', {
      headers: [['x-test', '1']],
    });

    expect(request.headers.get('x-test')).toBe('1');
  });
});
