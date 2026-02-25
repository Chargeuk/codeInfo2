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
    { id: 'embed-1', displayName: 'Embed One', provider: 'lmstudio' as const },
    { id: 'embed-2', displayName: 'Embed Two', provider: 'lmstudio' as const },
  ];

  it('applies size="small" inputs and button variant rules', () => {
    render(
      <IngestForm
        models={models}
        onStarted={jest.fn()}
        defaultModelId="embed-1"
      />,
    );

    const pathInput = screen.getByLabelText(/folder path/i);
    expect(pathInput.closest('.MuiInputBase-root')).toHaveClass(
      'MuiInputBase-sizeSmall',
    );

    const nameInput = screen.getByLabelText(/display name/i);
    expect(nameInput.closest('.MuiInputBase-root')).toHaveClass(
      'MuiInputBase-sizeSmall',
    );

    const descriptionInput = screen.getByLabelText(/description/i);
    expect(descriptionInput.closest('.MuiInputBase-root')).toHaveClass(
      'MuiInputBase-sizeSmall',
    );

    const modelInput = screen.getByRole('combobox', {
      name: /embedding model/i,
    });
    expect(modelInput.closest('.MuiInputBase-root')).toHaveClass(
      'MuiInputBase-sizeSmall',
    );

    const chooseFolderButton = screen.getByRole('button', {
      name: /choose folder/i,
    });
    expect(chooseFolderButton).toHaveClass(
      'MuiButton-outlined',
      'MuiButton-sizeSmall',
    );

    const startIngestButton = screen.getByRole('button', {
      name: /start ingest/i,
    });
    expect(startIngestButton).toHaveClass(
      'MuiButton-contained',
      'MuiButton-sizeSmall',
    );
  });

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
      target: { value: 'lmstudio::embed-2' },
    });

    fireEvent.click(screen.getByRole('button', { name: /start ingest/i }));

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('run-123'));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      path: '/repo',
      name: 'Repo',
      model: 'embed-2',
      embeddingProvider: 'lmstudio',
      embeddingModel: 'embed-2',
      dryRun: false,
    });
  });

  it('renders provider-qualified model options and keeps same model ids distinct by provider', () => {
    render(
      <IngestForm
        models={[
          { id: 'same-id', displayName: 'Shared', provider: 'lmstudio' },
          { id: 'same-id', displayName: 'Shared', provider: 'openai' },
        ]}
        onStarted={jest.fn()}
        defaultModelId="same-id"
      />,
    );

    const select = screen.getByRole('combobox', { name: /embedding model/i });
    const options = Array.from(select.querySelectorAll('option')).map(
      (option) => ({
        value: option.value,
        label: option.textContent,
      }),
    );

    expect(options).toEqual(
      expect.arrayContaining([
        { value: 'lmstudio::same-id', label: 'lmstudio / Shared' },
        { value: 'openai::same-id', label: 'openai / Shared' },
      ]),
    );
  });

  it('clears stale selection when selected option is no longer in refreshed models', async () => {
    const { rerender } = render(
      <IngestForm
        models={[
          { id: 'embed-a', displayName: 'Embed A', provider: 'lmstudio' },
          { id: 'embed-b', displayName: 'Embed B', provider: 'lmstudio' },
        ]}
        onStarted={jest.fn()}
        defaultModelId="embed-a"
      />,
    );

    const select = screen.getByRole('combobox', { name: /embedding model/i });
    fireEvent.change(select, { target: { value: 'lmstudio::embed-b' } });
    expect(select).toHaveValue('lmstudio::embed-b');

    rerender(
      <IngestForm
        models={[
          { id: 'embed-a', displayName: 'Embed A', provider: 'lmstudio' },
        ]}
        onStarted={jest.fn()}
        defaultModelId="embed-a"
      />,
    );

    await waitFor(() => expect(select).toHaveValue('lmstudio::embed-a'));
  });

  it('shows OPENAI_DISABLED info banner copy', () => {
    render(
      <IngestForm
        models={models}
        onStarted={jest.fn()}
        defaultModelId="embed-1"
        openai={{ status: 'disabled', statusCode: 'OPENAI_DISABLED' }}
      />,
    );

    expect(
      screen.getByTestId('ingest-openai-banner-openai-disabled'),
    ).toHaveTextContent(
      /OpenAI embedding models are unavailable\. Set OPENAI_EMBEDDING_KEY on the server to enable them\./i,
    );
  });

  it('shows OPENAI_MODELS_LIST_TEMPORARY_FAILURE warning and keeps lmstudio options', () => {
    render(
      <IngestForm
        models={models}
        onStarted={jest.fn()}
        defaultModelId="embed-1"
        openai={{
          status: 'warning',
          statusCode: 'OPENAI_MODELS_LIST_TEMPORARY_FAILURE',
        }}
      />,
    );

    expect(
      screen.getByTestId(
        'ingest-openai-banner-openai-models-list-temporary-failure',
      ),
    ).toHaveTextContent(/temporarily unavailable/i);
    expect(
      screen.getByRole('option', { name: 'lmstudio / Embed One' }),
    ).toBeInTheDocument();
  });

  it('shows OPENAI_MODELS_LIST_AUTH_FAILED warning banner', () => {
    render(
      <IngestForm
        models={models}
        onStarted={jest.fn()}
        defaultModelId="embed-1"
        openai={{
          status: 'warning',
          statusCode: 'OPENAI_MODELS_LIST_AUTH_FAILED',
        }}
      />,
    );

    expect(
      screen.getByTestId('ingest-openai-banner-openai-models-list-auth-failed'),
    ).toHaveTextContent(/failed authentication/i);
  });

  it('shows OPENAI_MODELS_LIST_UNAVAILABLE warning banner', () => {
    render(
      <IngestForm
        models={models}
        onStarted={jest.fn()}
        defaultModelId="embed-1"
        openai={{
          status: 'warning',
          statusCode: 'OPENAI_MODELS_LIST_UNAVAILABLE',
        }}
      />,
    );

    expect(
      screen.getByTestId('ingest-openai-banner-openai-models-list-unavailable'),
    ).toHaveTextContent(/currently unavailable/i);
  });

  it('shows OPENAI_ALLOWLIST_NO_MATCH banner and no openai options', () => {
    render(
      <IngestForm
        models={models}
        onStarted={jest.fn()}
        defaultModelId="embed-1"
        openai={{ status: 'warning', statusCode: 'OPENAI_ALLOWLIST_NO_MATCH' }}
      />,
    );

    expect(
      screen.getByTestId('ingest-openai-banner-openai-allowlist-no-match'),
    ).toHaveTextContent(/No allowlisted OpenAI embedding models/i);
    expect(screen.queryByRole('option', { name: /openai \/ /i })).toBeNull();
  });

  it('does not render a dimensions input on the ingest form', () => {
    render(
      <IngestForm
        models={models}
        onStarted={jest.fn()}
        defaultModelId="embed-1"
      />,
    );

    expect(screen.queryByLabelText(/dimension/i)).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: /dimension/i })).toBeNull();
  });

  it('submits canonical embedding fields for provider-qualified selection', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ runId: 'run-200' }),
    });

    render(
      <IngestForm
        models={[
          { id: 'shared-id', displayName: 'Shared', provider: 'lmstudio' },
          { id: 'shared-id', displayName: 'Shared', provider: 'openai' },
        ]}
        onStarted={jest.fn()}
        defaultModelId="shared-id"
      />,
    );

    fireEvent.change(screen.getByLabelText(/folder path/i), {
      target: { value: '/repo' },
    });
    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: 'Repo' },
    });
    fireEvent.change(screen.getByLabelText(/embedding model/i), {
      target: { value: 'openai::shared-id' },
    });

    fireEvent.click(screen.getByRole('button', { name: /start ingest/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.embeddingProvider).toBe('openai');
    expect(body.embeddingModel).toBe('shared-id');
    expect(body.model).toBe('shared-id');
  });

  it('keeps provider-qualified selection and payload unambiguous for same model ids', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ runId: 'run-300' }),
    });
    const onStarted = jest.fn();

    render(
      <IngestForm
        models={[
          { id: 'dup-model', displayName: 'Dup', provider: 'lmstudio' },
          { id: 'dup-model', displayName: 'Dup', provider: 'openai' },
        ]}
        onStarted={onStarted}
      />,
    );

    fireEvent.change(screen.getByLabelText(/folder path/i), {
      target: { value: '/repo' },
    });
    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: 'Repo' },
    });
    fireEvent.change(screen.getByLabelText(/embedding model/i), {
      target: { value: 'openai::dup-model' },
    });

    fireEvent.click(screen.getByRole('button', { name: /start ingest/i }));

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('run-300'));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      embeddingProvider: 'openai',
      embeddingModel: 'dup-model',
    });
  });

  it('keeps locked openai fallback option when fetched models only include lmstudio same-id', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ runId: 'run-301' }),
    });
    const onStarted = jest.fn();

    render(
      <IngestForm
        models={[{ id: 'dup-model', displayName: 'Dup', provider: 'lmstudio' }]}
        lockedModelId="dup-model"
        lockedModel={{
          embeddingProvider: 'openai',
          embeddingModel: 'dup-model',
          embeddingDimensions: 1536,
        }}
        onStarted={onStarted}
      />,
    );

    const select = screen.getByRole('combobox', { name: /embedding model/i });
    expect(select).toBeDisabled();
    expect(select).toHaveValue('openai::dup-model');

    const options = Array.from(select.querySelectorAll('option')).map(
      (option) => option.value,
    );
    expect(options).toEqual(
      expect.arrayContaining(['lmstudio::dup-model', 'openai::dup-model']),
    );

    fireEvent.change(screen.getByLabelText(/folder path/i), {
      target: { value: '/repo' },
    });
    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: 'Repo' },
    });
    fireEvent.click(screen.getByRole('button', { name: /start ingest/i }));

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('run-301'));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      embeddingProvider: 'openai',
      embeddingModel: 'dup-model',
      model: 'dup-model',
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
