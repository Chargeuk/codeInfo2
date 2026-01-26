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

const defaultAgents = [{ name: 'alpha' }, { name: 'bravo' }];

function renderDialog(props?: {
  open?: boolean;
  onClose?: () => void;
  defaultTarget?: { target: 'chat' } | { target: 'agent'; agentName: string };
}) {
  return render(
    <CodexDeviceAuthDialog
      open={props?.open ?? true}
      onClose={props?.onClose ?? jest.fn()}
      defaultTarget={props?.defaultTarget ?? { target: 'chat' }}
      agents={defaultAgents}
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
      status: 'completed',
      target: 'chat',
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
      status: 'completed',
      target: 'chat',
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

  it('sends selected agent target in the request payload', async () => {
    const user = userEvent.setup();
    postCodexDeviceAuth.mockResolvedValue({
      status: 'completed',
      target: 'agent',
      agentName: 'alpha',
      rawOutput: 'Open https://example.com/device and enter code ABCD-EFGH.',
    });

    renderDialog();

    await user.click(screen.getByRole('combobox', { name: /target/i }));
    await user.click(screen.getByRole('option', { name: /agent: alpha/i }));

    await user.click(
      screen.getByRole('button', { name: /start device auth/i }),
    );

    await waitFor(() =>
      expect(postCodexDeviceAuth).toHaveBeenCalledWith({
        target: 'agent',
        agentName: 'alpha',
      }),
    );
  });
});
