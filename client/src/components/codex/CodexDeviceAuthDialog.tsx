import type {
  ProviderAuthProviderId,
  ProviderAuthResponse,
} from '@codeinfo2/common';
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
import { postProviderDeviceAuth } from '../../api/codex';
import { createLogger } from '../../logging/logger';

export type CodexDeviceAuthDialogProps = {
  open: boolean;
  onClose: () => void;
  source: 'chat' | 'agents';
  onSuccess?: (response: ProviderAuthResponse) => void;
};
const T15_SUCCESS_LOG =
  '[DEV-0000037][T15] event=shared_auth_dialog_flow_executed result=success';
const T15_ERROR_LOG =
  '[DEV-0000037][T15] event=shared_auth_dialog_flow_executed result=error';
const rawOutputUrlRegex = /https?:\/\/\S+/g;
const DIALOG_RENDER_LOG = 'story.0000051.task12.choose_auth_dialog_rendered';
const DIALOG_TITLE_ID = 'choose-authentication-title';
const DIALOG_DESCRIPTION_ID = 'choose-authentication-description';

function linkifyValue(value: string): ReactNode[] {
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

function getProviderLabel(provider: ProviderAuthProviderId) {
  return provider === 'copilot' ? 'GitHub Copilot' : 'OpenAI Codex';
}

function describeProviderAuthState(result: ProviderAuthResponse): {
  tone: 'success' | 'info' | 'warning' | 'error';
  message?: string;
} {
  const providerLabel = getProviderLabel(result.provider);
  switch (result.state) {
    case 'verification_ready':
      return { tone: 'info' };
    case 'completion_pending':
      return {
        tone: 'info',
        message:
          'Authentication is still pending. Finish the browser step, then refresh again if needed.',
      };
    case 'completed':
      return {
        tone: 'success',
        message: `${providerLabel} authentication completed.`,
      };
    case 'already_authenticated':
      return {
        tone: 'success',
        message: `${providerLabel} is already authenticated for this runtime.`,
      };
    case 'failed':
      return { tone: 'error', message: result.reason };
    case 'unavailable_before_start':
      return { tone: 'warning', message: result.reason };
  }
}

export default function CodexDeviceAuthDialog({
  open,
  onClose,
  source,
  onSuccess,
}: CodexDeviceAuthDialogProps) {
  const [loadingProvider, setLoadingProvider] =
    useState<ProviderAuthProviderId | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [result, setResult] = useState<ProviderAuthResponse | undefined>();
  const [visibleProvider, setVisibleProvider] = useState<
    ProviderAuthProviderId | 'chooser'
  >('chooser');
  const prevOpenRef = useRef(false);

  const log = useMemo(() => createLogger('codex-device-auth-dialog'), []);
  const loading = loadingProvider !== null;
  const describedResult = result
    ? describeProviderAuthState(result)
    : undefined;

  useEffect(() => {
    if (!open) {
      setLoadingProvider(null);
      setErrorMessage(undefined);
      setResult(undefined);
      setVisibleProvider('chooser');
      prevOpenRef.current = false;
      return;
    }

    if (!prevOpenRef.current) {
      log('info', 'DEV-0000031:T6:codex_device_auth_dialog_open');
      setLoadingProvider(null);
      setErrorMessage(undefined);
      setResult(undefined);
      setVisibleProvider('chooser');
    }

    prevOpenRef.current = true;
  }, [open, log]);

  useEffect(() => {
    if (!open) {
      return;
    }

    log('info', DIALOG_RENDER_LOG, {
      authStatus: errorMessage
        ? 'error'
        : loading
          ? 'loading'
          : (result?.state ?? 'idle'),
      source,
      visibleProviderBranch: visibleProvider,
    });
  }, [
    errorMessage,
    loading,
    log,
    open,
    result?.state,
    source,
    visibleProvider,
  ]);

  const handleStart = async (provider: ProviderAuthProviderId) => {
    setLoadingProvider(provider);
    setErrorMessage(undefined);
    setResult(undefined);
    setVisibleProvider(provider);

    try {
      const response = await postProviderDeviceAuth(provider);
      const described = describeProviderAuthState(response);

      if (described.tone === 'error' || described.tone === 'warning') {
        setErrorMessage(described.message ?? 'Device auth failed.');
        log('error', 'DEV-0000031:T6:codex_device_auth_dialog_error', {
          message: described.message ?? 'Device auth failed.',
          provider,
          source,
          state: response.state,
        });
        log('error', T15_ERROR_LOG, {
          message: described.message ?? 'Device auth failed.',
          source,
        });
        return;
      }

      setResult(response);
      log('info', 'DEV-0000031:T6:codex_device_auth_dialog_success', {
        source,
        state: response.state,
      });
      log('info', T15_SUCCESS_LOG, { source, state: response.state });
      if (
        response.state === 'completed' ||
        response.state === 'already_authenticated'
      ) {
        onSuccess?.(response);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Device auth failed.';
      setErrorMessage(message);
      log('error', 'DEV-0000031:T6:codex_device_auth_dialog_error', {
        message,
        source,
        provider,
      });
      log('error', T15_ERROR_LOG, { message, provider, source });
    } finally {
      setLoadingProvider(null);
    }
  };

  const handleDialogClose = () => {
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleDialogClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby={DIALOG_TITLE_ID}
      aria-describedby={DIALOG_DESCRIPTION_ID}
    >
      <DialogTitle id={DIALOG_TITLE_ID}>Choose Authentication</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography
            id={DIALOG_DESCRIPTION_ID}
            variant="body2"
            color="text.secondary"
          >
            Authenticate either provider from this shared dialog. Agent
            execution remains Codex-backed in this story.
          </Typography>

          <Stack spacing={1}>
            <Button
              variant="contained"
              onClick={() => void handleStart('codex')}
              disabled={loading}
              loading={loadingProvider === 'codex'}
              fullWidth
            >
              Codex Auth
            </Button>
            <Button
              variant="outlined"
              onClick={() => void handleStart('copilot')}
              disabled={loading}
              loading={loadingProvider === 'copilot'}
              fullWidth
            >
              Copilot Auth
            </Button>
          </Stack>

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
              {describedResult?.message ? (
                <Alert severity={describedResult.tone}>
                  {describedResult.message}
                </Alert>
              ) : null}

              <Typography variant="subtitle2" color="text.secondary">
                {getProviderLabel(result.provider)}
              </Typography>

              {'verificationUrl' in result && result.verificationUrl ? (
                <Stack spacing={0.5}>
                  <Typography variant="subtitle2" fontWeight={600}>
                    Verification URL
                  </Typography>
                  <Link
                    href={result.verificationUrl}
                    target="_blank"
                    rel="noreferrer"
                    underline="always"
                  >
                    {result.verificationUrl}
                  </Link>
                </Stack>
              ) : null}

              {'userCode' in result && result.userCode ? (
                <Stack spacing={0.5}>
                  <Typography variant="subtitle2" fontWeight={600}>
                    One-time code
                  </Typography>
                  <Typography
                    component="code"
                    sx={{ fontFamily: 'monospace', fontSize: '0.95rem' }}
                  >
                    {result.userCode}
                  </Typography>
                </Stack>
              ) : null}

              {'displayOutput' in result &&
              result.displayOutput &&
              result.state === 'completion_pending' ? (
                <>
                  <Typography variant="subtitle2" fontWeight={600}>
                    Status details
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
                      {linkifyValue(result.displayOutput)}
                    </Typography>
                  </Box>
                </>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Box sx={{ flex: 1 }} />
        <Button onClick={handleDialogClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
