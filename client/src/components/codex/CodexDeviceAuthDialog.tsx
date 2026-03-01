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
  Stack,
  Typography,
} from '@mui/material';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { CodexDeviceAuthResponse, postCodexDeviceAuth } from '../../api/codex';
import { createLogger } from '../../logging/logger';

export type CodexDeviceAuthDialogProps = {
  open: boolean;
  onClose: () => void;
  source: 'chat' | 'agents';
  onSuccess?: (response: CodexDeviceAuthResponse) => void;
};
const rawOutputUrlRegex = /https?:\/\/\S+/g;
const T15_SUCCESS_LOG =
  '[DEV-0000037][T15] event=shared_auth_dialog_flow_executed result=success';
const T15_ERROR_LOG =
  '[DEV-0000037][T15] event=shared_auth_dialog_flow_executed result=error';

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
  source,
  onSuccess,
}: CodexDeviceAuthDialogProps) {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [result, setResult] = useState<CodexDeviceAuthResponse | undefined>();
  const prevOpenRef = useRef(false);

  const log = useMemo(() => createLogger('codex-device-auth-dialog'), []);

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
      setLoading(false);
      setErrorMessage(undefined);
      setResult(undefined);
    }

    prevOpenRef.current = true;
  }, [open, log]);

  const handleStart = async () => {
    setLoading(true);
    setErrorMessage(undefined);
    setResult(undefined);

    try {
      const response = await postCodexDeviceAuth({});
      setResult(response);
      log('info', 'DEV-0000031:T6:codex_device_auth_dialog_success', {
        source,
      });
      log('info', T15_SUCCESS_LOG, { source });
      onSuccess?.(response);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Device auth failed.';
      setErrorMessage(message);
      log('error', 'DEV-0000031:T6:codex_device_auth_dialog_error', {
        message,
        source,
      });
      log('error', T15_ERROR_LOG, { message, source });
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
