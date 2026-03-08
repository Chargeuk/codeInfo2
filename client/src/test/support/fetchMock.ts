export type FetchRequest = Parameters<typeof fetch>[0];
export type FetchInit = Parameters<typeof fetch>[1];
export type TestFetchMock = jest.MockedFunction<typeof fetch>;
export type TestFetchImplementation = (
  input: FetchRequest,
  init?: FetchInit,
) => Response | Promise<Response>;

export function getFetchMock(): TestFetchMock {
  return globalThis.fetch as unknown as TestFetchMock;
}

export function mockJsonResponse(
  payload: unknown,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return new Response(JSON.stringify(payload), {
    ...init,
    headers,
  });
}

export function mockTextResponse(
  payload: string,
  init: ResponseInit = {},
): Response {
  return new Response(payload, init);
}

export function asFetchImplementation(
  handler: TestFetchImplementation,
): (input: FetchRequest, init?: FetchInit) => Promise<Response> {
  return async (input, init) => Promise.resolve(handler(input, init));
}
