import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import type {
  ApprovalPolicy,
  ModelReasoningEffort,
  SandboxMode,
} from '../../hooks/useChatStream';

type Props = {
  sandboxMode: SandboxMode;
  onSandboxModeChange: (value: SandboxMode) => void;
  approvalPolicy: ApprovalPolicy;
  onApprovalPolicyChange: (value: ApprovalPolicy) => void;
  modelReasoningEffort: ModelReasoningEffort;
  onModelReasoningEffortChange: (value: ModelReasoningEffort) => void;
  networkAccessEnabled: boolean;
  onNetworkAccessEnabledChange: (value: boolean) => void;
  webSearchEnabled: boolean;
  onWebSearchEnabledChange: (value: boolean) => void;
  disabled?: boolean;
};

const sandboxOptions: Array<{ value: SandboxMode; label: string }> = [
  { value: 'workspace-write', label: 'Workspace write (default)' },
  { value: 'read-only', label: 'Read-only' },
  { value: 'danger-full-access', label: 'Danger full access' },
];

const approvalOptions: Array<{ value: ApprovalPolicy; label: string }> = [
  { value: 'on-failure', label: 'On failure (default)' },
  { value: 'on-request', label: 'On request' },
  { value: 'never', label: 'Never (auto-approve)' },
  { value: 'untrusted', label: 'Untrusted' },
];

const reasoningOptions: Array<{
  value: ModelReasoningEffort;
  label: string;
}> = [
  { value: 'xhigh', label: 'XHigh' },
  { value: 'high', label: 'High (default)' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export default function CodexFlagsPanel({
  sandboxMode,
  onSandboxModeChange,
  approvalPolicy,
  onApprovalPolicyChange,
  modelReasoningEffort,
  onModelReasoningEffortChange,
  networkAccessEnabled,
  onNetworkAccessEnabledChange,
  webSearchEnabled,
  onWebSearchEnabledChange,
  disabled,
}: Props) {
  return (
    <Accordion
      defaultExpanded={false}
      disableGutters
      data-testid="codex-flags-panel"
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'background.paper',
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
        <Stack spacing={0.25}>
          <Typography variant="subtitle2" fontWeight={700}>
            Codex flags
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Applies only when provider is OpenAI Codex.
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5}>
          <FormControl size="small" fullWidth disabled={disabled}>
            <InputLabel id="codex-sandbox-mode-label">Sandbox mode</InputLabel>
            <Select
              labelId="codex-sandbox-mode-label"
              id="codex-sandbox-mode-select"
              label="Sandbox mode"
              value={sandboxMode}
              onChange={(event) =>
                onSandboxModeChange(event.target.value as SandboxMode)
              }
              data-testid="sandbox-mode-select"
            >
              {sandboxOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
            <FormHelperText>
              Controls Codex sandbox permissions (ignored for LM Studio).
            </FormHelperText>
          </FormControl>

          <FormControl size="small" fullWidth disabled={disabled}>
            <InputLabel id="codex-reasoning-effort-label">
              Reasoning effort
            </InputLabel>
            <Select
              labelId="codex-reasoning-effort-label"
              id="codex-reasoning-effort-select"
              label="Reasoning effort"
              value={modelReasoningEffort}
              onChange={(event) =>
                onModelReasoningEffortChange(
                  event.target.value as ModelReasoningEffort,
                )
              }
              data-testid="reasoning-effort-select"
            >
              {reasoningOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
            <FormHelperText>
              Higher effort may improve quality at more cost (ignored for LM
              Studio).
            </FormHelperText>
          </FormControl>

          <Stack spacing={0.25}>
            <FormControlLabel
              control={
                <Switch
                  color="primary"
                  checked={networkAccessEnabled}
                  onChange={(event) =>
                    onNetworkAccessEnabledChange(event.target.checked)
                  }
                  disabled={disabled}
                  inputProps={{ 'data-testid': 'network-access-switch' }}
                />
              }
              label="Enable network access"
            />
            <FormHelperText sx={{ ml: 0 }}>
              Allows Codex sandbox network access (ignored for LM Studio).
            </FormHelperText>
          </Stack>

          <Stack spacing={0.25}>
            <FormControlLabel
              control={
                <Switch
                  color="primary"
                  checked={webSearchEnabled}
                  onChange={(event) =>
                    onWebSearchEnabledChange(event.target.checked)
                  }
                  disabled={disabled}
                  inputProps={{ 'data-testid': 'web-search-switch' }}
                />
              }
              label="Enable web search"
            />
            <FormHelperText sx={{ ml: 0 }}>
              Allows Codex to issue web search requests (ignored for LM Studio).
            </FormHelperText>
          </Stack>

          <FormControl size="small" fullWidth disabled={disabled}>
            <InputLabel id="codex-approval-policy-label">
              Approval policy
            </InputLabel>
            <Select
              labelId="codex-approval-policy-label"
              id="codex-approval-policy-select"
              label="Approval policy"
              value={approvalPolicy}
              onChange={(event) =>
                onApprovalPolicyChange(event.target.value as ApprovalPolicy)
              }
              data-testid="approval-policy-select"
            >
              {approvalOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
            <FormHelperText>
              Codex action approval behaviour (ignored for LM Studio).
            </FormHelperText>
          </FormControl>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
