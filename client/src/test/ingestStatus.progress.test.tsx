import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import ActiveRunCard from '../components/ingest/ActiveRunCard';
import useIngestStatus from '../hooks/useIngestStatus';

const server = setupServer();

const statusSequence = [
  {
    state: 'embedding',
    counts: { files: 3, chunks: 0, embedded: 0 },
    currentFile: '/repo/file-1.txt',
    fileIndex: 1,
    fileTotal: 3,
    percent: 33.3,
    etaMs: 12000,
  },
  {
    state: 'embedding',
    counts: { files: 3, chunks: 2, embedded: 0 },
    currentFile: '/repo/file-2.txt',
    fileIndex: 2,
    fileTotal: 3,
    percent: 66.7,
    etaMs: 8000,
  },
  {
    state: 'completed',
    counts: { files: 3, chunks: 3, embedded: 3 },
    currentFile: '/repo/file-3.txt',
    fileIndex: 3,
    fileTotal: 3,
    percent: 100,
    etaMs: 0,
  },
];

let callCount = 0;

server.use(
  http.get('http://localhost:5010/ingest/status/:runId', () => {
    const body = statusSequence[Math.min(callCount, statusSequence.length - 1)];
    callCount += 1;
    return HttpResponse.json({ runId: 'run-progress', ...body });
  }),
  http.post('http://localhost:5010/ingest/cancel/:runId', () =>
    HttpResponse.json({ status: 'ok' }),
  ),
);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  callCount = 0;
});

afterAll(() => {
  server.close();
});

function Harness({ runId }: { runId: string }) {
  const status = useIngestStatus(runId);
  return (
    <ActiveRunCard
      runId={runId}
      status={status.status}
      counts={status.counts}
      currentFile={status.currentFile}
      fileIndex={status.fileIndex}
      fileTotal={status.fileTotal}
      percent={status.percent}
      etaMs={status.etaMs}
      lastError={status.lastError ?? undefined}
      message={status.message ?? undefined}
      isLoading={status.isLoading}
      isCancelling={status.isCancelling}
      error={status.error}
      onCancel={status.cancel}
    />
  );
}

describe('ingest status progress display', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('updates current file, percent, and ETA as status responses change', async () => {
    render(
      <RouterProvider
        router={createMemoryRouter(
          [
            {
              path: '/',
              element: <Harness runId="run-progress" />,
            },
          ],
          { initialEntries: ['/'] },
        )}
      />,
    );

    // First status snapshot
    await waitFor(() =>
      expect(screen.getByTestId('ingest-current-file').textContent).toContain(
        'file-1.txt',
      ),
    );
    expect(screen.getByText(/1 \/ 3 .*33\.3% .*00:00:12/i)).toBeInTheDocument();

    // Advance polling to next snapshot
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByTestId('ingest-current-file').textContent).toContain(
        'file-2.txt',
      ),
    );
    expect(screen.getByText(/2 \/ 3 .*66\.7% .*00:00:08/i)).toBeInTheDocument();
  });
});
