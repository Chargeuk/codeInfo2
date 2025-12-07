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
import type { SandboxMode } from '../../hooks/useChatStream';

type Props = {
  sandboxMode: SandboxMode;
  onSandboxModeChange: (value: SandboxMode) => void;
  networkAccessEnabled: boolean;
  onNetworkAccessEnabledChange: (value: boolean) => void;
  disabled?: boolean;
};

const sandboxOptions: Array<{ value: SandboxMode; label: string }> = [
  { value: 'workspace-write', label: 'Workspace write (default)' },
  { value: 'read-only', label: 'Read-only' },
  { value: 'danger-full-access', label: 'Danger full access' },
];

export default function CodexFlagsPanel({
  sandboxMode,
  onSandboxModeChange,
  networkAccessEnabled,
  onNetworkAccessEnabledChange,
  disabled,
}: Props) {
  return (
    <Accordion
      defaultExpanded
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
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
