import type { LmStudioStatusOk } from '@codeinfo2/common';
import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { getFetchMock, mockJsonResponse } from './support/fetchMock';

const mockFetchServerVersion = jest
  .fn<() => Promise<{ version: string }>>()
  .mockResolvedValue({ version: '1.0.0' });
const mockFetchLmStudioStatus = jest.fn<() => Promise<LmStudioStatusOk>>();
const actualCommon = await import('@codeinfo2/common');

await jest.unstable_mockModule('@codeinfo2/common', async () => ({
  ...actualCommon,
  fetchServerVersion: mockFetchServerVersion,
  fetchLmStudioStatus: mockFetchLmStudioStatus,
}));

const { router } = await import('../routes/router');

function installProviderFetch() {
  const fetchMock = getFetchMock();
  fetchMock.mockImplementation(async (input) => {
    const href = typeof input === 'string' ? input : input.toString();
    if (href.includes('/chat/providers')) {
      return mockJsonResponse({
        providers: [
          {
            id: 'codex',
            label: 'OpenAI Codex',
            available: false,
            toolsAvailable: false,
            reason: 'codex auth required',
          },
          {
            id: 'copilot',
            label: 'GitHub Copilot',
            available: true,
            toolsAvailable: true,
          },
          {
            id: 'lmstudio',
            label: 'LM Studio',
            available: true,
            toolsAvailable: true,
          },
        ],
        selectedProvider: 'copilot',
        selectedModel: 'friendly-model',
      });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  });
  global.fetch = fetchMock as typeof fetch;
}

const okResponse: LmStudioStatusOk = {
  status: 'ok',
  baseUrl: 'http://127.0.0.1:1234',
  models: [
    {
      modelKey: 'friendly-model',
      displayName: 'Friendly Model',
      type: 'gguf',
      format: 'gguf',
      sizeBytes: 1024,
    },
  ],
};

describe('router navigation', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockFetchServerVersion.mockClear();
    mockFetchLmStudioStatus.mockReset();
    mockFetchLmStudioStatus.mockResolvedValue(okResponse);
    localStorage.clear();
    installProviderFetch();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('keeps the default route tree reachable for the visible destinations', () => {
    const childRoutes = router.routes[0]?.children ?? [];
    const childPaths = childRoutes.map((route) =>
      route.index ? '/' : (route.path ?? ''),
    );

    expect(childPaths).toEqual(
      expect.arrayContaining([
        '/',
        'chat',
        'agents',
        'flows',
        'ingest',
        'logs',
      ]),
    );
  });

  it('redirects /lmstudio into Home with the LM Studio section visible', async () => {
    const memoryRouter = createMemoryRouter(router.routes, {
      initialEntries: ['/lmstudio'],
    });

    render(<RouterProvider router={memoryRouter} />);

    expect(
      await screen.findByRole('heading', { name: 'Home' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'LM Studio' }),
    ).toBeInTheDocument();
    expect(memoryRouter.state.location.pathname).toBe('/');
  });
});
