import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  CodexDeviceAuthResponse,
  CodexDeviceAuthTarget,
  postCodexDeviceAuth,
} from '../../api/codex';
import { createLogger } from '../../logging/logger';

export type CodexDeviceAuthDialogTarget =
  | { target: 'chat' }
  | { target: 'agent'; agentName: string };

export type CodexDeviceAuthAgent = {
  name: string;
};

export type CodexDeviceAuthDialogProps = {
  open: boolean;
  onClose: () => void;
  defaultTarget: CodexDeviceAuthDialogTarget;
  agents: CodexDeviceAuthAgent[];
  onSuccess?: (response: CodexDeviceAuthResponse) => void;
};

type TargetOption = {
  value: string;
  label: string;
  target: CodexDeviceAuthTarget;
  agentName?: string;
};

const CHAT_TARGET_VALUE = 'chat';

function resolveTargetValue(
  target: CodexDeviceAuthDialogTarget,
  agents: CodexDeviceAuthAgent[],
) {
  if (target.target === 'agent') {
    const match = agents.find((agent) => agent.name === target.agentName);
    if (match) {
      return `agent:${match.name}`;
    }
  }
  return CHAT_TARGET_VALUE;
}

function parseTargetValue(value: string) {
  if (value === CHAT_TARGET_VALUE) {
    return { target: 'chat' as const };
  }
  if (value.startsWith('agent:')) {
    return { target: 'agent' as const, agentName: value.slice(6) };
  }
  return { target: 'chat' as const };
}

export default function CodexDeviceAuthDialog({
  open,
  onClose,
  defaultTarget,
  agents,
  onSuccess,
}: CodexDeviceAuthDialogProps) {
  const [selectedTarget, setSelectedTarget] = useState(CHAT_TARGET_VALUE);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [result, setResult] = useState<CodexDeviceAuthResponse | undefined>();
  const [copyMessage, setCopyMessage] = useState<string | undefined>();
  const prevOpenRef = useRef(false);

  const log = useMemo(() => createLogger('codex-device-auth-dialog'), []);

  const options = useMemo<TargetOption[]>(
    () => [
      { value: CHAT_TARGET_VALUE, label: 'Chat', target: 'chat' },
      ...agents.map((agent) => ({
        value: `agent:${agent.name}`,
        label: `Agent: ${agent.name}`,
        target: 'agent' as const,
        agentName: agent.name,
      })),
    ],
    [agents],
  );

  useEffect(() => {
    if (!open) {
      setLoading(false);
      setErrorMessage(undefined);
      setResult(undefined);
      setCopyMessage(undefined);
      prevOpenRef.current = false;
      return;
    }

    if (!prevOpenRef.current) {
      log('info', 'DEV-0000031:T6:codex_device_auth_dialog_open');
      setSelectedTarget(resolveTargetValue(defaultTarget, agents));
      setLoading(false);
      setErrorMessage(undefined);
      setResult(undefined);
      setCopyMessage(undefined);
    }

    prevOpenRef.current = true;
  }, [open, defaultTarget, agents, log]);

  const handleTargetChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectedTarget(event.target.value);
    setErrorMessage(undefined);
    setResult(undefined);
    setCopyMessage(undefined);
  };

  const handleStart = async () => {
    setLoading(true);
    setErrorMessage(undefined);
    setResult(undefined);
    setCopyMessage(undefined);

    const parsed = parseTargetValue(selectedTarget);
    try {
      const response = await postCodexDeviceAuth({
        target: parsed.target,
        ...(parsed.target === 'agent' && parsed.agentName
          ? { agentName: parsed.agentName }
          : {}),
      });
      setResult(response);
      log('info', 'DEV-0000031:T6:codex_device_auth_dialog_success', {
        target: response.target,
      });
      onSuccess?.(response);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Device auth failed.';
      setErrorMessage(message);
      log('error', 'DEV-0000031:T6:codex_device_auth_dialog_error', {
        message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDialogClose = () => {
    onClose();
  };

  const handleCopy = async (value: string, label: string) => {
    if (!navigator.clipboard?.writeText) {
      setCopyMessage('Clipboard access is unavailable in this browser.');
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(`${label} copied.`);
    } catch {
      setCopyMessage('Unable to copy to clipboard.');
    }
  };

  return (
    <Dialog open={open} onClose={handleDialogClose} fullWidth maxWidth="sm">
      <DialogTitle>Codex device auth</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField
            select
            label="Target"
            value={selectedTarget}
            onChange={handleTargetChange}
            size="small"
            fullWidth
            disabled={loading}
            inputProps={{ 'data-testid': 'codex-device-auth-target' }}
          >
            {options.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>

          {loading ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                Waiting for device auth…
              </Typography>
            </Stack>
          ) : null}

          {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}

          {result ? (
            <Stack spacing={1.5}>
              <Typography variant="subtitle2" fontWeight={600}>
                Verification details
              </Typography>

              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  label="Verification URL"
                  value={result.verificationUrl}
                  fullWidth
                  size="small"
                  inputProps={{ readOnly: true }}
                />
                <Button
                  variant="outlined"
                  onClick={() =>
                    void handleCopy(result.verificationUrl, 'Verification URL')
                  }
                  aria-label="Copy verification URL"
                >
                  Copy
                </Button>
              </Stack>

              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  label="User code"
                  value={result.userCode}
                  fullWidth
                  size="small"
                  inputProps={{ readOnly: true }}
                />
                <Button
                  variant="outlined"
                  onClick={() => void handleCopy(result.userCode, 'User code')}
                  aria-label="Copy user code"
                >
                  Copy
                </Button>
              </Stack>

              {result.expiresInSec !== undefined ? (
                <Typography variant="body2" color="text.secondary">
                  Expires in {result.expiresInSec} seconds.
                </Typography>
              ) : null}
            </Stack>
          ) : null}

          {copyMessage ? <Alert severity="info">{copyMessage}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Box sx={{ flex: 1 }} />
        <Button onClick={handleDialogClose}>Close</Button>
        <Button variant="contained" onClick={handleStart} disabled={loading}>
          Start device auth
        </Button>
      </DialogActions>
    </Dialog>
  );
}
