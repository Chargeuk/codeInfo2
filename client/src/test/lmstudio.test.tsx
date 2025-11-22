import type { LmStudioStatusOk } from '@codeinfo2/common';
import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

type FetchLmStudioStatus =
  (typeof import('@codeinfo2/common'))['fetchLmStudioStatus'];

const mockFetch = jest.fn<
  ReturnType<FetchLmStudioStatus>,
  Parameters<FetchLmStudioStatus>
>();
const mockFetchServerVersion = jest.fn().mockResolvedValue({ version: 'test' });

await jest.unstable_mockModule('@codeinfo2/common', async () => ({
  __esModule: true,
  fetchLmStudioStatus: mockFetch,
  fetchServerVersion: mockFetchServerVersion,
}));

const { default: App } = await import('../App');
const { default: HomePage } = await import('../pages/HomePage');
const { default: LmStudioPage } = await import('../pages/LmStudioPage');

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

const emptyResponse: LmStudioStatusOk = { ...okResponse, models: [] };

const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'lmstudio', element: <LmStudioPage /> },
    ],
  },
];

describe('LM Studio page', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetchServerVersion.mockClear();
    localStorage.clear();
  });

  it('renders models and supports refresh actions', async () => {
    mockFetch.mockResolvedValue(okResponse);
    const router = createMemoryRouter(routes, {
      initialEntries: ['/lmstudio'],
    });
    render(<RouterProvider router={router} />);

    await userEvent.click(
      screen.getByRole('button', { name: /check status/i }),
    );

    expect(await screen.findByText(/Friendly Model/i)).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: /refresh models/i }),
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch).toHaveBeenLastCalledWith(
      expect.objectContaining({ lmBaseUrl: expect.stringMatching(/^http/) }),
    );
  });

  it('shows empty state when no models', async () => {
    mockFetch.mockResolvedValue(emptyResponse);
    const router = createMemoryRouter(routes, {
      initialEntries: ['/lmstudio'],
    });
    render(<RouterProvider router={router} />);

    await userEvent.click(
      screen.getByRole('button', { name: /check status/i }),
    );

    expect(
      await screen.findByText(/No models reported by LM Studio/i),
    ).toBeInTheDocument();
  });

  it('focuses input and shows error on failure', async () => {
    mockFetch.mockResolvedValue({
      status: 'error',
      baseUrl: 'http://bad',
      error: 'server down',
    });

    const router = createMemoryRouter(routes, {
      initialEntries: ['/lmstudio'],
    });
    render(<RouterProvider router={router} />);

    const input = screen.getByLabelText(/LM Studio base URL/i);
    await userEvent.click(
      screen.getByRole('button', { name: /check status/i }),
    );

    expect(await screen.findByText(/server down/i)).toBeInTheDocument();
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('persists new base URL and routes from home', async () => {
    mockFetch.mockResolvedValue(okResponse);
    const router = createMemoryRouter(routes, { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);

    await screen.findByText(/Client version/i);
    await userEvent.click(screen.getByRole('tab', { name: /LM Studio/i }));

    expect(router.state.location.pathname).toBe('/lmstudio');

    const input = screen.getByLabelText(/LM Studio base URL/i);
    await userEvent.clear(input);
    await userEvent.type(input, 'http://example.com:9999');
    await userEvent.click(
      screen.getByRole('button', { name: /check status/i }),
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(localStorage.getItem('lmstudio.baseUrl')).toBe(
      'http://example.com:9999',
    );
  });
});
