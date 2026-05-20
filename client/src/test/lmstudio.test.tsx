import type { LmStudioStatusOk } from '@codeinfo2/common';
import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { getFetchMock, mockJsonResponse } from './support/fetchMock';

const mockFetchServerVersion = jest
  .fn<() => Promise<{ version: string }>>()
  .mockResolvedValue({ version: 'test' });
const mockFetchLmStudioStatus = jest.fn<() => Promise<LmStudioStatusOk>>();
const actualCommon = await import('@codeinfo2/common');

await jest.unstable_mockModule('@codeinfo2/common', async () => ({
  ...actualCommon,
  fetchServerVersion: mockFetchServerVersion,
  fetchLmStudioStatus: mockFetchLmStudioStatus,
}));

const { default: HomePage } = await import('../pages/HomePage');
const { router } = await import('../routes/router');

const okResponse: LmStudioStatusOk = {
  status: 'ok',
  baseUrl: 'http://host.docker.internal:1234',
  models: [
    {
      modelKey: 'model-key',
      displayName: 'Friendly Model',
      type: 'gguf',
      format: 'gguf',
      sizeBytes: 1024,
    },
  ],
};

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
      });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  });
  global.fetch = fetchMock as typeof fetch;
}

describe('LM Studio utility shell integration', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockFetchServerVersion.mockClear();
    mockFetchLmStudioStatus.mockReset();
    localStorage.clear();
    installProviderFetch();
    mockFetchLmStudioStatus.mockResolvedValue(okResponse);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders the shared Home LM Studio section inside the utility shell', async () => {
    render(<HomePage />);

    expect(
      await screen.findByRole('heading', { name: 'LM Studio' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Base URL/i)).toHaveValue(
      'http://host.docker.internal:1234',
    );
    expect(await screen.findByText(/Friendly Model/i)).toBeInTheDocument();
  });

  it('keeps a dirty draft local until Check status commits it and Refresh models uses the last committed URL', async () => {
    render(<HomePage />);

    const input = await screen.findByLabelText(/Base URL/i);
    await userEvent.clear(input);
    await userEvent.type(input, 'http://draft.example:4321');

    await userEvent.click(
      screen.getByRole('button', { name: /refresh models/i }),
    );
    expect(mockFetchLmStudioStatus).toHaveBeenCalled();
    expect(mockFetchLmStudioStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lmBaseUrl: 'http://host.docker.internal:1234',
      }),
    );
    expect(input).toHaveValue('http://draft.example:4321');

    await userEvent.click(
      screen.getByRole('button', { name: /check status/i }),
    );
    await waitFor(() =>
      expect(mockFetchLmStudioStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({
          lmBaseUrl: 'http://draft.example:4321',
        }),
      ),
    );
    expect(localStorage.getItem('lmstudio.baseUrl')).toBe(
      'http://draft.example:4321',
    );
  });

  it('reuses the same LM Studio section from the routed /lmstudio compatibility path', async () => {
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
