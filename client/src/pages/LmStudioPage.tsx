import {
  Button,
  Container,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useEffect, useMemo, useRef, useState } from 'react';
import useLmStudioStatus from '../hooks/useLmStudioStatus';

const DEFAULT_LM_URL =
  (typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta)?.env?.VITE_LMSTUDIO_URL) ??
  'http://host.docker.internal:1234';

function humanSize(bytes?: number | null) {
  if (!bytes) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** idx;
  return `${value.toFixed(1)} ${units[idx]}`;
}

export default function LmStudioPage() {
  const theme = useTheme();
  const isSmall = useMediaQuery(theme.breakpoints.down('sm'));
  const inputRef = useRef<HTMLInputElement>(null);
  const { baseUrl, state, isLoading, isError, isEmpty, refresh } =
    useLmStudioStatus();
  const [input, setInput] = useState(baseUrl);

  useEffect(() => {
    if (isError) {
      inputRef.current?.focus();
    }
  }, [isError]);

  const statusText = useMemo(() => {
    if (state.status === 'loading') return 'Checking…';
    if (state.status === 'error')
      return state.error ?? 'Unable to reach LM Studio';
    if (state.status === 'success')
      return `Connected to ${state.data.baseUrl} (${state.data.models.length} model${
        state.data.models.length === 1 ? '' : 's'
      })`;
    return 'Idle';
  }, [state]);

  const handleCheck = () => refresh(input);
  const handleReset = () => {
    setInput(DEFAULT_LM_URL);
    refresh(DEFAULT_LM_URL);
  };

  const models = state.status === 'success' ? state.data.models : [];

  return (
    <Container maxWidth="md" sx={{ mt: 4, pb: 4 }}>
      <Stack spacing={2}>
        <Typography variant="h4">LM Studio</Typography>
        <TextField
          label="LM Studio base URL"
          value={input}
          inputRef={inputRef}
          onChange={(e) => setInput(e.target.value)}
          helperText={`Default: ${DEFAULT_LM_URL}`}
          aria-describedby="lmstudio-status"
          fullWidth
        />
        <Stack
          direction={isSmall ? 'column' : 'row'}
          spacing={1}
          alignItems={isSmall ? 'stretch' : 'center'}
        >
          <Button
            variant="contained"
            onClick={handleCheck}
            disabled={isLoading}
          >
            Check status
          </Button>
          <Button variant="outlined" onClick={handleReset} disabled={isLoading}>
            Reset to default
          </Button>
          <Button variant="text" onClick={() => refresh()} disabled={isLoading}>
            Refresh models
          </Button>
        </Stack>
        <Typography
          id="lmstudio-status"
          aria-live="polite"
          color={isError ? 'error' : 'text.primary'}
          role="status"
        >
          {statusText}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Using base URL:{' '}
          {state.status === 'success' ? state.data.baseUrl : baseUrl}
        </Typography>
        {isEmpty && <Typography>No models reported by LM Studio.</Typography>}
        {models.length > 0 &&
          (isSmall ? (
            <Stack spacing={1} role="list">
              {models.map((m) => (
                <Paper key={m.modelKey} role="listitem" sx={{ p: 2 }}>
                  <Typography variant="subtitle1" noWrap title={m.displayName}>
                    {m.displayName}
                  </Typography>
                  <Typography variant="body2" noWrap title={m.modelKey}>
                    {m.modelKey}
                  </Typography>
                  <Typography variant="body2">
                    {m.type}
                    {m.format ? ` / ${m.format}` : ''}
                  </Typography>
                  <Typography variant="body2">
                    {m.architecture ?? '-'}
                  </Typography>
                  <Typography variant="body2">
                    Size: {humanSize(m.sizeBytes)}
                  </Typography>
                </Paper>
              ))}
            </Stack>
          ) : (
            <Paper>
              <Table size="small" aria-label="LM Studio models">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Key</TableCell>
                    <TableCell>Type/Format</TableCell>
                    <TableCell>Architecture</TableCell>
                    <TableCell align="right">Size</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {models.map((m) => (
                    <TableRow key={m.modelKey}>
                      <TableCell>{m.displayName}</TableCell>
                      <TableCell>
                        <Typography noWrap title={m.modelKey}>
                          {m.modelKey}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {m.type}
                        {m.format ? ` / ${m.format}` : ''}
                      </TableCell>
                      <TableCell>{m.architecture ?? '-'}</TableCell>
                      <TableCell align="right">
                        {humanSize(m.sizeBytes)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          ))}
      </Stack>
    </Container>
  );
}
