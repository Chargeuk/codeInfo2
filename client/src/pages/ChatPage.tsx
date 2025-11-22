import {
  Container,
  Alert,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useRef } from 'react';
import useChatModel from '../hooks/useChatModel';

export default function ChatPage() {
  const {
    models,
    selected,
    setSelected,
    errorMessage,
    isLoading,
    isError,
    isEmpty,
    refresh,
  } = useChatModel();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const controlsDisabled = isLoading || isError || isEmpty;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <Container maxWidth="lg" sx={{ pt: 3, pb: 6 }}>
      <Stack spacing={2}>
        {isLoading && (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">
              Loading models…
            </Typography>
          </Stack>
        )}
        {isError && (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={refresh}>
                Retry
              </Button>
            }
          >
            {errorMessage ?? 'Unable to load chat models.'}
          </Alert>
        )}
        {!isLoading && !isError && isEmpty && (
          <Alert severity="info">No models available from LM Studio.</Alert>
        )}
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems="stretch"
        >
          <FormControl sx={{ minWidth: 260 }} disabled={controlsDisabled}>
            <InputLabel id="chat-model-label">Model</InputLabel>
            <Select
              labelId="chat-model-label"
              id="chat-model-select"
              label="Model"
              value={selected ?? ''}
              onChange={(event) => setSelected(event.target.value)}
              displayEmpty
            >
              {models.map((model) => (
                <MenuItem key={model.key} value={model.key}>
                  {model.displayName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            inputRef={inputRef}
            fullWidth
            label="Message"
            placeholder="Type your prompt"
            disabled={controlsDisabled}
          />
        </Stack>
        <Paper variant="outlined" sx={{ minHeight: 320, p: 2 }}>
          {isLoading && (
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              justifyContent="center"
              sx={{ height: '100%' }}
            >
              <CircularProgress size={20} />
              <Typography color="text.secondary">Loading models…</Typography>
            </Stack>
          )}
          {isError && (
            <Typography color="error.main">
              {errorMessage ?? 'Failed to load chat models. Please retry.'}
            </Typography>
          )}
          {!isLoading && !isError && isEmpty && (
            <Typography color="text.secondary">
              No models available. Add a model in LM Studio, then retry.
            </Typography>
          )}
          {!isLoading && !isError && !isEmpty && (
            <Typography color="text.secondary">
              Transcript will appear here once chat streaming is added.
            </Typography>
          )}
        </Paper>
      </Stack>
    </Container>
  );
}
