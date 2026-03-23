import type {
  ProviderAuthProviderId,
  ProviderAuthResponseFor,
} from '@codeinfo2/common';
import { jest } from '@jest/globals';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createProviderAuthFixture } from './support/fetchMock';

type PostProviderDeviceAuth =
  (typeof import('../api/codex'))['postProviderDeviceAuth'];

const postProviderDeviceAuth = jest.fn<PostProviderDeviceAuth>();
const logSpy = jest.fn();

await jest.unstable_mockModule('../api/codex', async () => ({
  __esModule: true,
  postProviderDeviceAuth,
}));

await jest.unstable_mockModule('../logging/logger', async () => ({
  __esModule: true,
  createLogger: jest.fn(() => logSpy),
}));

const { default: CodexDeviceAuthDialog } = await import(
  '../components/codex/CodexDeviceAuthDialog'
);

function buildAuthResponse<TProvider extends ProviderAuthProviderId>(params: {
  provider: TProvider;
  state: Parameters<typeof createProviderAuthFixture<TProvider>>[0]['state'];
  payload?: Partial<ProviderAuthResponseFor<TProvider>>;
}) {
  return createProviderAuthFixture(params).payload;
}

function renderDialog(props?: {
  open?: boolean;
  onClose?: () => void;
  onSuccess?: (response: Awaited<ReturnType<PostProviderDeviceAuth>>) => void;
  source?: 'chat' | 'agents';
}) {
  return render(
    <CodexDeviceAuthDialog
      open={props?.open ?? true}
      onClose={props?.onClose ?? jest.fn()}
      onSuccess={props?.onSuccess}
      source={props?.source ?? 'chat'}
    />,
  );
}

describe('CodexDeviceAuthDialog', () => {
  beforeEach(() => {
    postProviderDeviceAuth.mockReset();
    logSpy.mockReset();
  });

  it('renders the shared layout with Codex Auth first, Copilot Auth second, and Close in the action row', () => {
    renderDialog();

    expect(
      screen.getByRole('heading', { name: 'Choose Authentication' }),
    ).toBeInTheDocument();

    const buttons = screen
      .getAllByRole('button')
      .map((button) => button.textContent?.trim());
    expect(buttons).toEqual(['Codex Auth', 'Copilot Auth', 'Close']);
  });

  it('renders verification URL and one-time code below the shared buttons without replacing the outer dialog tree', async () => {
    const user = userEvent.setup();
    postProviderDeviceAuth.mockResolvedValue(
      buildAuthResponse({
        provider: 'copilot',
        state: 'verification_ready',
        payload: {
          verificationUrl: 'https://github.com/login/device',
          userCode: 'COPILOT-CODE',
        },
      }),
    );

    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Copilot Auth' }));

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('button', { name: 'Codex Auth' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Copilot Auth' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('heading', { name: 'Choose Authentication' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Verification URL')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'https://github.com/login/device' }),
    ).toHaveAttribute('href', 'https://github.com/login/device');
    expect(
      screen.getByText('COPILOT-CODE', { selector: 'code' }),
    ).toBeInTheDocument();
  });

  it('renders already-authenticated state without relying on raw output blocks', async () => {
    const user = userEvent.setup();
    postProviderDeviceAuth.mockResolvedValue(
      buildAuthResponse({
        provider: 'copilot',
        state: 'already_authenticated',
      }),
    );

    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Copilot Auth' }));

    expect(
      await screen.findByText(
        'GitHub Copilot is already authenticated for this runtime.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Device auth output/i)).toBeNull();
  });

  it('renders unavailable-before-start states distinctly from general failures', async () => {
    const user = userEvent.setup();
    postProviderDeviceAuth.mockResolvedValue(
      buildAuthResponse({
        provider: 'copilot',
        state: 'unavailable_before_start',
        payload: { reason: 'GitHub login required' },
      }),
    );

    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Copilot Auth' }));

    expect(
      await screen.findByText('GitHub login required'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Status details')).toBeNull();
  });

  it('renders completion-pending state without collapsing back to the chooser view', async () => {
    const user = userEvent.setup();
    postProviderDeviceAuth.mockResolvedValue(
      buildAuthResponse({
        provider: 'copilot',
        state: 'completion_pending',
        payload: {
          verificationUrl: 'https://github.com/login/device',
          userCode: 'COPILOT-CODE',
          displayOutput: 'Authentication is still pending.',
        },
      }),
    );

    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Copilot Auth' }));

    expect(
      await screen.findByText(
        'Authentication is still pending. Finish the browser step, then refresh again if needed.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Status details')).toBeInTheDocument();
    expect(
      screen.getByText('Authentication is still pending.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Codex Auth' }),
    ).toBeInTheDocument();
  });

  it('renders completed state distinctly from already-authenticated state', async () => {
    const user = userEvent.setup();
    postProviderDeviceAuth.mockResolvedValue(
      buildAuthResponse({
        provider: 'copilot',
        state: 'completed',
      }),
    );

    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Copilot Auth' }));

    expect(
      await screen.findByText('GitHub Copilot authentication completed.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/already authenticated for this runtime/i),
    ).toBeNull();
  });

  it('keeps the existing Codex branch working through the shared dialog', async () => {
    const user = userEvent.setup();
    postProviderDeviceAuth.mockResolvedValue(
      buildAuthResponse({
        provider: 'codex',
        state: 'verification_ready',
        payload: {
          verificationUrl: 'https://example.com/device',
          userCode: 'CODEX-CODE',
        },
      }),
    );

    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Codex Auth' }));

    expect(postProviderDeviceAuth).toHaveBeenCalledWith('codex');
    expect(await screen.findByText('OpenAI Codex')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'https://example.com/device' }),
    ).toHaveAttribute('href', 'https://example.com/device');
    expect(
      screen.getByText('CODEX-CODE', { selector: 'code' }),
    ).toBeInTheDocument();
  });

  it('emits the Task 12 render marker with secret-safe provider and auth-state context', async () => {
    const user = userEvent.setup();
    postProviderDeviceAuth.mockResolvedValue(
      buildAuthResponse({
        provider: 'copilot',
        state: 'completed',
      }),
    );

    renderDialog({ source: 'agents' });
    await user.click(screen.getByRole('button', { name: 'Copilot Auth' }));

    await waitFor(() =>
      expect(logSpy).toHaveBeenCalledWith(
        'info',
        'story.0000051.task12.choose_auth_dialog_rendered',
        expect.objectContaining({
          authStatus: 'completed',
          source: 'agents',
          visibleProviderBranch: 'copilot',
        }),
      ),
    );
  });

  it('only calls onSuccess when authentication finishes in a completed state', async () => {
    const user = userEvent.setup();
    const onSuccess = jest.fn();

    postProviderDeviceAuth
      .mockResolvedValueOnce(
        buildAuthResponse({
          provider: 'copilot',
          state: 'verification_ready',
        }),
      )
      .mockResolvedValueOnce(
        buildAuthResponse({
          provider: 'copilot',
          state: 'completed',
        }),
      );

    renderDialog({ onSuccess });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Copilot Auth' }));
    });
    expect(onSuccess).not.toHaveBeenCalled();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Copilot Auth' }));
    });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });
});
