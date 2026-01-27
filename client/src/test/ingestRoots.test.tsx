import { jest } from '@jest/globals';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import RootDetailsDrawer from '../components/ingest/RootDetailsDrawer';
import RootsTable from '../components/ingest/RootsTable';
import useIngestRoots from '../hooks/useIngestRoots';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset();
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

describe('useIngestRoots', () => {
  it('loads roots from the server', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
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
    });

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

  it('calls re-embed endpoint and notifies parent when re-embed is clicked', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ runId: 'new-run' }),
    });
    const onRunStarted = jest.fn();
    const onRefresh = jest.fn().mockResolvedValue(undefined);

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
  });

  it('calls remove endpoint and shows message', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', unlocked: true }),
    });
    const onRefresh = jest.fn().mockResolvedValue(undefined);

    render(
      <RootsTable
        roots={[root]}
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
      expect.stringContaining('/ingest/remove/%2Frepo'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(await screen.findByText(/Removed/)).toBeInTheDocument();
  });

  it('disables actions when disabled flag is set', async () => {
    render(
      <RootsTable
        roots={[root]}
        lockedModelId={undefined}
        isLoading={false}
        error={undefined}
        disabled
        onRefresh={() => Promise.resolve()}
      />,
    );

    const row = await screen.findByRole('row', { name: /repo/i });
    const btn = within(row).getByRole('button', { name: /re-embed/i });
    expect(btn).toBeDisabled();
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
});
