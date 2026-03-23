import type {
  ProviderAuthProviderId,
  ProviderAuthResponseFor,
  ProviderAuthState,
} from '@codeinfo2/common';

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

export type ProviderAuthFixtureName =
  `${ProviderAuthProviderId}:${ProviderAuthState}`;

export type ProviderAuthFixtureLogFn = (
  level: 'info',
  message: string,
  context: {
    fixture: ProviderAuthFixtureName;
    provider: ProviderAuthProviderId;
  },
) => void;

export type ProviderAuthFixture<
  TProvider extends ProviderAuthProviderId = ProviderAuthProviderId,
> = {
  name: `${TProvider}:${ProviderAuthState}`;
  provider: TProvider;
  state: ProviderAuthState;
  status: number;
  routePath: `/${TProvider}/device-auth`;
  payload: ProviderAuthResponseFor<TProvider>;
};

function toProviderAuthFixtureName<TProvider extends ProviderAuthProviderId>(
  provider: TProvider,
  state: ProviderAuthState,
): `${TProvider}:${ProviderAuthState}` {
  return `${provider}:${state}`;
}

function toProviderAuthRoutePath<TProvider extends ProviderAuthProviderId>(
  provider: TProvider,
): `/${TProvider}/device-auth` {
  return `/${provider}/device-auth`;
}

function defaultProviderAuthPayload<TProvider extends ProviderAuthProviderId>(
  provider: TProvider,
  state: ProviderAuthState,
): ProviderAuthResponseFor<TProvider> {
  switch (state) {
    case 'verification_ready':
      return {
        provider,
        state,
        verificationUrl: 'https://github.com/login/device',
        userCode: provider === 'copilot' ? 'COPILOT-CODE' : 'CODEX-CODE',
        displayOutput: `Open https://github.com/login/device and enter ${provider === 'copilot' ? 'COPILOT-CODE' : 'CODEX-CODE'}.`,
      } as ProviderAuthResponseFor<TProvider>;
    case 'completion_pending':
      return {
        provider,
        state,
        verificationUrl: 'https://github.com/login/device',
        userCode: provider === 'copilot' ? 'COPILOT-CODE' : 'CODEX-CODE',
        displayOutput: `${provider} authentication is still pending.`,
      } as ProviderAuthResponseFor<TProvider>;
    case 'completed':
      return { provider, state } as ProviderAuthResponseFor<TProvider>;
    case 'already_authenticated':
      return { provider, state } as ProviderAuthResponseFor<TProvider>;
    case 'failed':
      return {
        provider,
        state,
        reason: `${provider} auth failed`,
        displayOutput: `${provider} auth failed`,
      } as ProviderAuthResponseFor<TProvider>;
    case 'unavailable_before_start':
      return {
        provider,
        state,
        reason: `${provider} unavailable`,
      } as ProviderAuthResponseFor<TProvider>;
  }
}

export function createProviderAuthFixture<
  TProvider extends ProviderAuthProviderId,
>(params: {
  provider: TProvider;
  state: ProviderAuthState;
  status?: number;
  payload?: Partial<ProviderAuthResponseFor<TProvider>>;
}): ProviderAuthFixture<TProvider> {
  const base = defaultProviderAuthPayload(params.provider, params.state);
  const payload = {
    ...base,
    ...params.payload,
    provider: params.provider,
    state: params.state,
  } as ProviderAuthResponseFor<TProvider>;

  return {
    name: toProviderAuthFixtureName(params.provider, params.state),
    provider: params.provider,
    state: params.state,
    status: params.status ?? 200,
    routePath: toProviderAuthRoutePath(params.provider),
    payload,
  };
}

function toRequestPath(input: FetchRequest): string {
  if (typeof input === 'string') {
    return new URL(input, 'http://localhost').pathname;
  }
  if (input instanceof URL) {
    return input.pathname;
  }
  return new URL(input.url, 'http://localhost').pathname;
}

export function createProviderAuthFetchImplementation(params: {
  fixtures: ProviderAuthFixture[];
  fallback?: TestFetchImplementation;
  log?: ProviderAuthFixtureLogFn;
}): TestFetchImplementation {
  const queues = new Map<string, ProviderAuthFixture[]>();

  params.fixtures.forEach((fixture) => {
    const existing = queues.get(fixture.routePath) ?? [];
    existing.push(fixture);
    queues.set(fixture.routePath, existing);
  });

  return (input, init) => {
    const path = toRequestPath(input);
    const queued = queues.get(path);
    const isPost =
      typeof init?.method === 'string'
        ? init.method.toUpperCase() === 'POST'
        : true;

    if (queued && queued.length > 0 && isPost) {
      const fixture = queued.shift() ?? queued[0];
      if (fixture) {
        params.log?.(
          'info',
          'story.0000051.task10.client_auth_fixture_applied',
          {
            fixture: fixture.name,
            provider: fixture.provider,
          },
        );
        return mockJsonResponse(fixture.payload, { status: fixture.status });
      }
    }

    if (params.fallback) {
      return params.fallback(input, init);
    }

    return mockJsonResponse(
      { error: 'provider_auth_fixture_not_found', path },
      { status: 404 },
    );
  };
}

export function installProviderAuthFetchFixtures(params: {
  fixtures: ProviderAuthFixture[];
  mockFetch?: TestFetchMock;
  fallback?: TestFetchImplementation;
  log?: ProviderAuthFixtureLogFn;
}): TestFetchMock {
  const mockFetch = params.mockFetch ?? getFetchMock();
  mockFetch.mockImplementation(
    asFetchImplementation(
      createProviderAuthFetchImplementation({
        fixtures: params.fixtures,
        fallback: params.fallback,
        log: params.log,
      }),
    ),
  );
  return mockFetch;
}
