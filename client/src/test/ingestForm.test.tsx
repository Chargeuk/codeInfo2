import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import IngestForm from '../components/ingest/IngestForm';

describe('IngestForm', () => {
  const mockFetch = jest.fn();

  beforeAll(() => {
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

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

  it('disables model select and shows lock banner when locked', () => {
    render(
      <IngestForm
        models={models}
        lockedModelId="locked-model"
        onStarted={jest.fn()}
      />,
    );

    expect(
      screen.getByText(/embedding model locked to locked-model/i),
    ).toBeInTheDocument();
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
});
