import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import {
  Alert,
  Box,
  Button,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Popover,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import {
  memo,
  useMemo,
  type FormEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import { createLogger } from '../../logging/logger';
import Markdown from '../Markdown';
import CodexDeviceAuthDialog from '../codex/CodexDeviceAuthDialog';
import DirectoryPickerDialog from '../ingest/DirectoryPickerDialog';

type AgentOption = {
  name: string;
};

type CommandOption = {
  key: string;
  label: string;
  disabled: boolean;
};

type PromptEntry = {
  fullPath: string;
  relativePath: string;
};

type AgentsComposerPanelProps = {
  drawerOpen: boolean;
  agentsLoading: boolean;
  agentsError: string | null;
  selectedAgentName: string;
  selectedCommandKey: string;
  startStep: number;
  selectedCommandStepCount: number;
  selectedCommandDescription: string;
  agentWarnings: string[];
  agentDescription?: string;
  agentInfoDisabled: boolean;
  showAgentInfoButton: boolean;
  agentInfoEmpty: boolean;
  agentInfoEmptyMessage: string;
  commandsError: string | null;
  commandsLoading: boolean;
  controlsDisabled: boolean;
  submitDisabledForRun: boolean;
  startStepDisabled: boolean;
  persistenceUnavailable: boolean;
  wsTranscriptReady: boolean;
  isWorkingFolderDisabled: boolean;
  isInstructionInputDisabled: boolean;
  hasPromptEntries: boolean;
  shouldShowPromptsError: boolean;
  shouldShowPromptsRow: boolean;
  executePromptEnabled: boolean;
  selectedPromptFullPath: string;
  input: string;
  workingFolder: string;
  showStop: boolean;
  isStopping: boolean;
  canShowDeviceAuth: boolean;
  commandInfoDisabled: boolean;
  actionSlotMinWidth: number;
  selectedAgentDisabled: boolean;
  agents: AgentOption[];
  commandOptions: CommandOption[];
  promptEntries: PromptEntry[];
  onToggleDrawer: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onAgentChange: (event: SelectChangeEvent<string>) => void;
  onCommandChange: (event: SelectChangeEvent<string>) => void;
  onStartStepChange: (event: SelectChangeEvent<string>) => void;
  onResetConversation: () => void;
  onAgentInfoOpen: (event: MouseEvent<HTMLElement>) => void;
  onAgentInfoClose: () => void;
  onCommandInfoAttempt: () => void;
  onCommandInfoOpen: (event: MouseEvent<HTMLElement>) => void;
  onCommandInfoClose: () => void;
  onExecuteCommand: () => void;
  onWorkingFolderChange: (value: string) => void;
  onCommitWorkingFolder: (
    trigger: 'blur' | 'enter' | 'picker',
    value: string,
  ) => Promise<unknown>;
  onOpenDirPicker: () => void;
  onPromptSelectionChange: (event: SelectChangeEvent<string>) => void;
  onExecutePrompt: () => void;
  onInputChange: (value: string) => void;
  onStopClick: () => void;
  onDeviceAuthOpen: () => void;
  onDeviceAuthClose: () => void;
  onDeviceAuthSuccess: () => void;
  dirPickerOpen: boolean;
  onCloseDirPicker: () => void;
  onPickDir: (path: string) => void;
  deviceAuthOpen: boolean;
  agentInfoId?: string;
  agentInfoOpen: boolean;
  agentInfoAnchorEl: HTMLElement | null;
  commandInfoId?: string;
  commandInfoOpen: boolean;
  commandInfoAnchorEl: HTMLElement | null;
  inputRef?: RefObject<HTMLInputElement | null>;
  conversationId?: string;
  promptsError: string | null;
};

const agentsComposerLog = createLogger('client');

const AgentsComposerPanel = memo(function AgentsComposerPanel({
  drawerOpen,
  agentsLoading,
  agentsError,
  selectedAgentName,
  selectedCommandKey,
  startStep,
  selectedCommandStepCount,
  selectedCommandDescription,
  agentWarnings,
  agentDescription,
  agentInfoDisabled,
  showAgentInfoButton,
  agentInfoEmpty,
  agentInfoEmptyMessage,
  commandsError,
  commandsLoading,
  controlsDisabled,
  submitDisabledForRun,
  startStepDisabled,
  persistenceUnavailable,
  wsTranscriptReady,
  isWorkingFolderDisabled,
  isInstructionInputDisabled,
  hasPromptEntries,
  shouldShowPromptsError,
  shouldShowPromptsRow,
  executePromptEnabled,
  selectedPromptFullPath,
  input,
  workingFolder,
  showStop,
  isStopping,
  canShowDeviceAuth,
  commandInfoDisabled,
  actionSlotMinWidth,
  selectedAgentDisabled,
  agents,
  commandOptions,
  promptEntries,
  onToggleDrawer,
  onSubmit,
  onAgentChange,
  onCommandChange,
  onStartStepChange,
  onResetConversation,
  onAgentInfoOpen,
  onAgentInfoClose,
  onCommandInfoAttempt,
  onCommandInfoOpen,
  onCommandInfoClose,
  onExecuteCommand,
  onWorkingFolderChange,
  onCommitWorkingFolder,
  onOpenDirPicker,
  onPromptSelectionChange,
  onExecutePrompt,
  onInputChange,
  onStopClick,
  onDeviceAuthOpen,
  onDeviceAuthClose,
  onDeviceAuthSuccess,
  dirPickerOpen,
  onCloseDirPicker,
  onPickDir,
  deviceAuthOpen,
  agentInfoId,
  agentInfoOpen,
  agentInfoAnchorEl,
  commandInfoId,
  commandInfoOpen,
  commandInfoAnchorEl,
  inputRef,
  conversationId,
  promptsError,
}: AgentsComposerPanelProps) {
  const startStepValue = useMemo(
    () => (selectedCommandKey ? `${startStep}` : ''),
    [selectedCommandKey, startStep],
  );

  return (
    <>
      <Box data-testid="chat-controls" style={{ flex: '0 0 auto' }}>
        <Stack spacing={2} component="form" onSubmit={onSubmit}>
          <Stack direction="row" justifyContent="flex-start">
            <IconButton
              aria-label="Toggle conversations"
              aria-controls="conversation-drawer"
              aria-expanded={drawerOpen}
              onClick={onToggleDrawer}
              size="small"
              data-testid="conversation-drawer-toggle"
            >
              <MenuIcon fontSize="small" />
            </IconButton>
          </Stack>

          <Stack
            data-testid="agent-header-row"
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            alignItems={{ xs: 'stretch', sm: 'center' }}
          >
            <FormControl
              fullWidth
              size="small"
              disabled={agentsLoading || !!agentsError}
            >
              <InputLabel id="agent-select-label">Agent</InputLabel>
              <Select
                labelId="agent-select-label"
                label="Agent"
                value={selectedAgentName}
                onChange={onAgentChange}
                inputProps={{ 'data-testid': 'agent-select' }}
              >
                {agents.map((agent) => (
                  <MenuItem key={agent.name} value={agent.name}>
                    {agent.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {showAgentInfoButton ? (
              <IconButton
                aria-describedby={agentInfoId}
                onClick={onAgentInfoOpen}
                disabled={agentInfoDisabled}
                size="small"
                data-testid="agent-info"
              >
                <InfoOutlinedIcon fontSize="small" />
              </IconButton>
            ) : null}

            <Stack spacing={1} sx={{ flexShrink: 0 }}>
              <Button
                type="button"
                variant="outlined"
                size="small"
                onClick={onResetConversation}
                disabled={agentsLoading}
                data-testid="agent-new-conversation"
              >
                New conversation
              </Button>
              {canShowDeviceAuth ? (
                <Button
                  type="button"
                  variant="outlined"
                  color="secondary"
                  size="small"
                  onClick={onDeviceAuthOpen}
                  disabled={agentsLoading}
                >
                  Re-authenticate (device auth)
                </Button>
              ) : null}
            </Stack>
          </Stack>

          {commandsError ? (
            <Alert severity="error" data-testid="agent-commands-error">
              {commandsError}
            </Alert>
          ) : null}

          <Stack
            data-testid="agent-command-row"
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            alignItems={{ xs: 'stretch', sm: 'center' }}
          >
            <FormControl
              fullWidth
              size="small"
              disabled={
                controlsDisabled ||
                submitDisabledForRun ||
                selectedAgentDisabled ||
                commandsLoading
              }
              sx={{ flex: 1 }}
            >
              <InputLabel id="agent-command-select-label">Command</InputLabel>
              <Select
                labelId="agent-command-select-label"
                label="Command"
                value={selectedCommandKey}
                onChange={onCommandChange}
                inputProps={{ 'data-testid': 'agent-command-select' }}
              >
                <MenuItem value="" disabled>
                  Select a command
                </MenuItem>
                {commandOptions.map((cmd) => (
                  <MenuItem
                    key={cmd.key}
                    value={cmd.key}
                    disabled={cmd.disabled}
                    data-testid={`agent-command-option-${cmd.key}`}
                  >
                    <Stack spacing={0.25}>
                      <Typography variant="body2">{cmd.label}</Typography>
                      {cmd.disabled ? (
                        <Typography variant="caption" color="text.secondary">
                          Invalid command file
                        </Typography>
                      ) : null}
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl
              fullWidth
              size="small"
              disabled={startStepDisabled}
              sx={{ flex: 1 }}
            >
              <InputLabel id="agent-command-start-step-label">
                Start step
              </InputLabel>
              <Select
                labelId="agent-command-start-step-label"
                label="Start step"
                value={startStepValue}
                onChange={onStartStepChange}
                displayEmpty
                inputProps={{
                  'data-testid': 'agent-command-start-step-select',
                }}
              >
                {!selectedCommandKey ? (
                  <MenuItem value="" disabled>
                    Select command first
                  </MenuItem>
                ) : null}
                {Array.from(
                  { length: Math.max(1, selectedCommandStepCount) },
                  (_, index) => {
                    const step = index + 1;
                    return (
                      <MenuItem
                        key={step}
                        value={`${step}`}
                        data-testid={`agent-command-start-step-option-${step}`}
                      >
                        {`Step ${step}`}
                      </MenuItem>
                    );
                  },
                )}
              </Select>
            </FormControl>

            <Box onMouseDownCapture={onCommandInfoAttempt}>
              <IconButton
                aria-describedby={commandInfoId}
                aria-label="Command info"
                onClick={onCommandInfoOpen}
                disabled={commandInfoDisabled}
                size="small"
                data-testid="agent-command-info"
              >
                <InfoOutlinedIcon fontSize="small" />
              </IconButton>
            </Box>

            <Button
              type="button"
              variant="contained"
              size="small"
              disabled={
                !selectedCommandKey ||
                submitDisabledForRun ||
                persistenceUnavailable ||
                !wsTranscriptReady ||
                controlsDisabled ||
                selectedAgentDisabled
              }
              onClick={onExecuteCommand}
              data-testid="agent-command-execute"
              sx={{ flexShrink: 0 }}
            >
              Execute command
            </Button>
          </Stack>

          {persistenceUnavailable ? (
            <Typography
              variant="body2"
              color="text.secondary"
              data-testid="agent-command-persistence-note"
            >
              Commands require conversation history (Mongo) to display
              multi-step results.
            </Typography>
          ) : !wsTranscriptReady ? (
            <Typography
              variant="body2"
              color="text.secondary"
              data-testid="agent-command-ws-note"
            >
              Commands require an open WebSocket connection.
            </Typography>
          ) : null}

          {selectedAgentDisabled ? (
            <Alert severity="warning" data-testid="agent-disabled">
              This agent is currently disabled.
            </Alert>
          ) : null}

          <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField
              fullWidth
              size="small"
              label="working_folder"
              placeholder="Absolute host path (optional)"
              value={workingFolder}
              onChange={(event) => onWorkingFolderChange(event.target.value)}
              onBlur={(event) =>
                void onCommitWorkingFolder('blur', event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                event.stopPropagation();
                void onCommitWorkingFolder(
                  'enter',
                  (event.currentTarget as HTMLInputElement).value,
                );
              }}
              disabled={isWorkingFolderDisabled}
              inputProps={{ 'data-testid': 'agent-working-folder' }}
            />
            <Button
              type="button"
              variant="outlined"
              size="small"
              disabled={isWorkingFolderDisabled}
              onClick={onOpenDirPicker}
              data-testid="agent-working-folder-picker"
              sx={{ flexShrink: 0 }}
            >
              Choose folder…
            </Button>
          </Stack>

          {shouldShowPromptsRow ? (
            <Stack
              data-testid="agent-prompts-row"
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              alignItems={{ xs: 'stretch', sm: 'flex-start' }}
            >
              {hasPromptEntries ? (
                <>
                  <FormControl fullWidth size="small">
                    <InputLabel id="agent-prompts-label">Prompts</InputLabel>
                    <Select
                      labelId="agent-prompts-label"
                      label="Prompts"
                      value={selectedPromptFullPath}
                      onChange={onPromptSelectionChange}
                      displayEmpty
                      data-testid="agent-prompts-select"
                    >
                      <MenuItem value="">No prompt selected</MenuItem>
                      {promptEntries.map((entry) => (
                        <MenuItem key={entry.fullPath} value={entry.fullPath}>
                          {entry.relativePath}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Button
                    type="button"
                    variant="contained"
                    size="small"
                    disabled={!executePromptEnabled || !wsTranscriptReady}
                    onClick={onExecutePrompt}
                    data-testid="agent-prompt-execute"
                    sx={{ flexShrink: 0 }}
                  >
                    Execute Prompt
                  </Button>
                </>
              ) : null}
              {shouldShowPromptsError ? (
                <Alert severity="error" data-testid="agent-prompts-error">
                  {promptsError}
                </Alert>
              ) : null}
            </Stack>
          ) : null}

          <Stack
            data-testid="agent-instruction-row"
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            alignItems={{ xs: 'stretch', sm: 'flex-start' }}
          >
            <TextField
              inputRef={inputRef}
              fullWidth
              multiline
              minRows={2}
              size="small"
              label="Instruction"
              placeholder="Type your instruction"
              value={input}
              onChange={(event) => {
                const nextValue = event.target.value;
                agentsComposerLog(
                  'info',
                  'DEV-0000049:T02:agents_composer_input_changed',
                  {
                    conversationId: conversationId ?? null,
                    inputLength: nextValue.length,
                  },
                );
                onInputChange(nextValue);
              }}
              disabled={isInstructionInputDisabled}
              inputProps={{ 'data-testid': 'agent-input' }}
              sx={{ flex: 1 }}
            />
            <Box
              data-testid="agent-action-slot"
              style={{ minWidth: actionSlotMinWidth }}
              sx={{ flexShrink: 0 }}
            >
              <Stack direction="row" justifyContent="flex-end">
                {showStop ? (
                  <Button
                    type="button"
                    variant="contained"
                    color="error"
                    size="small"
                    onClick={onStopClick}
                    data-testid="agent-stop"
                    disabled={isStopping}
                  >
                    {isStopping ? 'Stopping...' : 'Stop'}
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    variant="contained"
                    size="small"
                    disabled={
                      controlsDisabled ||
                      submitDisabledForRun ||
                      !wsTranscriptReady ||
                      !selectedAgentName ||
                      !input.trim() ||
                      selectedAgentDisabled
                    }
                    data-testid="agent-send"
                  >
                    Send
                  </Button>
                )}
              </Stack>
            </Box>
          </Stack>

          <DirectoryPickerDialog
            open={dirPickerOpen}
            path={workingFolder}
            onClose={onCloseDirPicker}
            onPick={onPickDir}
          />
          <CodexDeviceAuthDialog
            open={deviceAuthOpen}
            onClose={onDeviceAuthClose}
            source="agents"
            onSuccess={onDeviceAuthSuccess}
          />
        </Stack>
      </Box>

      <Popover
        id={commandInfoId}
        open={commandInfoOpen}
        anchorEl={commandInfoAnchorEl}
        onClose={onCommandInfoClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        data-testid="agent-command-info-popover"
      >
        <Stack spacing={1} sx={{ p: 2, maxWidth: 360 }}>
          <Typography variant="subtitle2">Command</Typography>
          <Typography variant="body2" data-testid="command-info-text">
            {selectedCommandDescription}
          </Typography>
        </Stack>
      </Popover>

      <Popover
        id={agentInfoId}
        open={agentInfoOpen}
        anchorEl={agentInfoAnchorEl}
        onClose={onAgentInfoClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        data-testid="agent-info-popover"
      >
        <Stack spacing={1} sx={{ p: 2, maxWidth: 360 }}>
          {agentWarnings.length > 0 ? (
            <Stack spacing={0.5} data-testid="agent-warnings">
              <Typography variant="subtitle2" color="warning.main">
                Warnings
              </Typography>
              {agentWarnings.map((warning) => (
                <Typography key={warning} variant="body2" color="warning.main">
                  {warning}
                </Typography>
              ))}
            </Stack>
          ) : null}
          {agentDescription ? (
            <Box data-testid="agent-description">
              <Markdown content={agentDescription} />
            </Box>
          ) : null}
          {agentInfoEmpty ? (
            <Typography
              variant="body2"
              color="text.secondary"
              data-testid="agent-info-empty"
            >
              {agentInfoEmptyMessage}
            </Typography>
          ) : null}
        </Stack>
      </Popover>
    </>
  );
});

export default AgentsComposerPanel;
