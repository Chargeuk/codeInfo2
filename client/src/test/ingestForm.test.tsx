import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import IngestForm from '../components/ingest/IngestForm';

describe('IngestForm', () => {
  const mockFetch = jest.fn();
  const originalMode = process.env.MODE;

  beforeAll(() => {
    process.env.MODE = 'test';
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterAll(() => {
    process.env.MODE = originalMode;
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  const enqueueFetchJson = (payloads: unknown[]) => {
    for (const payload of payloads) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => payload,
      });
    }
  };

  const models = [
    { id: 'embed-1', displayName: 'Embed One' },
    { id: 'embed-2', displayName: 'Embed Two' },
  ];

  it('shows validation messages when required fields are missing', async () => {
    render(
      <IngestForm
        models={models}
        onStarted={jest.fn()}
        defaultModelId="embed-1"
      />,
    );

    fireEvent.blur(screen.getByLabelText(/folder path/i));
    fireEvent.blur(screen.getByLabelText(/display name/i));

    expect(await screen.findByText(/path is required/i)).toBeInTheDocument();
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
  });

  it('does not render lock banner inside the form when locked', () => {
    render(
      <IngestForm
        models={models}
        lockedModelId="locked-model"
        onStarted={jest.fn()}
      />,
    );

    expect(
      screen.queryByText(/embedding model locked to locked-model/i),
    ).not.toBeInTheDocument();
  });

  it('disables model select when lockedModelId is provided', () => {
    render(
      <IngestForm
        models={models}
        lockedModelId="locked-model"
        onStarted={jest.fn()}
      />,
    );
    const select = screen.getByRole('combobox', { name: /embedding model/i });
    expect(select).toBeDisabled();
  });

  it('submits payload and surfaces runId via onStarted', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ runId: 'run-123' }),
    });
    const onStarted = jest.fn();

    render(
      <IngestForm
        models={models}
        onStarted={onStarted}
        defaultModelId="embed-1"
      />,
    );

    fireEvent.change(screen.getByLabelText(/folder path/i), {
      target: { value: '/repo' },
    });
    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: 'Repo' },
    });
    fireEvent.change(screen.getByLabelText(/embedding model/i), {
      target: { value: 'embed-2' },
    });

    fireEvent.click(screen.getByRole('button', { name: /start ingest/i }));

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('run-123'));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      path: '/repo',
      name: 'Repo',
      model: 'embed-2',
      dryRun: false,
    });
  });

  it('shows server error message when request fails', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'boom' }),
    });

    render(
      <IngestForm
        models={models}
        onStarted={jest.fn()}
        defaultModelId="embed-1"
      />,
    );

    fireEvent.change(screen.getByLabelText(/folder path/i), {
      target: { value: '/repo' },
    });
    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: 'Repo' },
    });

    fireEvent.click(screen.getByRole('button', { name: /start ingest/i }));

    expect(await screen.findByTestId('submit-error')).toHaveTextContent(
      /boom/i,
    );
  });

  it('selecting a directory updates the Folder path input value', async () => {
    enqueueFetchJson([
      { base: '/data', path: '/data', dirs: ['projects'] },
      { base: '/data', path: '/data/projects', dirs: [] },
    ]);

    render(
      <IngestForm
        models={models}
        onStarted={jest.fn()}
        defaultModelId="embed-1"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /choose folder/i }));

    const projects = await screen.findByRole('button', { name: 'projects' });
    fireEvent.click(projects);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /use this folder/i }),
      ).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole('button', { name: /use this folder/i }));

    expect(screen.getByLabelText(/folder path/i)).toHaveValue('/data/projects');
  });

  it('clicking a directory triggers a second fetch for the new path', async () => {
    enqueueFetchJson([
      { base: '/data', path: '/data', dirs: ['projects'] },
      { base: '/data', path: '/data/projects', dirs: [] },
    ]);

    render(
      <IngestForm
        models={models}
        onStarted={jest.fn()}
        defaultModelId="embed-1"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /choose folder/i }));

    const projects = await screen.findByRole('button', { name: 'projects' });
    fireEvent.click(projects);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    const secondUrl = String(mockFetch.mock.calls[1][0]);
    expect(secondUrl).toContain('/ingest/dirs');
    expect(secondUrl).toContain('path=%2Fdata%2Fprojects');
  });

  it('"Up" is not available at base and appears after navigating', async () => {
    enqueueFetchJson([
      { base: '/data', path: '/data', dirs: ['projects'] },
      { base: '/data', path: '/data/projects', dirs: [] },
    ]);

    render(
      <IngestForm
        models={models}
        onStarted={jest.fn()}
        defaultModelId="embed-1"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /choose folder/i }));

    await screen.findByRole('button', { name: 'projects' });
    expect(
      screen.queryByRole('button', { name: /up/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'projects' }));

    expect(
      await screen.findByRole('button', { name: /up/i }),
    ).toBeInTheDocument();
  });

  it('"Use this folder" sets the current path even without clicking a child directory', async () => {
    enqueueFetchJson([{ base: '/data', path: '/data', dirs: ['projects'] }]);

    render(
      <IngestForm
        models={models}
        onStarted={jest.fn()}
        defaultModelId="embed-1"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /choose folder/i }));

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /use this folder/i }),
      ).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole('button', { name: /use this folder/i }));

    expect(screen.getByLabelText(/folder path/i)).toHaveValue('/data');
  });

  it('error path displays an error message when server returns OUTSIDE_BASE', async () => {
    enqueueFetchJson([{ status: 'error', code: 'OUTSIDE_BASE' }]);

    render(
      <IngestForm
        models={models}
        onStarted={jest.fn()}
        defaultModelId="embed-1"
      />,
    );

    fireEvent.change(screen.getByLabelText(/folder path/i), {
      target: { value: '/tmp' },
    });

    fireEvent.click(screen.getByRole('button', { name: /choose folder/i }));

    expect(
      await screen.findByText(/unable to list directories \(outside_base\)/i),
    ).toBeInTheDocument();
  });
});
