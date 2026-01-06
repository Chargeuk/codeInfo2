import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import ActiveRunCard from '../components/ingest/ActiveRunCard';
import useIngestStatus from '../hooks/useIngestStatus';
import type {
  WebSocketMockInstance,
  WebSocketMockRegistry,
} from './support/mockWebSocket';

function wsRegistry(): WebSocketMockRegistry {
  const registry = (
    globalThis as unknown as { __wsMock?: WebSocketMockRegistry }
  ).__wsMock;
  if (!registry) {
    throw new Error('Missing __wsMock registry; is setupTests.ts running?');
  }
  return registry;
}

function lastSocket(): WebSocketMockInstance {
  const socket = wsRegistry().last();
  if (!socket) throw new Error('No WebSocket instance created');
  return socket;
}

async function openSocket() {
  act(() => {
    jest.runOnlyPendingTimers();
  });
  await waitFor(() => expect(lastSocket().readyState).toBe(1));
}

function Harness() {
  const ingest = useIngestStatus();
  if (!ingest.status) return null;

  return (
    <ActiveRunCard
      runId={ingest.status.runId}
      status={ingest.status.state}
      counts={ingest.status.counts}
      currentFile={ingest.status.currentFile}
      fileIndex={ingest.status.fileIndex}
      fileTotal={ingest.status.fileTotal}
      percent={ingest.status.percent}
      etaMs={ingest.status.etaMs}
      lastError={ingest.status.lastError ?? undefined}
      message={ingest.status.message ?? undefined}
      isLoading={ingest.isLoading}
      isCancelling={ingest.isCancelling}
      error={ingest.error}
      onCancel={ingest.cancel}
    />
  );
}

describe('ingest status progress display', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    wsRegistry().reset();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('updates current file, percent, and ETA as WS events arrive', async () => {
    render(
      <RouterProvider
        router={createMemoryRouter(
          [
            {
              path: '/',
              element: <Harness />,
            },
          ],
          { initialEntries: ['/'] },
        )}
      />,
    );

    await openSocket();

    act(() => {
      lastSocket()._receive({
        protocolVersion: 'v1',
        type: 'ingest_update',
        seq: 1,
        status: {
          runId: 'run-progress',
          state: 'embedding',
          counts: { files: 3, chunks: 0, embedded: 0 },
          currentFile: '/repo/file-1.txt',
          fileIndex: 1,
          fileTotal: 3,
          percent: 33.3,
          etaMs: 12000,
        },
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId('ingest-current-file').textContent).toContain(
        'file-1.txt',
      ),
    );
    expect(screen.getByText(/1 \/ 3 .*33\.3% .*00:00:12/i)).toBeInTheDocument();

    act(() => {
      lastSocket()._receive({
        protocolVersion: 'v1',
        type: 'ingest_update',
        seq: 2,
        status: {
          runId: 'run-progress',
          state: 'embedding',
          counts: { files: 3, chunks: 2, embedded: 0 },
          currentFile: '/repo/file-2.txt',
          fileIndex: 2,
          fileTotal: 3,
          percent: 66.7,
          etaMs: 8000,
        },
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId('ingest-current-file').textContent).toContain(
        'file-2.txt',
      ),
    );
    expect(screen.getByText(/2 \/ 3 .*66\.7% .*00:00:08/i)).toBeInTheDocument();
  });
});
