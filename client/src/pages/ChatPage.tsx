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
  Collapse,
  Button as MuiButton,
} from '@mui/material';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import useChatModel from '../hooks/useChatModel';
import useChatStream, {
  ChatMessage,
  ToolCitation,
  ToolCall,
} from '../hooks/useChatStream';

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
  const { messages, status, isStreaming, send, stop, reset } =
    useChatStream(selected);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastSentRef = useRef('');
  const [input, setInput] = useState('');
  const [thinkOpen, setThinkOpen] = useState<Record<string, boolean>>({});
  const [toolOpen, setToolOpen] = useState<Record<string, boolean>>({});
  const controlsDisabled = isLoading || isError || isEmpty || !selected;
  const isSending = isStreaming || status === 'sending';
  const showStop = isSending;

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
    lastSentRef.current = trimmed;
    void send(trimmed);
    setInput('');
  };

  const handleStop = () => {
    stop({ showStatusBubble: true });
    setInput(lastSentRef.current);
    inputRef.current?.focus();
  };

  const handleNewConversation = () => {
    stop();
    reset();
    setInput('');
    lastSentRef.current = '';
    inputRef.current?.focus();
    setThinkOpen({});
    setToolOpen({});
  };

  const toggleThink = (id: string) => {
    setThinkOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleTool = (id: string) => {
    setToolOpen((prev) => ({ ...prev, [id]: !prev[id] }));
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
          <Alert severity="info">
            No chat-capable models available from LM Studio.
          </Alert>
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
            {showStop && (
              <Button
                type="button"
                variant="outlined"
                color="warning"
                onClick={handleStop}
                data-testid="chat-stop"
              >
                Stop
              </Button>
            )}
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
              No chat-capable models available. Add a supported LLM in LM
              Studio, then retry.
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
                const isStatusBubble = message.kind === 'status';
                const isUser = message.role === 'user';
                const hasCitations = !!message.citations?.length;
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
                        data-testid="chat-bubble"
                        data-role={message.role}
                        data-kind={message.kind ?? 'normal'}
                        sx={{
                          p: 1.5,
                          bgcolor: isErrorBubble
                            ? 'error.light'
                            : isStatusBubble
                              ? 'info.light'
                              : isUser
                                ? 'primary.main'
                                : 'background.paper',
                          color: isErrorBubble
                            ? 'error.contrastText'
                            : isStatusBubble
                              ? 'info.dark'
                              : isUser
                                ? 'primary.contrastText'
                                : 'text.primary',
                          borderColor: isErrorBubble
                            ? 'error.main'
                            : isStatusBubble
                              ? 'info.main'
                              : undefined,
                        }}
                      >
                        <Typography variant="body2">
                          {message.content || ' '}
                        </Typography>
                        {!!message.tools?.length && (
                          <Stack spacing={0.75} mt={1} data-testid="tool-calls">
                            {message.tools.map((tool: ToolCall) => {
                              const isRequesting = tool.status === 'requesting';
                              const isError = tool.status === 'error';
                              const toggleKey = `${message.id}-${tool.id}`;
                              const isOpen = !!toolOpen[toggleKey];
                              const results =
                                tool.payload &&
                                typeof tool.payload === 'object' &&
                                'results' in
                                  (tool.payload as Record<string, unknown>) &&
                                Array.isArray(
                                  (tool.payload as { results?: unknown[] })
                                    .results,
                                )
                                  ? ((tool.payload as { results?: unknown[] })
                                      .results as unknown[])
                                  : [];

                              return (
                                <Box key={toggleKey} data-testid="tool-row">
                                  <Stack
                                    direction="row"
                                    alignItems="center"
                                    spacing={1}
                                    sx={{ mb: isRequesting ? 0 : 0.25 }}
                                  >
                                    {isRequesting ? (
                                      <CircularProgress
                                        size={14}
                                        data-testid="tool-spinner"
                                      />
                                    ) : (
                                      <Typography
                                        variant="caption"
                                        color={
                                          isError
                                            ? 'error.main'
                                            : 'success.main'
                                        }
                                      >
                                        {isError ? 'Error' : 'Complete'}
                                      </Typography>
                                    )}
                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                      sx={{ flex: 1 }}
                                      data-testid="tool-name"
                                    >
                                      {tool.name ?? 'Tool'}
                                    </Typography>
                                    {!isRequesting && (
                                      <MuiButton
                                        size="small"
                                        variant="text"
                                        onClick={() => toggleTool(toggleKey)}
                                        data-testid="tool-toggle"
                                        sx={{
                                          textTransform: 'none',
                                          minWidth: 0,
                                          p: 0,
                                        }}
                                      >
                                        {isOpen ? 'Hide' : 'Show'}
                                      </MuiButton>
                                    )}
                                  </Stack>
                                  {!isRequesting && (
                                    <Collapse
                                      in={isOpen}
                                      timeout="auto"
                                      unmountOnExit
                                    >
                                      <Stack
                                        spacing={0.75}
                                        mt={0.5}
                                        data-testid="tool-details"
                                      >
                                        <Typography
                                          variant="caption"
                                          color="text.secondary"
                                        >
                                          Status: {tool.status}
                                        </Typography>
                                        {tool.name === 'VectorSearch' &&
                                        results.length > 0 ? (
                                          <Stack
                                            spacing={1}
                                            data-testid="tool-vector-results"
                                          >
                                            {results.map((item, idx) => {
                                              const r = item as Record<
                                                string,
                                                unknown
                                              >;
                                              const repo =
                                                typeof r.repo === 'string'
                                                  ? r.repo
                                                  : undefined;
                                              const relPath =
                                                typeof r.relPath === 'string'
                                                  ? r.relPath
                                                  : undefined;
                                              const hostPath =
                                                typeof r.hostPath === 'string'
                                                  ? r.hostPath
                                                  : undefined;
                                              const chunk =
                                                typeof r.chunk === 'string'
                                                  ? r.chunk
                                                  : undefined;
                                              if (!repo || !relPath)
                                                return null;
                                              return (
                                                <Box
                                                  key={`${repo}-${relPath}-${idx}`}
                                                >
                                                  <Typography
                                                    variant="caption"
                                                    color="text.secondary"
                                                    data-testid="tool-result-path"
                                                    sx={{ display: 'block' }}
                                                  >
                                                    {repo}/{relPath}
                                                    {hostPath
                                                      ? ` (${hostPath})`
                                                      : ''}
                                                  </Typography>
                                                  {chunk && (
                                                    <Typography
                                                      variant="body2"
                                                      color="text.primary"
                                                      sx={{
                                                        whiteSpace: 'pre-wrap',
                                                      }}
                                                      data-testid="tool-result-chunk"
                                                    >
                                                      {chunk}
                                                    </Typography>
                                                  )}
                                                </Box>
                                              );
                                            })}
                                          </Stack>
                                        ) : tool.payload ? (
                                          <Typography
                                            variant="caption"
                                            color="text.secondary"
                                            sx={{ wordBreak: 'break-word' }}
                                            data-testid="tool-payload"
                                          >
                                            {JSON.stringify(tool.payload)}
                                          </Typography>
                                        ) : null}
                                      </Stack>
                                    </Collapse>
                                  )}
                                </Box>
                              );
                            })}
                          </Stack>
                        )}
                        {hasCitations && (
                          <Stack spacing={1} mt={1} data-testid="citations">
                            {message.citations?.map(
                              (citation: ToolCitation, idx) => {
                                const pathLabel = `${citation.repo}/${citation.relPath}`;
                                const hostSuffix = citation.hostPath
                                  ? ` (${citation.hostPath})`
                                  : '';
                                return (
                                  <Box
                                    key={`${citation.chunkId ?? idx}-${citation.relPath}`}
                                  >
                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                      title={citation.hostPath ?? pathLabel}
                                      sx={{
                                        display: 'block',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        maxWidth: '100%',
                                      }}
                                      data-testid="citation-path"
                                    >
                                      {pathLabel}
                                      {hostSuffix}
                                    </Typography>
                                    <Typography
                                      variant="body2"
                                      color="text.primary"
                                      sx={{ whiteSpace: 'pre-wrap' }}
                                      data-testid="citation-chunk"
                                    >
                                      {citation.chunk}
                                    </Typography>
                                  </Box>
                                );
                              },
                            )}
                          </Stack>
                        )}
                        {(message.thinkStreaming || message.think) && (
                          <Box mt={1}>
                            <Stack
                              direction="row"
                              alignItems="center"
                              gap={0.5}
                            >
                              {message.thinkStreaming && (
                                <CircularProgress
                                  size={12}
                                  color="inherit"
                                  data-testid="think-spinner"
                                />
                              )}
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                Thought process
                              </Typography>
                              <MuiButton
                                size="small"
                                variant="text"
                                onClick={() => toggleThink(message.id)}
                                data-testid="think-toggle"
                                aria-label="Toggle thought process"
                                aria-expanded={!!thinkOpen[message.id]}
                                sx={{
                                  textTransform: 'none',
                                  minWidth: 0,
                                  p: 0,
                                }}
                              >
                                {thinkOpen[message.id] ? 'Hide' : 'Show'}
                              </MuiButton>
                            </Stack>
                            <Collapse
                              in={!!thinkOpen[message.id]}
                              timeout="auto"
                              unmountOnExit
                            >
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                data-testid="think-content"
                                sx={{ whiteSpace: 'pre-wrap', mt: 0.5 }}
                              >
                                {message.think}
                              </Typography>
                            </Collapse>
                          </Box>
                        )}
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
