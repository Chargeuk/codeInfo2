import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import PersonOutlineOutlinedIcon from '@mui/icons-material/PersonOutlineOutlined';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import TerminalRoundedIcon from '@mui/icons-material/TerminalRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import {
  Alert,
  Box,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  memo,
  useMemo,
  useState,
  type FormEventHandler,
  type RefObject,
} from 'react';
import Markdown from '../Markdown';
import CodexDeviceAuthDialog from '../codex/CodexDeviceAuthDialog';
import DirectoryPickerDialog from '../ingest/DirectoryPickerDialog';
import CommonComposerFooter from '../workspace/composer/CommonComposerFooter';
import CommonComposerMainInputRow from '../workspace/composer/CommonComposerMainInputRow';
import CommonComposerShell from '../workspace/composer/CommonComposerShell';
import ComposerDesktopPopover from '../workspace/composer/ComposerDesktopPopover';
import ComposerFooterButton from '../workspace/composer/ComposerFooterButton';
import ComposerMobileDialog from '../workspace/composer/ComposerMobileDialog';
import ComposerSendButton from '../workspace/composer/ComposerSendButton';
import { getWorkingFolderName } from '../workspace/composer/composerFormatting';

type AgentOption = {
  name: string;
};

type AgentWarningDetails = {
  code: string;
  message: string;
  providerId?: string;
  fallbackProviderId?: string;
};

type AgentDisabledReason = {
  code: string;
  message: string;
  providerId?: string;
};

type CommandOption = {
  key: string;
  label: string;
  disabled: boolean;
  description: string;
};

type PromptEntry = {
  fullPath: string;
  relativePath: string;
};

export type AgentsActionMode =
  | 'instruction'
  | `command:${string}`
  | `prompt:${string}`;

type AgentsComposerPanelProps = {
  agentsLoading: boolean;
  agentsError: string | null;
  agents: AgentOption[];
  selectedAgentName: string;
  selectedAgentDisabled: boolean;
  selectedAgentDescription?: string;
  agentWarnings: AgentWarningDetails[];
  agentDisabledReason?: AgentDisabledReason;
  agentInfoEmpty: boolean;
  agentInfoEmptyMessage: string;
  agentModelId: string;
  commandsError: string | null;
  commandsLoading: boolean;
  commandOptions: CommandOption[];
  promptEntries: PromptEntry[];
  promptsError: string | null;
  selectedActionMode: AgentsActionMode;
  selectedCommandStepCount: number;
  selectedStep: number;
  selectedWorkingFolder: string;
  input: string;
  showStop: boolean;
  isStopping: boolean;
  canShowDeviceAuth: boolean;
  controlsDisabled: boolean;
  submitDisabledForRun: boolean;
  startStepDisabled: boolean;
  persistenceUnavailable: boolean;
  wsTranscriptReady: boolean;
  isWorkingFolderDisabled: boolean;
  isInstructionInputDisabled: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onAgentSelect: (name: string) => void;
  onInstructionModeSelect: () => void;
  onCommandModeSelect: (commandKey: string) => void;
  onPromptModeSelect: (promptFullPath: string) => void;
  onStepSelect: (step: number) => void;
  onResetConversation: () => void;
  onWorkingFolderChange: (value: string) => void;
  onCommitWorkingFolder: (
    trigger: 'blur' | 'enter' | 'picker',
    value: string,
  ) => Promise<unknown>;
  onOpenDirPicker: () => void;
  onInputChange: (value: string) => void;
  onStopClick: () => void;
  onDeviceAuthOpen: () => void;
  onDeviceAuthClose: () => void;
  onDeviceAuthSuccess: () => void;
  dirPickerOpen: boolean;
  onCloseDirPicker: () => void;
  onPickDir: (path: string) => void;
  deviceAuthOpen: boolean;
} & Record<string, unknown>;

const extractMode = (mode: AgentsActionMode) => {
  if (mode === 'instruction') {
    return { kind: 'instruction' as const, value: '' };
  }

  if (mode.startsWith('command:')) {
    return {
      kind: 'command' as const,
      value: mode.slice('command:'.length),
    };
  }

  return {
    kind: 'prompt' as const,
    value: mode.slice('prompt:'.length),
  };
};

