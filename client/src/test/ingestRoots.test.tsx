import { jest } from '@jest/globals';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import RootDetailsDrawer from '../components/ingest/RootDetailsDrawer';
import RootsTable from '../components/ingest/RootsTable';
import useIngestRoots from '../hooks/useIngestRoots';
import { mockJsonResponse } from './support/fetchMock';

const mockFetch = jest.fn<typeof fetch>();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  (
    globalThis as unknown as {
      __codeinfoDebug?: { dev0000038Markers?: boolean };
    }
  ).__codeinfoDebug = undefined;
});

afterEach(() => {
  jest.restoreAllMocks();
});

function HookHarness() {
  const { roots, isLoading, isError, error } = useIngestRoots();
  if (isLoading) return <div>loading</div>;
  if (isError) return <div>error: {error}</div>;
  return (
    <ul>
      {roots.map((root) => (
        <li key={root.path}>{root.name}</li>
      ))}
    </ul>
  );
}

function HookErrorHarness() {
  const { roots, isLoading, isError, error } = useIngestRoots();
  if (isLoading) return <div>loading</div>;
  if (isError) return <div>error: {error}</div>;
  return (
    <pre data-testid="root-error">
      {JSON.stringify(roots[0]?.error ?? null, null, 2)}
    </pre>
  );
}

describe('useIngestRoots', () => {
  it('loads roots from the server', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        roots: [
          {
            runId: 'run-1',
            name: 'repo',
            description: 'demo',
            path: '/repo',
            model: 'embed-1',
            status: 'completed',
            lastIngestAt: '2025-01-01T00:00:00.000Z',
            counts: { files: 2, chunks: 4, embedded: 4 },
            lastError: null,
          },
        ],
      }),
    );

    render(
      <RouterProvider
        router={createMemoryRouter([
          {
            path: '/',
            element: <HookHarness />,
          },
        ])}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/ingest/roots'),
      expect.any(Object),
    );
    expect(await screen.findByText('repo')).toBeInTheDocument();
  });

  it('preserves upstreamStatus and retryAfterMs from /ingest/roots error payloads', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        roots: [
          {
            runId: 'run-1',
            name: 'repo',
            path: '/repo',
            model: 'embed-1',
            status: 'error',
            lastError: 'rate limited',
            error: {
              error: 'OPENAI_RATE_LIMITED',
              message: 'rate limited',
              retryable: true,
              status: 429,
              upstreamStatus: 503,
              retryAfterMs: 1200,
            },
          },
        ],
      }),
    );

    render(
      <RouterProvider
        router={createMemoryRouter([
          {
            path: '/',
            element: <HookErrorHarness />,
          },
        ])}
      />,
    );

    expect(await screen.findByTestId('root-error')).toHaveTextContent(
      '"upstreamStatus": 503',
    );
    expect(screen.getByTestId('root-error')).toHaveTextContent(
      '"retryAfterMs": 1200',
    );
  });
});

