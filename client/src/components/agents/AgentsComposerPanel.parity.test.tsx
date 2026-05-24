import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { jest } from '@jest/globals';
import AgentsComposerPanel from './AgentsComposerPanel';

const theme = createTheme();

const commandOptions = [
  {
    key: 'build::local',
    label: 'Build',
    disabled: false,
    description: 'Build the local workspace',
  },
  {
    key: 'deploy::local',
    label: 'Deploy',
    disabled: true,
    description: 'Deployment is unavailable',
  },
];

const promptEntries = [
  {
    fullPath: '/workflows/prompts/write.md',
    relativePath: 'workflows/prompts/write.md',
  },
  {
    fullPath: '/workflows/prompts/review.md',
    relativePath: 'workflows/prompts/review.md',
  },
];

const baseProps: ComponentProps<typeof AgentsComposerPanel> = {
  agentsLoading: false,
  agentsError: null,
  agents: [{ name: 'coding_agent' }],
  selectedAgentName: 'coding_agent',
  selectedAgentDisabled: false,
  selectedAgentDescription: '# Agent description',
  agentWarnings: [{ code: 'warn', message: 'Heads up' }],
  agentDisabledReason: undefined,
  agentInfoEmpty: false,
  agentInfoEmptyMessage: 'No metadata',
  agentModelId: 'gpt-5.3-codex',
  commandsError: null,
  commandsLoading: false,
  commandOptions,
  promptEntries,
  promptsError: null,
  selectedActionMode: 'instruction',
  selectedCommandStepCount: 3,
  selectedStep: 2,
  selectedWorkingFolder: '/tmp/workspace/project',
  input: 'Draft instruction',
  showStop: false,
  isStopping: false,
  canShowDeviceAuth: true,
  controlsDisabled: false,
  submitDisabledForRun: false,
  startStepDisabled: true,
  persistenceUnavailable: false,
  wsTranscriptReady: true,
  isWorkingFolderDisabled: false,
  isInstructionInputDisabled: false,
  onSubmit: (event) => event.preventDefault(),
  onAgentSelect: () => {},
  onInstructionModeSelect: () => {},
  onCommandModeSelect: () => {},
  onPromptModeSelect: () => {},
  onStepSelect: () => {},
  onResetConversation: () => {},
  onWorkingFolderChange: () => {},
  onCommitWorkingFolder: async () => undefined,
  onOpenDirPicker: () => {},
  onInputChange: () => {},
  onStopClick: () => {},
  onDeviceAuthOpen: () => {},
  onDeviceAuthClose: () => {},
  onDeviceAuthSuccess: () => {},
  dirPickerOpen: false,
  onCloseDirPicker: () => {},
  onPickDir: () => {},
  deviceAuthOpen: false,
};

function renderComposer(
  overrides: Partial<ComponentProps<typeof AgentsComposerPanel>> = {},
) {
  const props = { ...baseProps, ...overrides };
  return render(
    <ThemeProvider theme={theme}>
      <AgentsComposerPanel {...props} />
    </ThemeProvider>,
  );
}

describe('AgentsComposerPanel parity', () => {
  it('renders the shared footer order and omits the old execute buttons', () => {
    renderComposer();

    const shell = screen.getByTestId('chat-controls');
    const footerButtons = [
      'agent-composer-info',
      'agent-working-path-trigger',
      'agent-select-trigger',
      'agent-command-trigger',
      'agent-step-trigger',
    ].map((testId) => shell.querySelector(`[data-testid="${testId}"]`));

    expect(footerButtons.every(Boolean)).toBe(true);
    const footerElements = footerButtons as Element[];
    for (let index = 0; index < footerElements.length - 1; index += 1) {
      expect(
        footerElements[index].compareDocumentPosition(
          footerElements[index + 1],
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(
      within(shell).queryByTestId('agent-command-execute'),
    ).not.toBeInTheDocument();
    expect(
      within(shell).queryByTestId('agent-prompt-execute'),
    ).not.toBeInTheDocument();
    expect(
      within(shell).getByTestId('agent-working-path-trigger'),
    ).toHaveTextContent('project');
    expect(
      within(shell).getByTestId('agent-command-trigger'),
    ).toHaveTextContent('Write instruction');
  });

  it('presents the unified action selector and mode-specific input behavior', async () => {
    const user = userEvent.setup();
    const onInstructionModeSelect = jest.fn();
    const onCommandModeSelect = jest.fn();
    const onPromptModeSelect = jest.fn();

    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <AgentsComposerPanel
          {...baseProps}
          onInstructionModeSelect={onInstructionModeSelect}
          onCommandModeSelect={onCommandModeSelect}
          onPromptModeSelect={onPromptModeSelect}
        />
      </ThemeProvider>,
    );

    await user.click(screen.getByTestId('agent-command-trigger'));
    const commandPopover = await screen.findByTestId('agent-command-popover');
    expect(
      within(commandPopover).getByText('Write instruction'),
    ).toBeInTheDocument();
    expect(within(commandPopover).getByText('Build')).toBeInTheDocument();
    expect(
      within(commandPopover).getByText('workflows/prompts/write.md'),
    ).toBeInTheDocument();

    await user.click(within(commandPopover).getByText('Write instruction'));
    expect(onInstructionModeSelect).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('agent-command-trigger'));
    const commandPopoverAgain = await screen.findByTestId(
      'agent-command-popover',
    );
    await user.click(within(commandPopoverAgain).getByText('Build'));
    expect(onCommandModeSelect).toHaveBeenCalledWith('build::local');

    rerender(
      <ThemeProvider theme={theme}>
        <AgentsComposerPanel
          {...baseProps}
          selectedActionMode="command:build::local"
          isInstructionInputDisabled
          startStepDisabled={false}
          onInstructionModeSelect={onInstructionModeSelect}
          onCommandModeSelect={onCommandModeSelect}
          onPromptModeSelect={onPromptModeSelect}
        />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('agent-input')).toBeDisabled();
    expect(screen.getByTestId('agent-step-trigger')).toBeEnabled();

    rerender(
      <ThemeProvider theme={theme}>
        <AgentsComposerPanel
          {...baseProps}
          selectedActionMode="prompt:/workflows/prompts/write.md"
          isInstructionInputDisabled
          startStepDisabled
          onInstructionModeSelect={onInstructionModeSelect}
          onCommandModeSelect={onCommandModeSelect}
          onPromptModeSelect={onPromptModeSelect}
        />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('agent-input')).toBeDisabled();
    expect(screen.getByTestId('agent-step-trigger')).toBeDisabled();

    await user.click(screen.getByTestId('agent-command-trigger'));
    await user.click(screen.getByText('workflows/prompts/review.md'));
    expect(onPromptModeSelect).toHaveBeenCalledWith(
      '/workflows/prompts/review.md',
    );
  });
});
