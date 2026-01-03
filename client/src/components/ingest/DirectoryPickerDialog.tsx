import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createLogger } from '../../logging/logger';
import {
  fetchIngestDirs,
  IngestDirsError,
  IngestDirsResponse,
  IngestDirsSuccess,
} from './ingestDirsApi';

export type DirectoryPickerDialogProps = {
  open: boolean;
  path?: string;
  onClose: () => void;
  onPick: (path: string) => void;
};

function joinPath(parent: string, child: string) {
  const trimmedParent = parent.replace(/\/+$/, '');
  return `${trimmedParent}/${child}`;
}

function parentPath(path: string) {
  const trimmed = path.replace(/\/+$/, '');
  const parts = trimmed.split('/').filter(Boolean);
  if (parts.length <= 1) return '/';
  return `/${parts.slice(0, -1).join('/')}`;
}

export default function DirectoryPickerDialog({
  open,
  path,
  onClose,
  onPick,
}: DirectoryPickerDialogProps) {
  const [payload, setPayload] = useState<IngestDirsSuccess | undefined>();
  const [error, setError] = useState<IngestDirsError | undefined>();
  const [loading, setLoading] = useState(false);

  const prevOpenRef = useRef(false);
  const log = useMemo(() => createLogger('client'), []);

  const currentPath = payload?.path;
  const basePath = payload?.base;
  const canGoUp = Boolean(basePath && currentPath && currentPath !== basePath);

  const startPath = path?.trim() || undefined;

  const load = useCallback(
    async (nextPath?: string) => {
      setLoading(true);
      setError(undefined);

      try {
        const res: IngestDirsResponse = await fetchIngestDirs({
          path: nextPath,
        });
        if ('status' in res && res.status === 'error') {
          setPayload(undefined);
          setError(res);
          log('error', '0000020 ingest dirpicker error', {
            path: nextPath,
            code: res.code,
          });
          return;
        }
        setPayload(res);
      } catch {
        setPayload(undefined);
        setError({ status: 'error', code: 'NOT_FOUND' });
      } finally {
        setLoading(false);
      }
    },
    [log],
  );

  useEffect(() => {
    if (!open) {
      setPayload(undefined);
      setError(undefined);
      setLoading(false);
      prevOpenRef.current = false;
      return;
    }

    if (!prevOpenRef.current) {
      log('info', '0000020 ingest dirpicker opened', { path: startPath });
    }

    prevOpenRef.current = true;
    void load(startPath);
  }, [open, startPath, log, load]);

  const navigateTo = (to: string) => {
    const from = currentPath;
    log('info', '0000020 ingest dirpicker navigated', { from, to });
    void load(to);
  };

  const handlePick = () => {
    if (!currentPath) return;
    log('info', '0000020 ingest dirpicker picked', { path: currentPath });
    onPick(currentPath);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Choose folder…</DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack spacing={0.25}>
            <Typography variant="body2" color="text.secondary">
              Base:{' '}
              <Box component="span" sx={{ fontFamily: 'monospace' }}>
                {basePath ?? '—'}
              </Box>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Path:{' '}
              <Box component="span" sx={{ fontFamily: 'monospace' }}>
                {currentPath ?? startPath ?? '—'}
              </Box>
            </Typography>
          </Stack>

          {loading ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                Loading directories…
              </Typography>
            </Stack>
          ) : null}

          {error ? (
            <Alert severity="error">
              Unable to list directories ({error.code}).
            </Alert>
          ) : null}

          {payload ? (
            <List
              dense
              sx={{
                border: (theme) => `1px solid ${theme.palette.divider}`,
                borderRadius: 1,
              }}
            >
              {payload.dirs.length === 0 ? (
                <Box sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    No child directories.
                  </Typography>
                </Box>
              ) : (
                payload.dirs.map((dir) => (
                  <ListItemButton
                    key={dir}
                    aria-label={dir}
                    onClick={() => navigateTo(joinPath(payload.path, dir))}
                  >
                    <ListItemText
                      primary={dir}
                      secondary={joinPath(payload.path, dir)}
                      secondaryTypographyProps={{
                        sx: { fontFamily: 'monospace' },
                      }}
                    />
                  </ListItemButton>
                ))
              )}
            </List>
          ) : null}
        </Stack>
      </DialogContent>

      <DialogActions>
        {canGoUp && currentPath ? (
          <Button
            onClick={() => navigateTo(parentPath(currentPath))}
            disabled={loading}
          >
            Up
          </Button>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Close</Button>
        <Button
          onClick={handlePick}
          variant="contained"
          disabled={!payload || loading}
        >
          Use this folder
        </Button>
      </DialogActions>
    </Dialog>
  );
}
