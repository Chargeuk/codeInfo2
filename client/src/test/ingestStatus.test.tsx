import { jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import ActiveRunCard from '../components/ingest/ActiveRunCard';
import useIngestStatus from '../hooks/useIngestStatus';

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
