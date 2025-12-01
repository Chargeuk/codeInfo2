import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
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
  Chip,
  Button as MuiButton,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from '../components/Markdown';
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
  const [toolErrorOpen, setToolErrorOpen] = useState<Record<string, boolean>>(
    {},
  );
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

  const toggleToolError = (id: string) => {
    setToolErrorOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  type RepoEntry = {
    id: string;
    description?: string | null;
    containerPath?: string;
    hostPath?: string;
    hostPathWarning?: string;
    lastIngestAt?: string | null;
    modelId?: string;
    counts?: { files?: number; chunks?: number; embedded?: number };
    lastError?: string | null;
  };

  type VectorFile = {
    hostPath: string;
    highestMatch: number | null;
    chunkCount: number;
    lineCount: number | null;
    hostPathWarning?: string;
    repo?: string;
    modelId?: string;
  };

  const renderParamsAccordion = (params: unknown, accordionId: string) => (
    <Accordion
      defaultExpanded={false}
      disableGutters
      data-testid="tool-params-accordion"
      id={`params-${accordionId}`}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon fontSize="small" />}
        aria-controls={`params-${accordionId}-content`}
      >
        <Typography variant="body2" fontWeight={600}>
          Parameters
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Box
          component="pre"
          sx={{
            bgcolor: 'grey.100',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            p: 1,
            overflowX: 'auto',
            fontSize: '0.8rem',
            lineHeight: 1.4,
          }}
        >
          {JSON.stringify(params ?? {}, null, 2)}
        </Box>
      </AccordionDetails>
    </Accordion>
  );

  const renderRepoList = (repos: RepoEntry[]) => (
    <Stack spacing={1} data-testid="tool-repo-list">
      {repos.map((repo) => (
        <Accordion
          key={repo.id}
          disableGutters
          data-testid="tool-repo-item"
          sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
            <Typography variant="body2" fontWeight={600}>
              {repo.id}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={0.5}>
              {repo.description && (
                <Typography variant="body2" color="text.secondary">
                  {repo.description}
                </Typography>
              )}
              {repo.hostPath && (
                <Typography variant="caption" color="text.secondary">
                  Host path: {repo.hostPath}
                </Typography>
              )}
              {repo.containerPath && (
                <Typography variant="caption" color="text.secondary">
                  Container path: {repo.containerPath}
                </Typography>
              )}
              {repo.hostPathWarning && (
                <Typography variant="caption" color="warning.main">
                  Warning: {repo.hostPathWarning}
                </Typography>
              )}
              {repo.counts && (
                <Typography variant="caption" color="text.secondary">
                  Files: {repo.counts.files ?? 0} · Chunks:{' '}
                  {repo.counts.chunks ?? 0} · Embedded:{' '}
                  {repo.counts.embedded ?? 0}
                </Typography>
              )}
              {typeof repo.lastIngestAt === 'string' && repo.lastIngestAt && (
                <Typography variant="caption" color="text.secondary">
                  Last ingest: {repo.lastIngestAt}
                </Typography>
              )}
              {repo.modelId && (
                <Typography variant="caption" color="text.secondary">
                  Model: {repo.modelId}
                </Typography>
              )}
              {repo.lastError && (
                <Typography variant="caption" color="error.main">
                  Last error: {repo.lastError}
                </Typography>
              )}
            </Stack>
          </AccordionDetails>
        </Accordion>
      ))}
    </Stack>
  );

  const renderVectorFiles = (files: VectorFile[]) => {
    const sorted = [...files].sort((a, b) =>
      a.hostPath.localeCompare(b.hostPath),
    );
    return (
      <Stack spacing={1} data-testid="tool-file-list">
        {sorted.map((file) => {
          const summaryParts = [
            file.hostPath,
            `match ${file.highestMatch === null ? '—' : file.highestMatch.toFixed(2)}`,
            `chunks ${file.chunkCount}`,
            `lines ${file.lineCount === null ? '—' : file.lineCount}`,
          ];
          return (
            <Accordion
              key={file.hostPath}
              disableGutters
              data-testid="tool-file-item"
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreIcon fontSize="small" />}
              >
                <Typography
                  variant="body2"
                  fontWeight={600}
                  sx={{ wordBreak: 'break-all' }}
                >
                  {summaryParts.join(' · ')}
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    Highest match:{' '}
                    {file.highestMatch === null
                      ? '—'
                      : file.highestMatch.toFixed(3)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Chunk count: {file.chunkCount}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Total lines:{' '}
                    {file.lineCount === null ? '—' : file.lineCount}
                  </Typography>
                  {file.repo && (
                    <Typography variant="caption" color="text.secondary">
                      Repo: {file.repo}
                    </Typography>
                  )}
                  {file.modelId && (
                    <Typography variant="caption" color="text.secondary">
                      Model: {file.modelId}
                    </Typography>
                  )}
                  {file.hostPathWarning && (
                    <Typography variant="caption" color="warning.main">
                      Warning: {file.hostPathWarning}
                    </Typography>
                  )}
                </Stack>
              </AccordionDetails>
            </Accordion>
          );
        })}
      </Stack>
    );
  };

  const renderToolContent = (tool: ToolCall, toggleKey: string) => {
    const payload = (tool.payload ?? {}) as Record<string, unknown>;
    const repos = Array.isArray((payload as { repos?: unknown }).repos)
      ? ((payload as { repos: RepoEntry[] }).repos as RepoEntry[])
      : [];

    const files = Array.isArray((payload as { files?: unknown }).files)
      ? ((payload as { files: VectorFile[] }).files as VectorFile[])
      : [];

    const trimmedError = tool.errorTrimmed ?? null;
    const fullError = tool.errorFull;

    const hasVectorFiles = tool.name === 'VectorSearch' && files.length > 0;
    const hasRepos =
      tool.name === 'ListIngestedRepositories' && repos.length > 0;

    return (
      <Stack spacing={1} mt={0.5} data-testid="tool-details">
        <Typography variant="caption" color="text.secondary">
          Status: {tool.status}
        </Typography>
        {trimmedError && (
          <Stack spacing={0.5}>
            <Typography
              variant="body2"
              color="error.main"
              data-testid="tool-error-trimmed"
            >
              {trimmedError.code ? `${trimmedError.code}: ` : ''}
              {trimmedError.message ?? 'Error'}
            </Typography>
            {fullError && (
              <Box>
                <MuiButton
                  size="small"
                  variant="text"
                  onClick={() => toggleToolError(toggleKey)}
                  data-testid="tool-error-toggle"
                  aria-expanded={!!toolErrorOpen[toggleKey]}
                  sx={{ textTransform: 'none', minWidth: 0, p: 0 }}
                >
                  {toolErrorOpen[toggleKey]
                    ? 'Hide full error'
                    : 'Show full error'}
                </MuiButton>
                <Collapse
                  in={!!toolErrorOpen[toggleKey]}
                  timeout="auto"
                  unmountOnExit
                >
                  <Box
                    component="pre"
                    mt={0.5}
                    px={1}
                    py={0.5}
                    data-testid="tool-error-full"
                    sx={{
                      bgcolor: 'grey.100',
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      fontSize: '0.8rem',
                      overflowX: 'auto',
                    }}
                  >
                    {JSON.stringify(fullError, null, 2)}
                  </Box>
                </Collapse>
              </Box>
            )}
          </Stack>
        )}

        {renderParamsAccordion(tool.parameters, toggleKey)}

        {hasRepos && renderRepoList(repos)}
        {hasVectorFiles && renderVectorFiles(files)}

        {!hasRepos && !hasVectorFiles && tool.payload && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ wordBreak: 'break-word' }}
            data-testid="tool-payload"
          >
            {JSON.stringify(tool.payload)}
          </Typography>
        )}
      </Stack>
    );
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
                const segments = message.segments?.length
                  ? message.segments
                  : ([
                      {
                        id: `${message.id}-text`,
                        kind: 'text' as const,
                        content: message.content ?? '',
                      },
                      ...(message.tools?.map((tool) => ({
                        id: `${message.id}-${tool.id}`,
                        kind: 'tool' as const,
                        tool,
                      })) ?? []),
                    ] as const);
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
                        <Stack spacing={1}>
                          {message.role === 'assistant' &&
                            message.streamStatus && (
                              <Chip
                                size="small"
                                variant="outlined"
                                color={
                                  message.streamStatus === 'complete'
                                    ? 'success'
                                    : message.streamStatus === 'failed'
                                      ? 'error'
                                      : 'default'
                                }
                                icon={
                                  message.streamStatus === 'complete' ? (
                                    <CheckCircleOutlineIcon fontSize="small" />
                                  ) : message.streamStatus === 'failed' ? (
                                    <ErrorOutlineIcon fontSize="small" />
                                  ) : (
                                    <CircularProgress size={14} />
                                  )
                                }
                                label={
                                  message.streamStatus === 'complete'
                                    ? 'Complete'
                                    : message.streamStatus === 'failed'
                                      ? 'Failed'
                                      : 'Processing'
                                }
                                data-testid="status-chip"
                                sx={{ alignSelf: 'flex-start' }}
                              />
                            )}
                          {segments.map((segment) => {
                            if (segment.kind === 'text') {
                              if (message.role === 'assistant') {
                                return (
                                  <Markdown
                                    key={segment.id}
                                    content={segment.content ?? ''}
                                    data-testid="assistant-markdown"
                                  />
                                );
                              }
                              return (
                                <Typography
                                  key={segment.id}
                                  variant="body2"
                                  data-testid="user-text"
                                >
                                  {segment.content || ' '}
                                </Typography>
                              );
                            }

                            const tool = segment.tool;
                            const isRequesting = tool.status === 'requesting';
                            const isError = tool.status === 'error';
                            const toggleKey = `${message.id}-${tool.id}`;
                            const isOpen = !!toolOpen[toggleKey];
                            const statusLabel =
                              tool.status === 'error'
                                ? 'Failed'
                                : tool.status === 'done'
                                  ? 'Success'
                                  : 'Running';

                            return (
                              <Box key={segment.id} data-testid="tool-row">
                                <Stack
                                  direction="row"
                                  alignItems="center"
                                  spacing={1}
                                  sx={{ mb: isRequesting ? 0 : 0.25 }}
                                  data-testid="tool-call-summary"
                                >
                                  {isRequesting ? (
                                    <HourglassTopIcon
                                      fontSize="small"
                                      color="action"
                                      data-testid="tool-spinner"
                                    />
                                  ) : isError ? (
                                    <ErrorOutlineIcon
                                      fontSize="small"
                                      color="error"
                                      aria-label="Tool failed"
                                    />
                                  ) : (
                                    <CheckCircleOutlineIcon
                                      fontSize="small"
                                      color="success"
                                      aria-label="Tool succeeded"
                                    />
                                  )}
                                  <Typography
                                    variant="caption"
                                    color="text.primary"
                                    sx={{ flex: 1 }}
                                    data-testid="tool-name"
                                  >
                                    {(tool.name ?? 'Tool') +
                                      ' · ' +
                                      statusLabel}
                                  </Typography>
                                  <MuiButton
                                    size="small"
                                    variant="text"
                                    onClick={() => toggleTool(toggleKey)}
                                    disabled={isRequesting}
                                    data-testid="tool-toggle"
                                    aria-expanded={isOpen}
                                    aria-controls={`tool-${toggleKey}-details`}
                                    sx={{
                                      textTransform: 'none',
                                      minWidth: 0,
                                      p: 0,
                                    }}
                                  >
                                    {isOpen ? 'Hide details' : 'Show details'}
                                  </MuiButton>
                                </Stack>
                                <Collapse
                                  in={isOpen}
                                  timeout="auto"
                                  unmountOnExit
                                  id={`tool-${toggleKey}-details`}
                                >
                                  {renderToolContent(tool, toggleKey)}
                                </Collapse>
                              </Box>
                            );
                          })}
                          {message.role === 'assistant' && message.thinking && (
                            <Stack
                              direction="row"
                              spacing={1}
                              alignItems="center"
                              data-testid="thinking-placeholder"
                            >
                              <CircularProgress size={16} />
                              <Typography
                                variant="body2"
                                color="text.secondary"
                              >
                                Thinking…
                              </Typography>
                            </Stack>
                          )}
                        </Stack>
                        {hasCitations && (
                          <Accordion
                            disableGutters
                            elevation={0}
                            defaultExpanded={false}
                            sx={{
                              border: '1px solid',
                              borderColor: 'divider',
                              borderRadius: 1,
                              bgcolor: 'grey.50',
                              mt: 1,
                            }}
                            data-testid="citations-accordion"
                          >
                            <AccordionSummary
                              expandIcon={<ExpandMoreIcon fontSize="small" />}
                              aria-controls="citations-panel"
                              id="citations-summary"
                              data-testid="citations-toggle"
                            >
                              <Typography variant="body2" fontWeight={600}>
                                Citations ({message.citations?.length ?? 0})
                              </Typography>
                            </AccordionSummary>
                            <AccordionDetails id="citations-panel">
                              <Stack spacing={1} data-testid="citations">
                                {message.citations?.map(
                                  (citation: ToolCitation, idx) => {
                                    const pathLabel = `${citation.repo}/${citation.relPath}`;
                                    const hostSuffix = citation.hostPath
                                      ? ` (${citation.hostPath})`
                                      : '';
                                    return (
                                      <Box
                                        key={`${citation.chunkId ?? idx}-${citation.relPath}`}
                                        sx={{
                                          border: '1px solid',
                                          borderColor: 'divider',
                                          borderRadius: 1,
                                          p: 1,
                                          bgcolor: 'background.paper',
                                        }}
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
                            </AccordionDetails>
                          </Accordion>
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
                              <Box mt={0.5} color="text.secondary">
                                <Markdown
                                  content={message.think ?? ''}
                                  data-testid="think-content"
                                />
                              </Box>
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
