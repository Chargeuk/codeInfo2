import { jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import ActiveRunCard from '../components/ingest/ActiveRunCard';
import useIngestStatus from '../hooks/useIngestStatus';
import IngestPage from '../pages/IngestPage';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch.mockReset();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

function Harness({ initialRunId }: { initialRunId: string }) {
  const status = useIngestStatus(initialRunId);
  return (
    <ActiveRunCard
      runId={initialRunId}
      status={status.status}
      counts={status.counts}
      lastError={status.lastError ?? undefined}
      message={status.message ?? undefined}
      isLoading={status.isLoading}
      isCancelling={status.isCancelling}
      error={status.error}
      onCancel={status.cancel}
    />
  );
}

describe('useIngestStatus + ActiveRunCard', () => {
  it('polls until completed then stops', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'completed', counts: { files: 2 } }),
      });

    render(
      <RouterProvider
        router={createMemoryRouter(
          [
            {
              path: '/',
              element: <Harness initialRunId="run-1" />,
            },
          ],
          { initialEntries: ['/'] },
        )}
      />,
    );

    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });

    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/completed/i)).toBeInTheDocument();
    expect(screen.getByText(/files/i).nextSibling?.textContent).toBe('2');
  });

  it('polls until skipped then stops', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'skipped', counts: { files: 1 } }),
      });

    render(
      <RouterProvider
        router={createMemoryRouter(
          [
            {
              path: '/',
              element: <Harness initialRunId="run-skip" />,
            },
          ],
          { initialEntries: ['/'] },
        )}
      />,
    );

    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });

    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });

    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('skipped')).toBeInTheDocument();
  });

  it('renders a skipped status label', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ state: 'skipped', counts: { files: 0 } }),
    });

    render(
      <RouterProvider
        router={createMemoryRouter(
          [
            {
              path: '/',
              element: <Harness initialRunId="run-skip-label" />,
            },
          ],
          { initialEntries: ['/'] },
        )}
      />,
    );

    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });

    expect(await screen.findByText('skipped')).toBeInTheDocument();
  });

  it('cancels run via cancel button', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'embedding', counts: { files: 1 } }),
      });

    // cancel call response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' }),
    });

    render(
      <RouterProvider
        router={createMemoryRouter(
          [
            {
              path: '/',
              element: <Harness initialRunId="run-2" />,
            },
          ],
          { initialEntries: ['/'] },
        )}
      />,
    );

    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });

    const cancelButton = await screen.findByRole('button', {
      name: /cancel ingest/i,
    });

    await act(async () => {
      cancelButton.click();
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalled();
    expect(await screen.findByText(/cancelled/i)).toBeInTheDocument();
  });

  it('renders logs link with runId', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ state: 'completed', counts: { files: 1 } }),
    });

    render(
      <RouterProvider
        router={createMemoryRouter(
          [
            {
              path: '/',
              element: <Harness initialRunId="run-logs" />,
            },
          ],
          { initialEntries: ['/'] },
        )}
      />,
    );

    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });

    const link = await screen.findByRole('link', {
      name: /view logs for this run/i,
    });
    expect(link).toHaveAttribute('href', '/logs?text=run-logs');
  });
});

describe('IngestPage skipped terminal behaviour', () => {
  function setupFetchForSkippedRun() {
    const calls = { models: 0, roots: 0, start: 0, status: 0 };

    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const { pathname } = new URL(url);

      if (pathname === '/ingest/models') {
        calls.models += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: [{ id: 'embed-1', displayName: 'Embed 1' }],
            lockedModelId: null,
          }),
        };
      }

      if (pathname === '/ingest/roots') {
        calls.roots += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ roots: [], lockedModelId: null }),
        };
      }

      if (pathname === '/ingest/start' && (init?.method ?? 'GET') === 'POST') {
        calls.start += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ runId: 'run-1' }),
        };
      }

      if (pathname === '/ingest/status/run-1') {
        calls.status += 1;
        const state = calls.status === 1 ? 'embedding' : 'skipped';
        return {
          ok: true,
          status: 200,
          json: async () => ({ runId: 'run-1', state, counts: { files: 1 } }),
        };
      }

      throw new Error(`Unhandled fetch in test: ${url}`);
    });

    return calls;
  }

  it('re-enables actions after a skipped terminal state', async () => {
    setupFetchForSkippedRun();

    render(
      <RouterProvider
        router={createMemoryRouter(
          [
            {
              path: '/',
              element: <IngestPage />,
            },
          ],
          { initialEntries: ['/'] },
        )}
      />,
    );

    await screen.findByText(/Start a new ingest/i);

    fireEvent.change(screen.getByLabelText(/Folder path/i), {
      target: { value: '/data/test' },
    });
    fireEvent.change(screen.getByLabelText(/Display name/i), {
      target: { value: 'test-root' },
    });

    const startButton = screen.getByRole('button', { name: /start ingest/i });
    fireEvent.click(startButton);

    await act(async () => {
      await Promise.resolve();
    });

    expect(await screen.findByText('embedding')).toBeInTheDocument();
    expect(startButton).toBeDisabled();

    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });

    expect(await screen.findByText('skipped')).toBeInTheDocument();
    expect(startButton).toBeEnabled();
  });

  it('triggers roots + models refresh exactly once when the terminal state is skipped', async () => {
    const calls = setupFetchForSkippedRun();

    render(
      <RouterProvider
        router={createMemoryRouter(
          [
            {
              path: '/',
              element: <IngestPage />,
            },
          ],
          { initialEntries: ['/'] },
        )}
      />,
    );

    await screen.findByText(/Start a new ingest/i);

    fireEvent.change(screen.getByLabelText(/Folder path/i), {
      target: { value: '/data/test' },
    });
    fireEvent.change(screen.getByLabelText(/Display name/i), {
      target: { value: 'test-root' },
    });

    fireEvent.click(screen.getByRole('button', { name: /start ingest/i }));

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });

    expect(await screen.findByText('skipped')).toBeInTheDocument();
    expect(calls.roots).toBe(2);
    expect(calls.models).toBe(2);
  });
});