const getModeLabel = (
  mode: AgentsActionMode,
  commandOptions: CommandOption[],
  promptEntries: PromptEntry[],
) => {
  if (mode === 'instruction') return 'Write instruction';

  const extracted = extractMode(mode);
  if (extracted.kind === 'command') {
    return (
      commandOptions.find((option) => option.key === extracted.value)?.label ??
      'Select command'
    );
  }

  return (
    promptEntries.find((entry) => entry.fullPath === extracted.value)
      ?.relativePath ?? 'Select prompt'
  );
};

const getCommandOption = (mode: AgentsActionMode, options: CommandOption[]) => {
  if (!mode.startsWith('command:')) return null;
  return (
    options.find((option) => option.key === mode.slice('command:'.length)) ??
    null
  );
};

const getPromptEntry = (mode: AgentsActionMode, entries: PromptEntry[]) => {
  if (!mode.startsWith('prompt:')) return null;
  return (
    entries.find((entry) => entry.fullPath === mode.slice('prompt:'.length)) ??
    null
  );
};

const buildStepLabel = (step: number) => `Step ${step}`;

const AgentsComposerPanel = memo(function AgentsComposerPanel({
  agentsLoading,
  agentsError,
  agents,
  selectedAgentName,
  selectedAgentDisabled,
  selectedAgentDescription,
  agentWarnings,
  agentDisabledReason,
  agentInfoEmpty,
  agentInfoEmptyMessage,
  agentModelId,
  commandsError,
  commandsLoading,
  commandOptions,
  promptEntries,
  promptsError,
  selectedActionMode,
  selectedCommandStepCount,
  selectedStep,
  selectedWorkingFolder,
  input,
  showStop,
  isStopping,
  canShowDeviceAuth,
  controlsDisabled,
  submitDisabledForRun,
  startStepDisabled,
  persistenceUnavailable,
  wsTranscriptReady,
  isWorkingFolderDisabled,
  isInstructionInputDisabled,
  inputRef,
  onSubmit,
  onAgentSelect,
  onInstructionModeSelect,
  onCommandModeSelect,
  onPromptModeSelect,
  onStepSelect,
  onResetConversation,
  onWorkingFolderChange,
  onCommitWorkingFolder,
  onOpenDirPicker,
  onInputChange,
  onStopClick,
  onDeviceAuthOpen,
  onDeviceAuthClose,
  onDeviceAuthSuccess,
  dirPickerOpen,
  onCloseDirPicker,
  onPickDir,
  deviceAuthOpen,
}: AgentsComposerPanelProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [agentAnchorEl, setAgentAnchorEl] = useState<HTMLElement | null>(null);
  const [actionAnchorEl, setActionAnchorEl] = useState<HTMLElement | null>(
    null,
  );
  const [stepAnchorEl, setStepAnchorEl] = useState<HTMLElement | null>(null);
  const [workingPathAnchorEl, setWorkingPathAnchorEl] =
    useState<HTMLElement | null>(null);
  const [infoAnchorEl, setInfoAnchorEl] = useState<HTMLElement | null>(null);

  const workingFolderName = useMemo(
    () => getWorkingFolderName(selectedWorkingFolder) || 'Select folder',
    [selectedWorkingFolder],
  );

  const selectedCommandOption = useMemo(
    () => getCommandOption(selectedActionMode, commandOptions),
    [commandOptions, selectedActionMode],
  );
  const selectedPromptEntry = useMemo(
    () => getPromptEntry(selectedActionMode, promptEntries),
    [promptEntries, selectedActionMode],
  );
  const modeLabel = useMemo(
    () => getModeLabel(selectedActionMode, commandOptions, promptEntries),
    [commandOptions, promptEntries, selectedActionMode],
  );

  const commandSendDisabled =
    controlsDisabled ||
    submitDisabledForRun ||
    !wsTranscriptReady ||
    persistenceUnavailable ||
    selectedAgentDisabled ||
    !selectedCommandOption ||
    selectedCommandOption.disabled;
  const promptSendDisabled =
    controlsDisabled ||
    submitDisabledForRun ||
    !wsTranscriptReady ||
    persistenceUnavailable ||
    selectedAgentDisabled ||
    !selectedPromptEntry;
  const instructionSendDisabled =
    controlsDisabled ||
    submitDisabledForRun ||
    !wsTranscriptReady ||
    persistenceUnavailable ||
    selectedAgentDisabled ||
    !input.trim();
  const sendDisabled = showStop
    ? isStopping
    : selectedActionMode === 'instruction'
      ? instructionSendDisabled
      : selectedActionMode.startsWith('command:')
        ? commandSendDisabled
        : promptSendDisabled;

  const selectedAgentInfo = selectedAgentDescription?.trim() ?? '';
  const warningMessages = useMemo(
    () =>
      Array.from(
        new Set([
          ...agentWarnings.map((warning) => warning.message),
          ...(agentDisabledReason ? [agentDisabledReason.message] : []),
        ]),
      ),
    [agentDisabledReason, agentWarnings],
  );

  const infoContent = (
    <Stack spacing={1.75} data-testid="agent-composer-info-content">
      <Box
        sx={{
          p: 1.5,
          borderRadius: 3,
          border: `1px solid ${theme.palette.divider}`,
          bgcolor: 'background.paper',
        }}
      >
        <Stack spacing={0.5}>
          <Typography variant="overline" color="text.secondary">
            Current mode
          </Typography>
          <Typography variant="subtitle2" fontWeight={700}>
            {selectedActionMode === 'instruction'
              ? 'Instruction mode'
              : selectedActionMode.startsWith('command:')
                ? 'Command mode'
                : 'Saved prompt mode'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {modeLabel}
          </Typography>
        </Stack>
      </Box>

      <Stack
        spacing={1}
        sx={{
          p: 1.5,
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 3,
        }}
      >
        <Stack>
          <Typography variant="caption" color="text.secondary">
            Agent
          </Typography>
          <Typography variant="body2" fontWeight={600}>
            {selectedAgentName || 'Select agent'}
          </Typography>
        </Stack>
        <Stack>
          <Typography variant="caption" color="text.secondary">
            Action
          </Typography>
          <Typography variant="body2" fontWeight={600}>
            {modeLabel}
          </Typography>
        </Stack>
        <Stack>
          <Typography variant="caption" color="text.secondary">
            Step
          </Typography>
          <Typography variant="body2" fontWeight={600}>
            {selectedActionMode.startsWith('command:')
              ? buildStepLabel(selectedStep)
              : 'Not applicable'}
          </Typography>
        </Stack>
        <Stack>
          <Typography variant="caption" color="text.secondary">
            Working path
          </Typography>
          <Typography variant="body2" fontWeight={600}>
            {workingFolderName}
          </Typography>
        </Stack>
        <Stack>
          <Typography variant="caption" color="text.secondary">
            Model
          </Typography>
          <Typography variant="body2" fontWeight={600}>
            {agentModelId && agentModelId !== 'unknown'
              ? agentModelId
              : 'Unknown'}
          </Typography>
        </Stack>
      </Stack>

      {warningMessages.length > 0 ? (
        <Stack spacing={0.5}>
          <Typography variant="subtitle2" color="warning.main">
            Warnings
          </Typography>
          {warningMessages.map((warning) => (
            <Typography key={warning} variant="body2" color="warning.main">
              {warning}
            </Typography>
          ))}
        </Stack>
      ) : null}

      {selectedAgentInfo ? (
        <Box data-testid="agent-description">
          <Markdown content={selectedAgentInfo} />
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

      <Stack direction="row" spacing={1} flexWrap="wrap">
        <Button
          variant="outlined"
          onClick={() => {
            setInfoAnchorEl(null);
            onResetConversation();
          }}
          data-testid="agent-new-conversation"
        >
          New conversation
        </Button>
        {canShowDeviceAuth ? (
          <Button
            variant="outlined"
            color="secondary"
            onClick={() => {
              setInfoAnchorEl(null);
              onDeviceAuthOpen();
            }}
          >
            Re-authenticate
          </Button>
        ) : null}
      </Stack>
    </Stack>
  );

  const workingPathContent = (
    <Stack spacing={2} data-testid="agent-working-path-content">
      <TextField
        fullWidth
        size="small"
        label="Working folder"
        placeholder="Absolute host path (optional)"
        value={selectedWorkingFolder}
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
        inputProps={{ 'data-testid': 'agent-working-folder', 'aria-label': 'working_folder', name: 'working_folder' }}
      />
      <Stack direction="row" spacing={1.25} justifyContent="space-between">
        <Button
          type="button"
          variant="outlined"
          size="small"
          onClick={onOpenDirPicker}
          disabled={isWorkingFolderDisabled}
          data-testid="agent-working-folder-picker"
        >
          Choose folder…
        </Button>
        <Button
          type="button"
          variant="text"
          size="small"
          onClick={() => void onCommitWorkingFolder('picker', '')}
          disabled={isWorkingFolderDisabled}
        >
          Clear
        </Button>
      </Stack>
    </Stack>
  );

  const agentListContent = (
    <List disablePadding dense role="listbox" aria-label="Agent options">
      {agentsError ? (
        <ListItemButton disabled>
          <ListItemText
            primary="Unable to load agents"
            secondary={agentsError}
          />
        </ListItemButton>
      ) : null}
      {agents.map((agent) => (
        <ListItemButton
          key={agent.name}
          component="div"
          role="option"
          aria-selected={agent.name === selectedAgentName}
          selected={agent.name === selectedAgentName}
          disabled={agentsLoading}
          onClick={() => {
            setAgentAnchorEl(null);
            onAgentSelect(agent.name);
          }}
        >
          <ListItemIcon sx={{ minWidth: 36, color: 'text.secondary' }}>
            <PersonOutlineOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={agent.name} />
        </ListItemButton>
      ))}
    </List>
  );

  const commandListContent = (
    <Stack spacing={1.25} data-testid="agent-command-selector-content">
      {commandsError ? <Alert severity="error">{commandsError}</Alert> : null}
      <List disablePadding dense role="listbox" aria-label="Action options">
        <ListItemButton
          component="div"
          role="option"
          selected={selectedActionMode === 'instruction'}
          aria-selected={selectedActionMode === 'instruction'}
          onClick={() => {
            setActionAnchorEl(null);
            onInstructionModeSelect();
          }}
        >
          <ListItemIcon sx={{ minWidth: 36, color: 'text.secondary' }}>
            <AutoAwesomeRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="Write instruction"
            secondary="Freeform instruction mode"
          />
        </ListItemButton>

        {commandOptions.length > 0 ? <Divider sx={{ my: 0.5 }} /> : null}

        {commandOptions.map((command) => {
          const modeValue = `command:${command.key}` as const;
          return (
            <ListItemButton
              key={command.key}
              component="div"
              role="option"
              selected={selectedActionMode === modeValue}
              aria-selected={selectedActionMode === modeValue}
              disabled={command.disabled || commandsLoading}
              onClick={() => {
                setActionAnchorEl(null);
                onCommandModeSelect(command.key);
              }}
            >
              <ListItemIcon sx={{ minWidth: 36, color: 'text.secondary' }}>
                <TerminalRoundedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={command.label}
                secondary={command.description}
              />
            </ListItemButton>
          );
        })}

        {promptEntries.length > 0 ? <Divider sx={{ my: 0.5 }} /> : null}

        {promptEntries.map((prompt) => {
          const modeValue = `prompt:${prompt.fullPath}` as const;
          return (
            <ListItemButton
              key={prompt.fullPath}
              component="div"
              role="option"
              selected={selectedActionMode === modeValue}
              aria-selected={selectedActionMode === modeValue}
              onClick={() => {
                setActionAnchorEl(null);
                onPromptModeSelect(prompt.fullPath);
              }}
            >
              <ListItemIcon sx={{ minWidth: 36, color: 'text.secondary' }}>
                <PlayArrowRoundedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={prompt.relativePath}
                secondary={prompt.fullPath}
              />
            </ListItemButton>
          );
        })}

        {!commandOptions.length && !promptEntries.length ? (
          <ListItemButton disabled>
            <ListItemText
              primary="No commands or prompts"
              secondary="Select an agent and working path first."
            />
          </ListItemButton>
        ) : null}
      </List>
      {promptsError && !promptEntries.length ? (
        <Alert severity="error" data-testid="agent-prompts-error">
          {promptsError}
        </Alert>
      ) : null}
    </Stack>
  );

  const stepListContent = (
    <Stack spacing={1.25} data-testid="agent-step-selector-content">
      <Typography variant="body2" color="text.secondary">
        {selectedActionMode.startsWith('command:')
          ? 'Choose the command step.'
          : 'Step selection is only available for command mode.'}
      </Typography>
      <List disablePadding dense role="listbox" aria-label="Step options">
        {selectedActionMode.startsWith('command:')
          ? Array.from(
              { length: Math.max(1, selectedCommandStepCount) },
              (_, i) => {
                const step = i + 1;
                return (
                  <ListItemButton
                    key={step}
                    component="div"
                    role="option"
                    selected={step === selectedStep}
                    aria-selected={step === selectedStep}
                    onClick={() => {
                      setStepAnchorEl(null);
                      onStepSelect(step);
                    }}
                  >
                    <ListItemIcon
                      sx={{ minWidth: 36, color: 'text.secondary' }}
                    >
                      <TuneRoundedIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText primary={buildStepLabel(step)} />
                  </ListItemButton>
                );
              },
            )
          : null}
      </List>
    </Stack>
  );

  const mainInputRow = (
    <CommonComposerMainInputRow>
      <TextField
        inputRef={inputRef}
        fullWidth
        multiline
        minRows={2}
        maxRows={6}
        size="small"
        placeholder={
          selectedActionMode === 'instruction'
            ? 'Type your instruction'
            : 'Select an action from the footer'
        }
        value={input}
        onChange={(event) => onInputChange(event.target.value)}
        disabled={isInstructionInputDisabled}
        slotProps={{
          htmlInput: { 'data-testid': 'agent-input', 'aria-label': 'Message' },
        }}
        sx={{
          flex: 1,
          minWidth: 0,
          '& .MuiInputBase-root': {
            minHeight: { xs: 32, sm: 42 },
            alignItems: 'center',
            pl: { xs: 0.125, sm: 1.25 },
            pr: { xs: 0.75, sm: 1.25 },
            py: { xs: 0.5, sm: 0.75 },
          },
          '& .MuiInputBase-inputMultiline': {
            p: 0,
            lineHeight: 1.35,
          },
        }}
      />
      <ComposerSendButton
        showStop={showStop}
        isStopping={isStopping}
        disabled={sendDisabled}
        onClick={showStop ? onStopClick : undefined}
        data-testid="agent-send"
      />
    </CommonComposerMainInputRow>
  );

  const footerRow = (
    <CommonComposerFooter>
      <ComposerFooterButton
        icon={<InfoOutlinedIcon fontSize="small" />}
        label="Info"
        iconOnly
        ariaLabel="Composer info"
        selected={Boolean(infoAnchorEl)}
        onClick={(event) => setInfoAnchorEl(event.currentTarget)}
        data-testid="agent-composer-info"
      />
      <ComposerFooterButton
        icon={<FolderOutlinedIcon fontSize="small" />}
        label="Working path"
        value={workingFolderName}
        selected={Boolean(workingPathAnchorEl)}
        onClick={(event) => setWorkingPathAnchorEl(event.currentTarget)}
        data-testid="agent-working-path-trigger"
        disabled={isWorkingFolderDisabled}
      />
      <ComposerFooterButton
        icon={<PersonOutlineOutlinedIcon fontSize="small" />}
        label="Agent"
        value={selectedAgentName || 'Select agent'}
        selected={Boolean(agentAnchorEl)}
        onClick={(event) => setAgentAnchorEl(event.currentTarget)}
        data-testid="agent-select-trigger"
        disabled={agentsLoading || !!agentsError}
        ariaHaspopup="listbox"
        ariaExpanded={Boolean(agentAnchorEl)}
        role="combobox"
      />
      <ComposerFooterButton
        icon={<TerminalRoundedIcon fontSize="small" />}
        label="Command"
        value={modeLabel}
        selected={Boolean(actionAnchorEl)}
        onClick={(event) => setActionAnchorEl(event.currentTarget)}
        data-testid="agent-command-trigger"
        disabled={controlsDisabled || !!agentsError || commandsLoading}
        ariaHaspopup="listbox"
        ariaExpanded={Boolean(actionAnchorEl)}
        role="combobox"
      />
      <ComposerFooterButton
        icon={<TuneRoundedIcon fontSize="small" />}
        label="Step"
        value={
          selectedActionMode.startsWith('command:')
            ? buildStepLabel(selectedStep)
            : 'Not used'
        }
        selected={Boolean(stepAnchorEl)}
        onClick={(event) => setStepAnchorEl(event.currentTarget)}
        data-testid="agent-step-trigger"
        disabled={startStepDisabled}
        ariaHaspopup="listbox"
        ariaExpanded={Boolean(stepAnchorEl)}
        role="combobox"
      />
    </CommonComposerFooter>
  );

  return (
    <>
      <CommonComposerShell
        data-testid="chat-controls"
        onSubmit={onSubmit}
        mainInputRow={mainInputRow}
        footerRow={footerRow}
      />

      <ComposerDesktopPopover
        open={!isMobile && Boolean(infoAnchorEl)}
        anchorEl={infoAnchorEl}
        onClose={() => setInfoAnchorEl(null)}
        width={420}
        data-testid="agent-info-popover"
      >
        {infoContent}
      </ComposerDesktopPopover>
      <ComposerMobileDialog
        open={isMobile && Boolean(infoAnchorEl)}
        onClose={() => setInfoAnchorEl(null)}
        data-testid="agent-info-dialog"
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography variant="h6">Info</Typography>
            <IconButton
              onClick={() => setInfoAnchorEl(null)}
              aria-label="Close"
            >
              ×
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>{infoContent}</DialogContent>
        <DialogActions>
          <Button onClick={() => setInfoAnchorEl(null)}>Close</Button>
        </DialogActions>
      </ComposerMobileDialog>

      <ComposerDesktopPopover
        open={!isMobile && Boolean(workingPathAnchorEl)}
        anchorEl={workingPathAnchorEl}
        onClose={() => setWorkingPathAnchorEl(null)}
        width={420}
        data-testid="agent-working-path-popover"
      >
        {workingPathContent}
      </ComposerDesktopPopover>
      <ComposerMobileDialog
        open={isMobile && Boolean(workingPathAnchorEl)}
        onClose={() => setWorkingPathAnchorEl(null)}
        data-testid="agent-working-path-dialog"
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography variant="h6">Working path</Typography>
            <IconButton
              onClick={() => setWorkingPathAnchorEl(null)}
              aria-label="Close"
            >
              ×
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>{workingPathContent}</DialogContent>
        <DialogActions>
          <Button onClick={() => setWorkingPathAnchorEl(null)}>Close</Button>
        </DialogActions>
      </ComposerMobileDialog>

      <ComposerDesktopPopover
        open={!isMobile && Boolean(agentAnchorEl)}
        anchorEl={agentAnchorEl}
        onClose={() => setAgentAnchorEl(null)}
        width={360}
        data-testid="agent-selector-popover"
      >
        <Box>
          <Stack spacing={1.5}>
            {agentsError ? <Alert severity="error">{agentsError}</Alert> : null}
            {agentListContent}
          </Stack>
        </Box>
      </ComposerDesktopPopover>
      <ComposerMobileDialog
        open={isMobile && Boolean(agentAnchorEl)}
        onClose={() => setAgentAnchorEl(null)}
        data-testid="agent-selector-dialog"
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography variant="h6">Agent</Typography>
            <IconButton
              onClick={() => setAgentAnchorEl(null)}
              aria-label="Close"
            >
              ×
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>{agentListContent}</DialogContent>
        <DialogActions>
          <Button onClick={() => setAgentAnchorEl(null)}>Close</Button>
        </DialogActions>
      </ComposerMobileDialog>

      <ComposerDesktopPopover
        open={!isMobile && Boolean(actionAnchorEl)}
        anchorEl={actionAnchorEl}
        onClose={() => setActionAnchorEl(null)}
        width={480}
        data-testid="agent-command-popover"
      >
        {commandListContent}
      </ComposerDesktopPopover>
      <ComposerMobileDialog
        open={isMobile && Boolean(actionAnchorEl)}
        onClose={() => setActionAnchorEl(null)}
        data-testid="agent-command-dialog"
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography variant="h6">Command</Typography>
            <IconButton
              onClick={() => setActionAnchorEl(null)}
              aria-label="Close"
            >
              ×
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>{commandListContent}</DialogContent>
        <DialogActions>
          <Button onClick={() => setActionAnchorEl(null)}>Close</Button>
        </DialogActions>
      </ComposerMobileDialog>

      <ComposerDesktopPopover
        open={!isMobile && Boolean(stepAnchorEl)}
        anchorEl={stepAnchorEl}
        onClose={() => setStepAnchorEl(null)}
        width={320}
        data-testid="agent-step-popover"
      >
        {stepListContent}
      </ComposerDesktopPopover>
      <ComposerMobileDialog
        open={isMobile && Boolean(stepAnchorEl)}
        onClose={() => setStepAnchorEl(null)}
        data-testid="agent-step-dialog"
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography variant="h6">Step</Typography>
            <IconButton
              onClick={() => setStepAnchorEl(null)}
              aria-label="Close"
            >
              ×
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>{stepListContent}</DialogContent>
        <DialogActions>
          <Button onClick={() => setStepAnchorEl(null)}>Close</Button>
        </DialogActions>
      </ComposerMobileDialog>

      <DirectoryPickerDialog
        open={dirPickerOpen}
        path={selectedWorkingFolder}
        onClose={onCloseDirPicker}
        onPick={onPickDir}
      />
      <CodexDeviceAuthDialog
        open={deviceAuthOpen}
        onClose={onDeviceAuthClose}
        source="agents"
        onSuccess={onDeviceAuthSuccess}
      />
    </>
  );
});

export default AgentsComposerPanel;
