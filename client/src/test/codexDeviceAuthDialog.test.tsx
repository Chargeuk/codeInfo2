import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const postCodexDeviceAuth = jest.fn();
const logSpy = jest.fn();

await jest.unstable_mockModule('../api/codex', async () => ({
  __esModule: true,
  postCodexDeviceAuth,
}));

await jest.unstable_mockModule('../logging/logger', async () => ({
  __esModule: true,
  createLogger: jest.fn(() => logSpy),
}));

const { default: CodexDeviceAuthDialog } = await import(
  '../components/codex/CodexDeviceAuthDialog'
);

function renderDialog(props?: {
  open?: boolean;
  onClose?: () => void;
  source?: 'chat' | 'agents';
}) {
  return render(
    <CodexDeviceAuthDialog
      open={props?.open ?? true}
      onClose={props?.onClose ?? jest.fn()}
      source={props?.source ?? 'chat'}
    />,
  );
}

describe('CodexDeviceAuthDialog', () => {
  beforeEach(() => {
    postCodexDeviceAuth.mockReset();
    logSpy.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('disables the start button while pending', async () => {
    const user = userEvent.setup();
    let resolvePromise: (() => void) | undefined;
    postCodexDeviceAuth.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePromise = resolve;
        }),
    );

    renderDialog();

    const startButton = screen.getByRole('button', {
      name: /start device auth/i,
    });

    await act(async () => {
      await user.click(startButton);
    });

    await waitFor(() => expect(startButton).toBeDisabled());
    resolvePromise?.();
  });

  it('renders raw output with linkified URLs on success', async () => {
    const user = userEvent.setup();
    postCodexDeviceAuth.mockResolvedValue({
      status: 'ok',
      rawOutput: 'Open https://example.com/device and enter code ABCD-EFGH.',
    });

    renderDialog();

    await user.click(
      screen.getByRole('button', { name: /start device auth/i }),
    );

    const link = await screen.findByRole('link', {
      name: 'https://example.com/device',
    });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://example.com/device');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    const outputBlock = screen.getByText(/Open/i);
    expect(outputBlock.closest('pre')).not.toBeNull();
    expect(screen.getByText(/ABCD-EFGH/i)).toBeInTheDocument();
  });

  it('renders raw output inside a read-only block', async () => {
    const user = userEvent.setup();
    postCodexDeviceAuth.mockResolvedValue({
      status: 'ok',
      rawOutput: 'Open https://example.com/device and enter code ABCD-EFGH.',
    });

    renderDialog();

    await user.click(
      screen.getByRole('button', { name: /start device auth/i }),
    );

    const output = await screen.findByText(/Open/i);
    expect(output.closest('pre')).not.toBeNull();
  });

  it('shows error message and re-enables start after failure', async () => {
    const user = userEvent.setup();
    postCodexDeviceAuth.mockRejectedValue(
      new Error('Enable device code login in ChatGPT settings'),
    );

    renderDialog();

    const startButton = screen.getByRole('button', {
      name: /start device auth/i,
    });

    await user.click(startButton);

    expect(
      await screen.findByText(/Enable device code login/i),
    ).toBeInTheDocument();
    expect(startButton).toBeEnabled();
  });

  it('invokes onClose after an error state', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    postCodexDeviceAuth.mockRejectedValue(new Error('Device auth failed'));

    renderDialog({ onClose });

    await user.click(
      screen.getByRole('button', { name: /start device auth/i }),
    );

    await screen.findByText(/Device auth failed/i);
    await user.click(screen.getByRole('button', { name: /close/i }));

    expect(onClose).toHaveBeenCalled();
  });

  it('sends strict empty request payload for shared auth flow', async () => {
    const user = userEvent.setup();
    postCodexDeviceAuth.mockResolvedValue({
      status: 'ok',
      rawOutput: 'Open https://example.com/device and enter code ABCD-EFGH.',
    });

    renderDialog();

    await user.click(
      screen.getByRole('button', { name: /start device auth/i }),
    );

    await waitFor(() => expect(postCodexDeviceAuth).toHaveBeenCalledWith({}));
  });

  it('does not render a target selector', () => {
    renderDialog();
    expect(screen.queryByRole('combobox', { name: /target/i })).toBeNull();
  });

  it('renders deterministic invalid_request error state for 400 path', async () => {
    const user = userEvent.setup();
    postCodexDeviceAuth.mockRejectedValue(
      new Error('invalid_request: request body must be {}'),
    );

    renderDialog();
    await user.click(
      screen.getByRole('button', { name: /start device auth/i }),
    );

    expect(
      await screen.findByText(/invalid_request: request body must be \{\}/i),
    ).toBeInTheDocument();
  });

  it('renders deterministic codex_unavailable error state for 503 path', async () => {
    const user = userEvent.setup();
    postCodexDeviceAuth.mockRejectedValue(
      new Error('codex_unavailable: Codex CLI unavailable'),
    );

    renderDialog();
    await user.click(
      screen.getByRole('button', { name: /start device auth/i }),
    );

    expect(
      await screen.findByText(/codex_unavailable: Codex CLI unavailable/i),
    ).toBeInTheDocument();
  });

  it('retries successfully after an error state', async () => {
    const user = userEvent.setup();
    postCodexDeviceAuth
      .mockRejectedValueOnce(
        new Error('invalid_request: request body must be {}'),
      )
      .mockResolvedValueOnce({
        status: 'ok',
        rawOutput: 'Open https://example.com/device and enter code RETRY-CODE.',
      });

    renderDialog();
    const start = screen.getByRole('button', { name: /start device auth/i });

    await user.click(start);
    expect(await screen.findByText(/invalid_request/i)).toBeInTheDocument();

    await user.click(start);
    expect(await screen.findByText(/RETRY-CODE/i)).toBeInTheDocument();
    expect(screen.queryByText(/invalid_request/i)).toBeNull();
  });

  it('emits T15 success log on successful shared auth flow', async () => {
    const user = userEvent.setup();
    postCodexDeviceAuth.mockResolvedValue({
      status: 'ok',
      rawOutput: 'Open https://example.com/device and enter code ABCD-EFGH.',
    });

    renderDialog({ source: 'agents' });
    await user.click(
      screen.getByRole('button', { name: /start device auth/i }),
    );

    await waitFor(() =>
      expect(logSpy).toHaveBeenCalledWith(
        'info',
        '[DEV-0000037][T15] event=shared_auth_dialog_flow_executed result=success',
        { source: 'agents' },
      ),
    );
  });

  it('emits T15 error log on failure path', async () => {
    const user = userEvent.setup();
    postCodexDeviceAuth.mockRejectedValue(new Error('codex_unavailable: down'));

    renderDialog({ source: 'chat' });
    await user.click(
      screen.getByRole('button', { name: /start device auth/i }),
    );

    await waitFor(() =>
      expect(logSpy).toHaveBeenCalledWith(
        'error',
        '[DEV-0000037][T15] event=shared_auth_dialog_flow_executed result=error',
        { message: 'codex_unavailable: down', source: 'chat' },
      ),
    );
  });
});
