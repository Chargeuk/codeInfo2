import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  type ChangeEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
const rawOutputUrlRegex = /https?:\/\/\S+/g;

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

function linkifyRawOutput(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(rawOutputUrlRegex)) {
    const startIndex = match.index ?? 0;
    if (startIndex > lastIndex) {
      nodes.push(value.slice(lastIndex, startIndex));
    }

    const url = match[0];
    nodes.push(
      <Link
        key={`${startIndex}-${url}`}
        href={url}
        target="_blank"
        rel="noreferrer"
        underline="always"
      >
        {url}
      </Link>,
    );
    lastIndex = startIndex + url.length;
  }

  if (lastIndex < value.length) {
    nodes.push(value.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [value];
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
      prevOpenRef.current = false;
      return;
    }

    if (!prevOpenRef.current) {
      log('info', 'DEV-0000031:T6:codex_device_auth_dialog_open');
      setSelectedTarget(resolveTargetValue(defaultTarget, agents));
      setLoading(false);
      setErrorMessage(undefined);
      setResult(undefined);
    }

    prevOpenRef.current = true;
  }, [open, defaultTarget, agents, log]);

  const handleTargetChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectedTarget(event.target.value);
    setErrorMessage(undefined);
    setResult(undefined);
  };

  const handleStart = async () => {
    setLoading(true);
    setErrorMessage(undefined);
    setResult(undefined);

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
                Device auth output
              </Typography>
              <Box
                sx={{
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                  p: 1.5,
                }}
              >
                <Typography
                  component="pre"
                  variant="body2"
                  sx={{
                    fontFamily: 'monospace',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    m: 0,
                  }}
                >
                  {linkifyRawOutput(result.rawOutput)}
                </Typography>
              </Box>
            </Stack>
          ) : null}
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
