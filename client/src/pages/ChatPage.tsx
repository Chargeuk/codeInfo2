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
  Box,
} from '@mui/material';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import useChatModel from '../hooks/useChatModel';
import useChatStream, { ChatMessage } from '../hooks/useChatStream';

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
  const { messages, status, send, stop, reset } = useChatStream(selected);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [input, setInput] = useState('');
  const controlsDisabled = isLoading || isError || isEmpty || !selected;
  const isSending = status === 'sending';

  const orderedMessages = useMemo<ChatMessage[]>(
    () => [...messages].reverse(),
    [messages],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(
    () => () => {
      stop();
    },
    [stop],
  );

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || controlsDisabled) return;
    void send(trimmed);
    setInput('');
  };

  const handleNewConversation = () => {
    stop();
    reset();
    setInput('');
    inputRef.current?.focus();
  };

  return (
    <Container maxWidth="lg" sx={{ pt: 3, pb: 6 }}>
      <Stack spacing={2}>
        {isLoading && (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">
              Loading models...
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
        <form onSubmit={handleSubmit}>
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
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={controlsDisabled}
              inputProps={{ 'data-testid': 'chat-input' }}
            />
            <Button
              type="submit"
              variant="contained"
              data-testid="chat-send"
              disabled={controlsDisabled || isSending || !input.trim()}
            >
              Send
            </Button>
            <Button
              type="button"
              variant="outlined"
              color="secondary"
              onClick={handleNewConversation}
              disabled={isLoading}
            >
              New conversation
            </Button>
          </Stack>
        </form>
        {isSending && (
          <Typography variant="body2" color="text.secondary">
            Responding...
          </Typography>
        )}
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
              <Typography color="text.secondary">Loading models...</Typography>
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
            <Stack spacing={1} sx={{ minHeight: 280 }}>
              {orderedMessages.length === 0 && (
                <Typography color="text.secondary">
                  Transcript will appear here once you send a message.
                </Typography>
              )}
              {orderedMessages.map((message) => {
                const alignSelf =
                  message.role === 'user' ? 'flex-end' : 'flex-start';
                const isErrorBubble = message.kind === 'error';
                return (
                  <Stack
                    key={message.id}
                    alignItems={
                      alignSelf === 'flex-end' ? 'flex-end' : 'flex-start'
                    }
                  >
                    <Box
                      sx={{
                        maxWidth: { xs: '100%', sm: '80%' },
                        alignSelf,
                      }}
                    >
                      <Paper
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          bgcolor: isErrorBubble
                            ? 'error.light'
                            : message.role === 'user'
                              ? 'primary.main'
                              : 'background.paper',
                          color: isErrorBubble
                            ? 'error.contrastText'
                            : message.role === 'user'
                              ? 'primary.contrastText'
                              : 'text.primary',
                          borderColor: isErrorBubble ? 'error.main' : undefined,
                        }}
                      >
                        <Typography variant="body2">
                          {message.content || ' '}
                        </Typography>
                      </Paper>
                    </Box>
                  </Stack>
                );
              })}
            </Stack>
          )}
        </Paper>
      </Stack>
    </Container>
  );
}