describe('RootsTable', () => {
  const root = {
    runId: 'run-1',
    name: 'repo',
    description: 'demo repo',
    path: '/repo',
    model: 'embed-1',
    status: 'completed',
    lastIngestAt: '2025-01-01T00:00:00.000Z',
    counts: { files: 2, chunks: 4, embedded: 4 },
    lastError: null,
  } as const;
  const rootWithAst = {
    ...root,
    ast: {
      supportedFileCount: 9,
      skippedFileCount: 8,
      failedFileCount: 7,
      lastIndexedAt: '2025-01-01T01:23:45.000Z',
    },
  } as const;

  it('shows empty state copy when no roots', () => {
    render(
      <RootsTable
        roots={[]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    expect(screen.getByText(/No embedded folders yet/i)).toBeInTheDocument();
  });

  it('treats immediate running re-embed response as non-queued and ignores stale queuePosition', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        queued: false,
        requestId: 'queue-request-1',
        runId: 'new-run',
        queueState: 'running',
        queuePosition: 9,
      }),
    );
    const onRunStarted = jest.fn();
    const onRefresh: () => Promise<void> = jest.fn(async () => undefined);

    render(
      <RootsTable
        roots={[root]}
        lockedModelId="embed-1"
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={onRefresh}
        onRunStarted={onRunStarted}
      />,
    );

    const row = await screen.findByRole('row', { name: /repo/i });
    const btn = within(row).getByRole('button', { name: /re-embed/i });
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/ingest/reembed/%2Frepo'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(onRunStarted).toHaveBeenCalledWith('new-run');
    expect(onRefresh).toHaveBeenCalled();
    expect(await screen.findByText('Re-embed started')).toBeInTheDocument();
  });

  it('uses canonical row identity, not stale display path, for row re-embed payloads', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ requestId: 'queue-request-1', runId: 'new-run' }),
    );
    const onRefresh: () => Promise<void> = jest.fn(async () => undefined);

    render(
      <RootsTable
        roots={[
          {
            ...root,
            id: '/canonical-repo',
            path: '/stale-display-path',
          },
        ]}
        lockedModelId="embed-1"
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={onRefresh}
      />,
    );

    const row = await screen.findByRole('row', { name: /repo/i });
    const btn = within(row).getByRole('button', { name: /re-embed/i });
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/ingest/reembed/%2Fcanonical-repo'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/ingest/reembed/%2Fstale-display-path'),
      expect.any(Object),
    );
  });

  it('shows an error when a re-embed 2xx response omits requestId', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ runId: 'new-run' }));
    const onRunStarted = jest.fn();

    render(
      <RootsTable
        roots={[root]}
        lockedModelId="embed-1"
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
        onRunStarted={onRunStarted}
      />,
    );

    const row = await screen.findByRole('row', { name: /repo/i });
    const btn = within(row).getByRole('button', { name: /re-embed/i });
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });

    expect(
      await screen.findByText('Missing requestId in response'),
    ).toBeInTheDocument();
    expect(onRunStarted).not.toHaveBeenCalled();
  });

  it('shows an error when a re-embed 2xx response includes requestId but proves neither queued nor running acceptance', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ requestId: 'queue-request-1' }),
    );
    const onRunStarted = jest.fn();

    render(
      <RootsTable
        roots={[root]}
        lockedModelId="embed-1"
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
        onRunStarted={onRunStarted}
      />,
    );

    const row = await screen.findByRole('row', { name: /repo/i });
    const btn = within(row).getByRole('button', { name: /re-embed/i });
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });

    expect(
      await screen.findByText('Malformed re-embed response'),
    ).toBeInTheDocument();
    expect(onRunStarted).not.toHaveBeenCalled();
  });

  it('treats requestId plus queued metadata as queued re-embed success without notifying parent', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        requestId: 'queue-request-1',
        queued: true,
        queuePosition: 1,
      }),
    );
    const onRunStarted = jest.fn();
    const onRefresh: () => Promise<void> = jest.fn(async () => undefined);

    render(
      <RootsTable
        roots={[root]}
        lockedModelId="embed-1"
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={onRefresh}
        onRunStarted={onRunStarted}
      />,
    );

    const row = await screen.findByRole('row', { name: /repo/i });
    const btn = within(row).getByRole('button', { name: /re-embed/i });
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });

    expect(await screen.findByText('Queued (#1)')).toBeInTheDocument();
    expect(onRunStarted).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalled();
  });

  it('uses persisted root path, not canonical row identity, for row Remove payloads', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ status: 'ok', unlocked: true }),
    );
    const onRefresh: () => Promise<void> = jest.fn(async () => undefined);

    render(
      <RootsTable
        roots={[
          {
            ...root,
            id: '/canonical-repo',
            path: '/persisted-root',
          },
        ]}
        lockedModelId="embed-1"
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={onRefresh}
      />,
    );

    const row = await screen.findByRole('row', { name: /repo/i });
    const btn = within(row).getByRole('button', { name: /^Remove$/i });
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/ingest/remove/%2Fpersisted-root'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/ingest/remove/%2Fcanonical-repo'),
      expect.any(Object),
    );
    expect(await screen.findByText(/Removed/)).toBeInTheDocument();
  });

  it('clears row Remove selection by stable key after submitting persisted root path', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ status: 'ok', unlocked: true }),
    );

    render(
      <RootsTable
        roots={[
          {
            ...root,
            id: '/canonical-repo',
            path: '/persisted-root',
          },
        ]}
        lockedModelId="embed-1"
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    fireEvent.click(
      await screen.findByRole('checkbox', { name: /select repo/i }),
    );
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    const row = await screen.findByRole('row', { name: /repo/i });
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: /^Remove$/i }));
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/ingest/remove/%2Fpersisted-root'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(await screen.findByText(/Removed/)).toBeInTheDocument();
    expect(screen.getByText('0 selected')).toBeInTheDocument();
  });

  it('keeps destructive remove gated while queueable re-embed stays available during an active run', async () => {
    render(
      <RootsTable
        roots={[root]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        hasActiveRun
        onRefresh={() => Promise.resolve()}
      />,
    );

    const row = await screen.findByRole('row', { name: /repo/i });
    expect(
      within(row).getByRole('button', { name: /re-embed/i }),
    ).toBeEnabled();
    expect(
      within(row).getByRole('button', { name: /^Remove$/i }),
    ).toBeDisabled();
  });

  it('keeps waiting rows out of bulk re-embed selection and disables the matching row action', async () => {
    render(
      <RootsTable
        roots={[
          {
            ...root,
            path: '/repo-queued',
            name: 'repo-queued',
            status: 'ingesting',
            phase: 'queued',
            queueState: 'waiting',
            queuePosition: 1,
            runId: null,
            requestId: 'queue-request-1',
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    const queuedRow = await screen.findByRole('row', { name: /repo-queued/i });
    const queuedCheckbox = within(queuedRow).getByRole('checkbox', {
      name: /select repo-queued/i,
    });
    const queuedReembed = within(queuedRow).getByRole('button', {
      name: /re-embed/i,
    });
    const bulkRemove = screen.getByRole('button', { name: /remove selected/i });
    const bulkReembed = screen.getByRole('button', {
      name: /re-embed selected/i,
    });

    expect(queuedCheckbox).toBeDisabled();
    expect(queuedReembed).toBeDisabled();
    expect(bulkRemove).toBeDisabled();
    expect(bulkReembed).toBeDisabled();
    fireEvent.click(queuedCheckbox);
    expect(screen.getByText('0 selected')).toBeInTheDocument();
    expect(bulkRemove).toBeDisabled();
    expect(bulkReembed).toBeDisabled();
  });

  it('keeps row-level Remove disabled for queued and cleanup-blocked rows', async () => {
    render(
      <RootsTable
        roots={[
          {
            ...root,
            path: '/repo-queued',
            name: 'repo-queued',
            status: 'ingesting',
            phase: 'queued',
            queueState: 'waiting',
            queuePosition: 1,
            runId: null,
            requestId: 'queue-request-queued',
          },
          {
            ...root,
            path: '/repo-cleanup',
            name: 'repo-cleanup',
            status: 'ingesting',
            phase: 'embedding',
            queueState: 'cleanup-blocked',
            runId: 'run-cleanup',
            requestId: 'queue-request-cleanup',
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    const queuedRow = await screen.findByRole('row', { name: /repo-queued/i });
    const cleanupRow = await screen.findByRole('row', {
      name: /repo-cleanup/i,
    });

    expect(
      within(queuedRow).getByRole('button', { name: /^Remove$/i }),
    ).toBeDisabled();
    expect(
      within(cleanupRow).getByRole('button', { name: /^Remove$/i }),
    ).toBeDisabled();
  });

  it('keeps running rows out of mixed bulk selection and disables the matching row re-embed action', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ status: 'ok', unlocked: true }),
    );

    render(
      <RootsTable
        roots={[
          root,
          {
            ...root,
            path: '/repo-running',
            name: 'repo-running',
            status: 'ingesting',
            phase: 'embedding',
            queueState: 'running',
            runId: 'run-active',
            requestId: 'queue-request-2',
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    const selectAll = await screen.findByRole('checkbox', {
      name: /select all roots/i,
    });
    const runningRow = await screen.findByRole('row', {
      name: /repo-running/i,
    });
    const bulkRemove = screen.getByRole('button', { name: /remove selected/i });
    const bulkReembed = screen.getByRole('button', {
      name: /re-embed selected/i,
    });
    const runningReembed = within(runningRow).getByRole('button', {
      name: /re-embed/i,
    });

    expect(
      within(runningRow).getByRole('checkbox', {
        name: /select repo-running/i,
      }),
    ).toBeDisabled();
    expect(runningReembed).toBeDisabled();

    fireEvent.click(selectAll);
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(bulkRemove).toBeEnabled();
    expect(bulkReembed).toBeEnabled();

    await act(async () => {
      fireEvent.click(bulkRemove);
      await Promise.resolve();
    });

    const removeCalls = mockFetch.mock.calls.filter(([url]) =>
      String(url).includes('/ingest/remove/'),
    );

    expect(removeCalls).toHaveLength(1);
    expect(String(removeCalls[0]?.[0] ?? '')).toContain(
      '/ingest/remove/%2Frepo',
    );
    expect(String(removeCalls[0]?.[0] ?? '')).not.toContain('/repo-running');
  });

  it('keeps active ingest head rows without queueState out of mixed selection counts and remove targets', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ status: 'ok', unlocked: true }),
    );

    render(
      <RootsTable
        roots={[
          root,
          {
            ...root,
            path: '/repo-active-head',
            name: 'repo-active-head',
            status: 'ingesting',
            phase: 'embedding',
            runId: 'run-active-head',
            requestId: 'queue-request-head',
            queueState: undefined,
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    const selectAll = await screen.findByRole('checkbox', {
      name: /select all roots/i,
    });
    const activeRow = await screen.findByRole('row', {
      name: /repo-active-head/i,
    });
    const activeCheckbox = within(activeRow).getByRole('checkbox', {
      name: /select repo-active-head/i,
    });
    const bulkRemove = screen.getByRole('button', { name: /remove selected/i });

    expect(activeCheckbox).toBeDisabled();
    fireEvent.click(activeCheckbox);
    expect(screen.getByText('0 selected')).toBeInTheDocument();

    fireEvent.click(selectAll);
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(bulkRemove).toBeEnabled();

    await act(async () => {
      fireEvent.click(bulkRemove);
      await Promise.resolve();
    });

    const removeCalls = mockFetch.mock.calls.filter(([url]) =>
      String(url).includes('/ingest/remove/'),
    );

    expect(removeCalls).toHaveLength(1);
    expect(String(removeCalls[0]?.[0] ?? '')).toContain(
      '/ingest/remove/%2Frepo',
    );
    expect(String(removeCalls[0]?.[0] ?? '')).not.toContain(
      '/repo-active-head',
    );
  });

  it('disables the row-level Re-embed and Remove buttons for an active ingest head without queueState', async () => {
    render(
      <RootsTable
        roots={[
          {
            ...root,
            path: '/repo-active-head',
            name: 'repo-active-head',
            status: 'ingesting',
            phase: 'embedding',
            runId: 'run-active-head',
            requestId: 'queue-request-head',
            queueState: undefined,
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    const activeRow = await screen.findByRole('row', {
      name: /repo-active-head/i,
    });

    expect(
      within(activeRow).getByRole('button', { name: /^Remove$/i }),
    ).toBeDisabled();
    expect(
      within(activeRow).getByRole('button', { name: /re-embed/i }),
    ).toBeDisabled();
  });

  it('keeps active ingest head rows without queueState out of shared destructive selection', async () => {
    render(
      <RootsTable
        roots={[
          {
            ...root,
            path: '/repo-active-head',
            name: 'repo-active-head',
            status: 'ingesting',
            phase: 'embedding',
            runId: 'run-active-head',
            requestId: 'queue-request-head',
            queueState: undefined,
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    const activeRow = await screen.findByRole('row', {
      name: /repo-active-head/i,
    });
    const activeCheckbox = within(activeRow).getByRole('checkbox', {
      name: /select repo-active-head/i,
    });
    const bulkRemove = screen.getByRole('button', { name: /remove selected/i });

    expect(activeCheckbox).toBeDisabled();
    fireEvent.click(activeCheckbox);
    expect(screen.getByText('0 selected')).toBeInTheDocument();
    expect(bulkRemove).toBeDisabled();
  });

  it('maps bulk Remove selected stable keys to persisted root paths when id differs from path', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (
        url.includes('/ingest/remove/%2Fpersisted-a') ||
        url.includes('/ingest/remove/%2Fpersisted-b')
      ) {
        return mockJsonResponse({ status: 'ok', unlocked: false });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const onRefresh: () => Promise<void> = jest.fn(async () => undefined);
    const onRefreshModels: () => Promise<void> = jest.fn(async () => undefined);

    render(
      <RootsTable
        roots={[
          {
            ...root,
            id: '/canonical-a',
            path: '/persisted-a',
            name: 'repo-a',
          },
          {
            ...root,
            id: '/canonical-b',
            path: '/persisted-b',
            name: 'repo-b',
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={onRefresh}
        onRefreshModels={onRefreshModels}
      />,
    );

    fireEvent.click(
      await screen.findByRole('checkbox', { name: /select all roots/i }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /remove selected/i }));
      await Promise.resolve();
    });

    const removeUrls = mockFetch.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/ingest/remove/'));

    expect(removeUrls).toHaveLength(2);
    expect(removeUrls).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/ingest/remove/%2Fpersisted-a'),
        expect.stringContaining('/ingest/remove/%2Fpersisted-b'),
      ]),
    );
    expect(removeUrls.join(' ')).not.toContain('/canonical-a');
    expect(removeUrls.join(' ')).not.toContain('/canonical-b');
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefreshModels).toHaveBeenCalledTimes(1);
    expect(screen.getByText('0 selected')).toBeInTheDocument();
  });

  it('keeps bulk Re-embed on canonical identity when bulk Remove uses persisted root paths', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (
        url.includes('/ingest/reembed/%2Fcanonical-a') ||
        url.includes('/ingest/reembed/%2Fcanonical-b')
      ) {
        return mockJsonResponse({
          requestId: 'queue-request',
          runId: 'run-reembed',
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <RootsTable
        roots={[
          {
            ...root,
            id: '/canonical-a',
            path: '/persisted-a',
            name: 'repo-a',
          },
          {
            ...root,
            id: '/canonical-b',
            path: '/persisted-b',
            name: 'repo-b',
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    fireEvent.click(
      await screen.findByRole('checkbox', { name: /select all roots/i }),
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /re-embed selected/i }),
      );
      await Promise.resolve();
    });

    const reembedUrls = mockFetch.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/ingest/reembed/'));

    expect(reembedUrls).toHaveLength(2);
    expect(reembedUrls).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/ingest/reembed/%2Fcanonical-a'),
        expect.stringContaining('/ingest/reembed/%2Fcanonical-b'),
      ]),
    );
    expect(reembedUrls.join(' ')).not.toContain('/persisted-a');
    expect(reembedUrls.join(' ')).not.toContain('/persisted-b');
  });

  it('retains stale selected keys locally while excluding queued running cleanup-blocked and active rows from bulk Remove payloads', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/ingest/remove/%2Fpersisted-eligible')) {
        return mockJsonResponse({ status: 'ok', unlocked: false });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const onRefresh: () => Promise<void> = jest.fn(async () => undefined);
    const { rerender } = render(
      <RootsTable
        roots={[
          {
            ...root,
            id: '/canonical-eligible',
            path: '/persisted-eligible',
            name: 'repo-eligible',
          },
          {
            ...root,
            id: '/canonical-queued',
            path: '/persisted-queued',
            name: 'repo-queued',
          },
          {
            ...root,
            id: '/canonical-running',
            path: '/persisted-running',
            name: 'repo-running',
          },
          {
            ...root,
            id: '/canonical-cleanup',
            path: '/persisted-cleanup',
            name: 'repo-cleanup',
          },
          {
            ...root,
            id: '/canonical-active',
            path: '/persisted-active',
            name: 'repo-active',
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(
      await screen.findByRole('checkbox', { name: /select all roots/i }),
    );
    expect(screen.getByText('5 selected')).toBeInTheDocument();

    rerender(
      <RootsTable
        roots={[
          {
            ...root,
            id: '/canonical-eligible',
            path: '/persisted-eligible',
            name: 'repo-eligible',
          },
          {
            ...root,
            id: '/canonical-queued',
            path: '/persisted-queued',
            name: 'repo-queued',
            status: 'ingesting',
            phase: 'queued',
            queueState: 'waiting',
            requestId: 'queue-request-queued',
            runId: null,
          },
          {
            ...root,
            id: '/canonical-running',
            path: '/persisted-running',
            name: 'repo-running',
            status: 'ingesting',
            phase: 'embedding',
            queueState: 'running',
            requestId: 'queue-request-running',
            runId: 'run-running',
          },
          {
            ...root,
            id: '/canonical-cleanup',
            path: '/persisted-cleanup',
            name: 'repo-cleanup',
            status: 'ingesting',
            phase: 'embedding',
            queueState: 'cleanup-blocked',
            requestId: 'queue-request-cleanup',
            runId: 'run-cleanup',
          },
          {
            ...root,
            id: '/canonical-active',
            path: '/persisted-active',
            name: 'repo-active',
            status: 'ingesting',
            phase: 'embedding',
            queueState: undefined,
            requestId: 'queue-request-active',
            runId: 'run-active',
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByText('5 selected')).toBeInTheDocument();
    for (const name of [
      'repo-queued',
      'repo-running',
      'repo-cleanup',
      'repo-active',
    ]) {
      const row = screen.getByRole('row', { name: new RegExp(name, 'i') });
      expect(
        within(row).getByRole('checkbox', {
          name: new RegExp(`select ${name}`, 'i'),
        }),
      ).toBeChecked();
      expect(
        within(row).getByRole('checkbox', {
          name: new RegExp(`select ${name}`, 'i'),
        }),
      ).toBeDisabled();
    }

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /remove selected/i }));
      await Promise.resolve();
    });

    const removeUrls = mockFetch.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/ingest/remove/'));

    expect(removeUrls).toEqual([
      expect.stringContaining('/ingest/remove/%2Fpersisted-eligible'),
    ]);
    expect(removeUrls.join(' ')).not.toContain('persisted-queued');
    expect(removeUrls.join(' ')).not.toContain('persisted-running');
    expect(removeUrls.join(' ')).not.toContain('persisted-cleanup');
    expect(removeUrls.join(' ')).not.toContain('persisted-active');
    expect(screen.getByText('4 selected')).toBeInTheDocument();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('reports partial failure honestly after a mixed-success bulk remove', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/ingest/remove/%2Frepo-success')) {
        return mockJsonResponse({ status: 'ok', unlocked: false });
      }
      if (url.includes('/ingest/remove/%2Frepo-failed')) {
        return mockJsonResponse({ status: 'error' }, { status: 500 });
      }
      if (url.includes('/ingest/roots')) {
        return mockJsonResponse({ roots: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <RootsTable
        roots={[
          { ...root, path: '/repo-success', name: 'repo-success' },
          { ...root, path: '/repo-failed', name: 'repo-failed' },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    await screen.findByRole('checkbox', { name: /select all roots/i });
    fireEvent.click(
      screen.getByRole('checkbox', { name: /select repo-success/i }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: /select repo-failed/i }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /remove selected/i }));
      await Promise.resolve();
    });

    expect(
      await screen.findByText(
        'Partial failure: 1 of 2 selected actions completed. 1 failed and remain selected for retry.',
      ),
    ).toBeInTheDocument();
  });

  it('retains only failing rows after a mixed-success bulk remove settles', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/ingest/remove/%2Frepo-success')) {
        return mockJsonResponse({ status: 'ok', unlocked: false });
      }
      if (url.includes('/ingest/remove/%2Frepo-failed')) {
        return mockJsonResponse({ status: 'error' }, { status: 500 });
      }
      if (url.includes('/ingest/roots')) {
        return mockJsonResponse({ roots: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <RootsTable
        roots={[
          { ...root, path: '/repo-success', name: 'repo-success' },
          { ...root, path: '/repo-failed', name: 'repo-failed' },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    await screen.findByRole('checkbox', { name: /select all roots/i });
    fireEvent.click(
      screen.getByRole('checkbox', { name: /select repo-success/i }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: /select repo-failed/i }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /remove selected/i }));
      await Promise.resolve();
    });

    expect(await screen.findByText('1 selected')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /select repo-failed/i }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /select repo-success/i }),
    ).not.toBeChecked();
  });

  it('reports full bulk failure honestly and keeps failed rows selected for retry', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/ingest/remove/%2Frepo-failed-a')) {
        return mockJsonResponse({ status: 'error' }, { status: 500 });
      }
      if (url.includes('/ingest/remove/%2Frepo-failed-b')) {
        return mockJsonResponse({ status: 'error' }, { status: 503 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <RootsTable
        roots={[
          { ...root, path: '/repo-failed-a', name: 'repo-failed-a' },
          { ...root, path: '/repo-failed-b', name: 'repo-failed-b' },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    await screen.findByRole('checkbox', { name: /select all roots/i });
    fireEvent.click(
      screen.getByRole('checkbox', { name: /select repo-failed-a/i }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: /select repo-failed-b/i }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /remove selected/i }));
      await Promise.resolve();
    });

    expect(
      await screen.findByText(
        '2 selected actions failed. The failed rows remain selected for retry.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /select repo-failed-a/i }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /select repo-failed-b/i }),
    ).toBeChecked();
  });

  it('normalizes failed responses and thrown per-row failures into the same mixed-success bulk contract', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/ingest/remove/%2Frepo-success')) {
        return mockJsonResponse({ status: 'ok', unlocked: false });
      }
      if (url.includes('/ingest/remove/%2Frepo-failed-response')) {
        return mockJsonResponse({ status: 'error' }, { status: 500 });
      }
      if (url.includes('/ingest/remove/%2Frepo-failed-throw')) {
        throw new Error('network down');
      }
      if (url.includes('/ingest/roots')) {
        return mockJsonResponse({ roots: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <RootsTable
        roots={[
          { ...root, path: '/repo-success', name: 'repo-success' },
          {
            ...root,
            path: '/repo-failed-response',
            name: 'repo-failed-response',
          },
          { ...root, path: '/repo-failed-throw', name: 'repo-failed-throw' },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    await screen.findByRole('checkbox', { name: /select all roots/i });
    fireEvent.click(
      screen.getByRole('checkbox', { name: /select repo-success/i }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: /select repo-failed-response/i }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: /select repo-failed-throw/i }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /remove selected/i }));
      await Promise.resolve();
    });

    expect(
      await screen.findByText(
        'Partial failure: 1 of 3 selected actions completed. 2 failed and remain selected for retry.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /select repo-failed-response/i }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /select repo-failed-throw/i }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /select repo-success/i }),
    ).not.toBeChecked();
    expect(await screen.findByText('Remove failed (500)')).toBeInTheDocument();
    expect(await screen.findByText('network down')).toBeInTheDocument();
  });

  it('keeps active running rows out of visible mixed selection when the page reports the active run id', async () => {
    render(
      <RootsTable
        roots={[
          root,
          {
            ...root,
            path: '/repo-running-live',
            name: 'repo-running-live',
            status: 'ingesting',
            phase: 'scanning',
            queueState: 'running',
            runId: 'run-active-live',
            requestId: 'queue-request-live',
          },
        ]}
        activeRunId="run-active-live"
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        hasActiveRun
        onRefresh={() => Promise.resolve()}
      />,
    );

    const selectAll = await screen.findByRole('checkbox', {
      name: /select all roots/i,
    });
    const runningRow = await screen.findByRole('row', {
      name: /repo-running-live/i,
    });
    const runningCheckbox = within(runningRow).getByRole('checkbox', {
      name: /select repo-running-live/i,
    });
    const runningReembed = within(runningRow).getByRole('button', {
      name: /re-embed/i,
    });
    const bulkRemove = screen.getByRole('button', { name: /remove selected/i });
    const bulkReembed = screen.getByRole('button', {
      name: /re-embed selected/i,
    });

    expect(runningCheckbox).toBeDisabled();
    expect(runningReembed).toBeDisabled();
    fireEvent.click(runningCheckbox);
    expect(screen.getByText('0 selected')).toBeInTheDocument();

    fireEvent.click(selectAll);
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(bulkRemove).toBeDisabled();
    expect(bulkReembed).toBeEnabled();
  });

  it('retains a stale selected key locally but excludes it from bulk re-embed when live row data becomes queue-blocked', async () => {
    const { rerender } = render(
      <RootsTable
        roots={[{ ...root, path: '/repo-transition', name: 'repo-transition' }]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    fireEvent.click(
      await screen.findByRole('checkbox', { name: /select repo-transition/i }),
    );
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /re-embed selected/i }),
    ).toBeEnabled();

    rerender(
      <RootsTable
        roots={[
          {
            ...root,
            path: '/repo-transition',
            name: 'repo-transition',
            status: 'ingesting',
            phase: 'queued',
            queueState: 'waiting',
            requestId: 'queue-request-transition',
            runId: null,
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /re-embed selected/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole('checkbox', { name: /select repo-transition/i }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /select repo-transition/i }),
    ).toBeDisabled();
  });

  it('refreshes roots and models once after a successful bulk re-embed batch', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/ingest/reembed/%2Frepo-a')) {
        return mockJsonResponse({
          requestId: 'queue-request-a',
          runId: 'run-a',
        });
      }
      if (url.includes('/ingest/reembed/%2Frepo-b')) {
        return mockJsonResponse({
          requestId: 'queue-request-b',
          runId: 'run-b',
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const onRefresh: () => Promise<void> = jest.fn(async () => undefined);
    const onRefreshModels: () => Promise<void> = jest.fn(async () => undefined);

    render(
      <RootsTable
        roots={[
          { ...root, path: '/repo-a', name: 'repo-a' },
          { ...root, path: '/repo-b', name: 'repo-b' },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={onRefresh}
        onRefreshModels={onRefreshModels}
      />,
    );

    fireEvent.click(
      await screen.findByRole('checkbox', { name: /select all roots/i }),
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /re-embed selected/i }),
      );
      await Promise.resolve();
    });

    const reembedCalls = mockFetch.mock.calls.filter(([url]) =>
      String(url).includes('/ingest/reembed/'),
    );

    expect(reembedCalls).toHaveLength(2);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefreshModels).toHaveBeenCalledTimes(1);
  });

  it('re-filters bulk re-embed targets against the current live eligible row set before submit', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/ingest/reembed/%2Frepo-eligible')) {
        return mockJsonResponse({
          requestId: 'queue-request-eligible',
          runId: 'run-eligible',
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const onRefresh: () => Promise<void> = jest.fn(async () => undefined);
    const onRefreshModels: () => Promise<void> = jest.fn(async () => undefined);
    const { rerender } = render(
      <RootsTable
        roots={[
          { ...root, path: '/repo-eligible', name: 'repo-eligible' },
          { ...root, path: '/repo-stale', name: 'repo-stale' },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={onRefresh}
        onRefreshModels={onRefreshModels}
      />,
    );

    fireEvent.click(
      await screen.findByRole('checkbox', { name: /select repo-eligible/i }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: /select repo-stale/i }),
    );
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    rerender(
      <RootsTable
        roots={[
          { ...root, path: '/repo-eligible', name: 'repo-eligible' },
          {
            ...root,
            path: '/repo-stale',
            name: 'repo-stale',
            status: 'ingesting',
            phase: 'queued',
            queueState: 'waiting',
            requestId: 'queue-request-stale',
            runId: null,
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={onRefresh}
        onRefreshModels={onRefreshModels}
      />,
    );

    expect(screen.getByText('2 selected')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /re-embed selected/i }),
      );
      await Promise.resolve();
    });

    const reembedCalls = mockFetch.mock.calls.filter(([url]) =>
      String(url).includes('/ingest/reembed/'),
    );

    expect(reembedCalls).toHaveLength(1);
    expect(String(reembedCalls[0]?.[0] ?? '')).toContain(
      '/ingest/reembed/%2Frepo-eligible',
    );
    expect(String(reembedCalls[0]?.[0] ?? '')).not.toContain('/repo-stale');
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefreshModels).toHaveBeenCalledTimes(1);
  });

  it('renders AST counts in the table when available', async () => {
    render(
      <RootsTable
        roots={[rootWithAst]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    const row = await screen.findByRole('row', { name: /repo/i });
    expect(row).toHaveTextContent('AST Supported:');
    expect(row).toHaveTextContent('AST Skipped:');
    expect(row).toHaveTextContent('AST Failed:');
    expect(row).toHaveTextContent('9');
    expect(row).toHaveTextContent('8');
    expect(row).toHaveTextContent('7');
  });

  it('shows placeholders for AST counts when missing', async () => {
    render(
      <RootsTable
        roots={[root]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    const row = await screen.findByRole('row', { name: /repo/i });
    const placeholders = within(row).getAllByText('–');
    expect(placeholders).toHaveLength(3);
  });

  it('renders legacy string and normalized error payloads safely in rows', async () => {
    render(
      <RootsTable
        roots={[
          {
            ...root,
            path: '/repo-legacy',
            name: 'repo-legacy',
            lastError: 'Legacy table error',
          },
          {
            ...root,
            path: '/repo-normalized',
            name: 'repo-normalized',
            lastError: null,
            error: {
              code: 'OPENAI_TIMEOUT',
              message: 'Normalized table error',
            },
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    const legacyRow = await screen.findByRole('row', { name: /repo-legacy/i });
    const normalizedRow = await screen.findByRole('row', {
      name: /repo-normalized/i,
    });
    expect(
      within(legacyRow).getByTestId('roots-row-last-error'),
    ).toHaveTextContent('Last error: Legacy table error');
    expect(
      within(normalizedRow).getByTestId('roots-row-last-error'),
    ).toHaveTextContent('Last error: Normalized table error');
  });

  it('keeps active ingest rows visible and shows phase text for ingesting status', async () => {
    render(
      <RootsTable
        roots={[
          {
            ...root,
            path: '/repo-active',
            name: 'repo-active',
            status: 'ingesting',
            phase: 'embedding',
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    const row = await screen.findByRole('row', { name: /repo-active/i });
    expect(row).toBeInTheDocument();
    expect(
      within(row).getByText(/ingesting \(embedding\)/i),
    ).toBeInTheDocument();
  });

  it('shows queued and cleanup-blocked rows from the shared repo-list payload', async () => {
    render(
      <>
        <RootsTable
          roots={[
            {
              ...root,
              requestId: 'queue-request-1',
              runId: null,
              queueState: 'waiting',
              queuePosition: 1,
              path: '/repo-queued',
              name: 'repo-queued',
              status: 'ingesting',
              phase: 'queued',
            },
            {
              ...root,
              requestId: 'queue-request-2',
              runId: 'run-blocked',
              queueState: 'cleanup-blocked',
              path: '/repo-blocked',
              name: 'repo-blocked',
              status: 'error',
              lastError: 'Queue cleanup blocked',
            },
          ]}
          lockedModelId={undefined}
          isLoading={false}
          error={undefined}
          onRefresh={() => Promise.resolve()}
        />
        <RootDetailsDrawer
          open
          onClose={() => undefined}
          root={{
            ...root,
            requestId: 'queue-request-1',
            runId: null,
            queueState: 'waiting',
            queuePosition: 1,
            path: '/repo-queued',
            name: 'repo-queued',
            status: 'ingesting',
            phase: 'queued',
          }}
        />
      </>,
    );

    const table = screen.getByRole('table', { hidden: true });
    const queuedName = await within(table).findByText('repo-queued');
    const blockedName = await within(table).findByText('repo-blocked');
    const queuedRow = queuedName.closest('tr');
    const blockedRow = blockedName.closest('tr');
    expect(queuedRow).not.toBeNull();
    expect(blockedRow).not.toBeNull();
    if (!queuedRow || !blockedRow) {
      throw new Error('Expected queued and blocked rows to render');
    }
    expect(within(queuedRow).getByText(/queued \(#1\)/i)).toBeInTheDocument();
    expect(
      within(blockedRow).getByText(/^cleanup blocked$/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Request ID/i)).toBeInTheDocument();
    expect(screen.getByText(/Pending queue start/i)).toBeInTheDocument();
  });

  it('renders fresh waiting metadata for a reused row instead of stale persisted model hints', async () => {
    render(
      <RootsTable
        roots={[
          {
            ...root,
            id: 'stable-repo-id',
            requestId: 'queue-request-fresh',
            runId: null,
            queueState: 'waiting',
            queuePosition: 1,
            path: '/repo-reused',
            name: 'repo-reused',
            status: 'ingesting',
            phase: 'queued',
            embeddingProvider: 'openai',
            embeddingModel: 'text-embedding-3-small',
            model: 'stale-persisted-model',
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    const reusedRow = await screen.findByRole('row', { name: /repo-reused/i });
    expect(
      within(reusedRow).getByText('openai / text-embedding-3-small'),
    ).toBeInTheDocument();
    expect(
      within(reusedRow).queryByText('stale-persisted-model'),
    ).not.toBeInTheDocument();
  });

  it('hides stale persisted diagnostics when a healthy queued or running overlay replaces the old failure state in table rows', async () => {
    render(
      <RootsTable
        roots={[
          {
            ...root,
            path: '/repo-waiting-recovery',
            name: 'repo-waiting-recovery',
            status: 'ingesting',
            phase: 'queued',
            queueState: 'waiting',
            queuePosition: 1,
            requestId: 'queue-request-waiting-recovery',
            lastError: 'stale waiting error',
            error: {
              code: 'OPENAI_TIMEOUT',
              message: 'stale waiting error',
            },
          },
          {
            ...root,
            path: '/repo-running-recovery',
            name: 'repo-running-recovery',
            status: 'ingesting',
            phase: 'embedding',
            queueState: 'running',
            runId: 'run-running-recovery',
            lastError: 'stale running error',
            error: {
              code: 'OPENAI_TIMEOUT',
              message: 'stale running error',
            },
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    const waitingRow = await screen.findByRole('row', {
      name: /repo-waiting-recovery/i,
    });
    const runningRow = await screen.findByRole('row', {
      name: /repo-running-recovery/i,
    });

    expect(
      within(waitingRow).queryByTestId('roots-row-last-error'),
    ).not.toBeInTheDocument();
    expect(
      within(runningRow).queryByTestId('roots-row-last-error'),
    ).not.toBeInTheDocument();
  });

  it('re-renders an open details drawer from fresh waiting metadata for a reused row', async () => {
    render(
      <RootDetailsDrawer
        open
        onClose={() => undefined}
        root={{
          ...root,
          id: 'stable-repo-id',
          requestId: 'queue-request-fresh',
          runId: null,
          queueState: 'waiting',
          queuePosition: 1,
          path: '/repo-reused',
          name: 'repo-reused',
          status: 'ingesting',
          phase: 'queued',
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          model: 'stale-persisted-model',
        }}
      />,
    );

    expect(
      screen.getByText('openai / text-embedding-3-small'),
    ).toBeInTheDocument();
    expect(screen.queryByText('stale-persisted-model')).not.toBeInTheDocument();
    expect(screen.getByText(/waiting \(#1\)/i)).toBeInTheDocument();
  });

  it('hides phase text for completed status rows', async () => {
    render(
      <RootsTable
        roots={[
          {
            ...root,
            path: '/repo-completed',
            name: 'repo-completed',
            status: 'completed',
            phase: undefined,
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    const row = await screen.findByRole('row', { name: /repo-completed/i });
    expect(within(row).getByText(/^completed$/i)).toBeInTheDocument();
    expect(
      within(row).queryByText(/\(queued\)|\(scanning\)|\(embedding\)/i),
    ).not.toBeInTheDocument();
  });

  it('hides phase text for cancelled status rows', async () => {
    render(
      <RootsTable
        roots={[
          {
            ...root,
            path: '/repo-cancelled',
            name: 'repo-cancelled',
            status: 'cancelled',
            phase: undefined,
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    const row = await screen.findByRole('row', { name: /repo-cancelled/i });
    expect(within(row).getByText(/^cancelled$/i)).toBeInTheDocument();
    expect(
      within(row).queryByText(/\(queued\)|\(scanning\)|\(embedding\)/i),
    ).not.toBeInTheDocument();
  });

  it('hides phase text for error status rows', async () => {
    render(
      <RootsTable
        roots={[
          {
            ...root,
            path: '/repo-error',
            name: 'repo-error',
            status: 'error',
            phase: undefined,
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    const row = await screen.findByRole('row', { name: /repo-error/i });
    expect(within(row).getByText(/^error$/i)).toBeInTheDocument();
    expect(
      within(row).queryByText(/\(queued\)|\(scanning\)|\(embedding\)/i),
    ).not.toBeInTheDocument();
  });

  it('does not emit DEV-0000038 T7 row markers by default', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    render(
      <RootsTable
        roots={[
          {
            ...root,
            path: '/repo-default-marker-gate',
            name: 'repo-default-marker-gate',
            status: 'ingesting',
            phase: 'scanning',
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    await screen.findByRole('row', { name: /repo-default-marker-gate/i });
    const markerCalls = infoSpy.mock.calls.filter((call) =>
      String(call[0] ?? '').includes('[DEV-0000038][T7]'),
    );
    expect(markerCalls).toHaveLength(0);
  });

  it('emits DEV-0000038 T7 row markers when debug gate is enabled', async () => {
    (
      globalThis as unknown as {
        __codeinfoDebug?: { dev0000038Markers?: boolean };
      }
    ).__codeinfoDebug = { dev0000038Markers: true };
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    render(
      <RootsTable
        roots={[
          {
            ...root,
            path: '/repo-enabled-marker-gate',
            name: 'repo-enabled-marker-gate',
            status: 'completed',
            phase: undefined,
          },
        ]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled={false}
        onRefresh={() => Promise.resolve()}
      />,
    );

    await screen.findByRole('row', { name: /repo-enabled-marker-gate/i });
    const markerCalls = infoSpy.mock.calls.filter((call) =>
      String(call[0] ?? '').includes('[DEV-0000038][T7]'),
    );
    expect(markerCalls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('RootDetailsDrawer', () => {
  it('renders details and include/exclude lists', () => {
    render(
      <RootDetailsDrawer
        open
        onClose={() => undefined}
        lockedModelId="embed-1"
        root={{
          runId: 'run-1',
          name: 'repo',
          description: 'demo repo',
          path: '/repo',
          model: 'embed-1',
          status: 'completed',
          lastIngestAt: '2025-01-01T00:00:00.000Z',
          counts: { files: 2, chunks: 4, embedded: 4 },
          lastError: null,
        }}
      />,
    );

    expect(screen.getByRole('heading', { name: /repo/i })).toBeInTheDocument();
    expect(screen.getByText(/Embedding model locked/)).toBeInTheDocument();
    expect(screen.getAllByText(/^ts$/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/node_modules/)).toBeInTheDocument();
  });

  it('renders AST counts when present', () => {
    render(
      <RootDetailsDrawer
        open
        onClose={() => undefined}
        root={{
          runId: 'run-1',
          name: 'repo',
          description: 'demo repo',
          path: '/repo',
          model: 'embed-1',
          status: 'completed',
          lastIngestAt: '2025-01-01T00:00:00.000Z',
          counts: { files: 2, chunks: 4, embedded: 4 },
          ast: {
            supportedFileCount: 9,
            skippedFileCount: 8,
            failedFileCount: 7,
            lastIndexedAt: '2025-01-01T01:23:45.000Z',
          },
        }}
      />,
    );

    expect(screen.getByText(/AST Supported: 9/)).toBeInTheDocument();
    expect(screen.getByText(/AST Skipped: 8/)).toBeInTheDocument();
    expect(screen.getByText(/AST Failed: 7/)).toBeInTheDocument();
  });

  it('shows AST placeholders when metadata is missing', () => {
    render(
      <RootDetailsDrawer
        open
        onClose={() => undefined}
        root={{
          runId: 'run-1',
          name: 'repo',
          description: 'demo repo',
          path: '/repo',
          model: 'embed-1',
          status: 'completed',
          lastIngestAt: '2025-01-01T00:00:00.000Z',
          counts: { files: 2, chunks: 4, embedded: 4 },
          lastError: null,
        }}
      />,
    );

    expect(screen.getByText(/AST Supported: –/)).toBeInTheDocument();
    expect(screen.getByText(/AST Skipped: –/)).toBeInTheDocument();
    expect(screen.getByText(/AST Failed: –/)).toBeInTheDocument();
  });

  it('hides stale persisted diagnostics in an open details drawer when healthy queued or running data arrives', () => {
    const recoveryBaseRoot = {
      name: 'repo',
      description: 'demo repo',
      path: '/repo',
      model: 'embed-1',
      lastIngestAt: '2025-01-01T00:00:00.000Z',
      counts: { files: 2, chunks: 4, embedded: 4 },
    } as const;
    const { rerender } = render(
      <RootDetailsDrawer
        open
        onClose={() => undefined}
        root={{
          ...recoveryBaseRoot,
          runId: null,
          requestId: 'queue-request-waiting-recovery',
          queueState: 'waiting',
          queuePosition: 1,
          name: 'repo-waiting-recovery',
          path: '/repo-waiting-recovery',
          status: 'ingesting',
          phase: 'queued',
          lastError: 'stale waiting error',
          error: {
            code: 'OPENAI_TIMEOUT',
            message: 'stale waiting error',
          },
        }}
      />,
    );

    expect(screen.queryByText(/Last error:/i)).not.toBeInTheDocument();

    rerender(
      <RootDetailsDrawer
        open
        onClose={() => undefined}
        root={{
          ...recoveryBaseRoot,
          runId: 'run-running-recovery',
          requestId: 'queue-request-running-recovery',
          queueState: 'running',
          name: 'repo-running-recovery',
          path: '/repo-running-recovery',
          status: 'ingesting',
          phase: 'embedding',
          lastError: 'stale running error',
          error: {
            code: 'OPENAI_TIMEOUT',
            message: 'stale running error',
          },
        }}
      />,
    );

    expect(screen.queryByText(/Last error:/i)).not.toBeInTheDocument();
  });

  it('renders genuine current and cleanup-blocked diagnostics safely in details', () => {
    const { rerender } = render(
      <RootDetailsDrawer
        open
        onClose={() => undefined}
        root={{
          runId: 'run-legacy-error',
          name: 'repo',
          description: 'demo repo',
          path: '/repo',
          model: 'embed-1',
          status: 'completed',
          lastIngestAt: '2025-01-01T00:00:00.000Z',
          counts: { files: 2, chunks: 4, embedded: 4 },
          lastError: 'Legacy details error',
        }}
      />,
    );

    expect(
      screen.getByText(/Last error: Legacy details error/),
    ).toBeInTheDocument();

    rerender(
      <RootDetailsDrawer
        open
        onClose={() => undefined}
        root={{
          runId: 'run-normalized-error',
          name: 'repo',
          description: 'demo repo',
          path: '/repo',
          model: 'embed-1',
          status: 'completed',
          lastIngestAt: '2025-01-01T00:00:00.000Z',
          counts: { files: 2, chunks: 4, embedded: 4 },
          lastError: null,
          error: {
            code: 'OPENAI_TIMEOUT',
            message: 'Normalized details error',
          },
        }}
      />,
    );

    expect(
      screen.getByText(/Last error: Normalized details error/),
    ).toBeInTheDocument();

    rerender(
      <RootDetailsDrawer
        open
        onClose={() => undefined}
        root={{
          runId: 'run-cleanup-blocked',
          requestId: 'queue-request-cleanup-blocked',
          queueState: 'cleanup-blocked',
          name: 'repo',
          description: 'demo repo',
          path: '/repo',
          model: 'embed-1',
          status: 'error',
          lastIngestAt: '2025-01-01T00:00:00.000Z',
          counts: { files: 2, chunks: 4, embedded: 4 },
          lastError: 'Queue cleanup blocked',
        }}
      />,
    );

    expect(
      screen.getByText(/Last error: Queue cleanup blocked/),
    ).toBeInTheDocument();
  });
});
