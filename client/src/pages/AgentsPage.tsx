import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
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
import type { SelectChangeEvent } from '@mui/material/Select';
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  listAgentCommands,
  listAgents,
  runAgentInstruction,
} from '../api/agents';
import Markdown from '../components/Markdown';
import ConversationList from '../components/chat/ConversationList';
import type { ChatMessage, ToolCall } from '../hooks/useChatStream';
import useConversationTurns, {
  StoredTurn,
} from '../hooks/useConversationTurns';
import useConversations from '../hooks/useConversations';
import usePersistenceStatus from '../hooks/usePersistenceStatus';

export default function AgentsPage() {
  const [agents, setAgents] = useState<
    Array<{
      name: string;
      description?: string;
      disabled?: boolean;
      warnings?: string[];
    }>
  >([]);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [agentsLoading, setAgentsLoading] = useState(true);

  const [selectedAgentName, setSelectedAgentName] = useState<string>('');
  const [activeConversationId, setActiveConversationId] = useState<
    string | undefined
  >(undefined);

  const [commands, setCommands] = useState<
    Array<{ name: string; description: string; disabled: boolean }>
  >([]);
  const [commandsError, setCommandsError] = useState<string | null>(null);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [selectedCommandName, setSelectedCommandName] = useState('');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const orderedMessages = useMemo<ChatMessage[]>(
    () => [...messages].reverse(),
    [messages],
  );

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [workingFolder, setWorkingFolder] = useState('');
  const [input, setInput] = useState('');
  const lastSentRef = useRef('');

  const [thinkOpen, setThinkOpen] = useState<Record<string, boolean>>({});
  const [toolOpen, setToolOpen] = useState<Record<string, boolean>>({});
  const [toolErrorOpen, setToolErrorOpen] = useState<Record<string, boolean>>(
    {},
  );

  const runControllerRef = useRef<AbortController | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const prevScrollHeightRef = useRef<number>(0);

  const { mongoConnected, isLoading: persistenceLoading } =
    usePersistenceStatus();
  const persistenceUnavailable = mongoConnected === false;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAgentsLoading(true);
    setAgentsError(null);
    void listAgents()
      .then((result) => {
        if (cancelled) return;
        setAgents(result.agents ?? []);
        setSelectedAgentName(
          (prev) =>
            prev || (result.agents.length > 0 ? result.agents[0].name : ''),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setAgentsError((err as Error).message);
      })
      .finally(() => {
        if (cancelled) return;
        setAgentsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveAgentName = selectedAgentName || '__none__';

  useEffect(() => {
    let cancelled = false;
    if (!selectedAgentName) {
      setCommands([]);
      setCommandsError(null);
      setCommandsLoading(false);
      setSelectedCommandName('');
      return;
    }

    setCommandsLoading(true);
    setCommandsError(null);
    void listAgentCommands(selectedAgentName)
      .then((result) => {
        if (cancelled) return;
        const nextCommands = result.commands ?? [];
        setCommands(nextCommands);
        setSelectedCommandName((prev) =>
          nextCommands.some((cmd) => cmd.name === prev && !cmd.disabled)
            ? prev
            : '',
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setCommandsError((err as Error).message);
        setCommands([]);
        setSelectedCommandName('');
      })
      .finally(() => {
        if (cancelled) return;
        setCommandsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAgentName]);

  const selectedCommand = useMemo(
    () => commands.find((cmd) => cmd.name === selectedCommandName),
    [commands, selectedCommandName],
  );

  const selectedCommandDescription = useMemo(() => {
    if (!selectedCommandName || !selectedCommand) {
      return 'Select a command to see its description.';
    }
    if (selectedCommand.disabled) return 'Invalid command file.';
    const description = selectedCommand.description.trim();
    return description || 'No description provided.';
  }, [selectedCommand, selectedCommandName]);

  const {
    conversations,
    includeArchived,
    setIncludeArchived,
    isLoading: conversationsLoading,
    isError: conversationsError,
    error: conversationsErrorMessage,
    hasMore: conversationsHasMore,
    loadMore: loadMoreConversations,
    refresh: refreshConversations,
  } = useConversations({ agentName: effectiveAgentName });

  const knownConversationIds = useMemo(
    () => new Set(conversations.map((c) => c.conversationId)),
    [conversations],
  );

  const shouldLoadTurns = Boolean(
    activeConversationId &&
      !persistenceUnavailable &&
      knownConversationIds.has(activeConversationId),
  );

  const {
    lastPage,
    lastMode,
    isLoading: turnsLoading,
    isError: turnsError,
    error: turnsErrorMessage,
    hasMore: turnsHasMore,
    loadOlder,
    reset: resetTurns,
  } = useConversationTurns(shouldLoadTurns ? activeConversationId : undefined);

  const stop = useCallback(() => {
    runControllerRef.current?.abort();
    runControllerRef.current = null;
    setIsRunning(false);
  }, []);

  const resetConversation = useCallback(() => {
    stop();
    resetTurns();
    setActiveConversationId(undefined);
    setMessages([]);
    setWorkingFolder('');
    setInput('');
    lastSentRef.current = '';
    setThinkOpen({});
    setToolOpen({});
    setToolErrorOpen({});
    void refreshConversations();
  }, [refreshConversations, resetTurns, stop]);

  const handleAgentChange = useCallback(
    (event: SelectChangeEvent<string>) => {
      const next = event.target.value;
      if (next === selectedAgentName) return;
      setSelectedAgentName(next);
      setSelectedCommandName('');
      resetConversation();
    },
    [resetConversation, selectedAgentName],
  );

  const handleCommandChange = useCallback(
    (event: SelectChangeEvent<string>) => {
      setSelectedCommandName(event.target.value);
    },
    [],
  );

  const toggleThink = (id: string) => {
    setThinkOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleTool = (id: string) => {
    setToolOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleToolError = (id: string) => {
    setToolErrorOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const mapToolCalls = useCallback((toolCalls: unknown): ToolCall[] => {
    const calls =
      toolCalls &&
      typeof toolCalls === 'object' &&
      'calls' in (toolCalls as Record<string, unknown>) &&
      Array.isArray((toolCalls as { calls?: unknown }).calls)
        ? ((toolCalls as { calls?: unknown[] }).calls as unknown[])
        : [];

    return calls.map((call, idx) => {
      const callObj = (call ?? {}) as Record<string, unknown>;
      const callId =
        typeof callObj.callId === 'string'
          ? callObj.callId
          : typeof callObj.callId === 'number'
            ? callObj.callId.toString()
            : `call-${idx}`;
      const stage =
        typeof callObj.stage === 'string' ? callObj.stage : undefined;
      const error =
        callObj.error && typeof callObj.error === 'object'
          ? (callObj.error as { code?: string; message?: string })
          : undefined;

      return {
        id: callId,
        name: typeof callObj.name === 'string' ? callObj.name : undefined,
        status: stage === 'error' ? 'error' : 'done',
        payload: callObj.result,
        parameters:
          callObj.parameters && typeof callObj.parameters === 'object'
            ? callObj.parameters
            : undefined,
        stage,
        errorTrimmed: error ?? null,
      } satisfies ToolCall;
    });
  }, []);

  const mapTurnsToMessages = useCallback(
    (items: StoredTurn[]) =>
      items.map(
        (turn) =>
          ({
            id: `${turn.createdAt}-${turn.role}-${turn.provider}`,
            role: turn.role === 'system' ? 'assistant' : turn.role,
            content: turn.content,
            tools: mapToolCalls(turn.toolCalls ?? null),
            streamStatus: turn.status === 'failed' ? 'failed' : 'complete',
            createdAt: turn.createdAt,
          }) satisfies ChatMessage,
      ),
    [mapToolCalls],
  );

  const lastHydratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeConversationId || !lastMode) return;
    const key = `${activeConversationId}-${lastMode}-${lastPage?.[0]?.createdAt ?? 'none'}`;
    if (lastHydratedRef.current === key) return;
    lastHydratedRef.current = key;

    if (lastMode === 'replace') {
      setMessages(mapTurnsToMessages(lastPage));
      return;
    }
    if (lastMode === 'prepend' && lastPage.length > 0) {
      setMessages((prev) => {
        const next = [...mapTurnsToMessages(lastPage), ...prev];
        const seen = new Set<string>();
        return next.filter((msg) => {
          if (seen.has(msg.id)) return false;
          seen.add(msg.id);
          return true;
        });
      });
    }
  }, [activeConversationId, lastMode, lastPage, mapTurnsToMessages]);

  useEffect(() => {
    if (lastMode !== 'prepend') {
      prevScrollHeightRef.current = transcriptRef.current?.scrollHeight ?? 0;
      return;
    }
    const node = transcriptRef.current;
    if (!node) return;
    const prevHeight = prevScrollHeightRef.current || 0;
    const newHeight = node.scrollHeight;
    node.scrollTop = newHeight - prevHeight + node.scrollTop;
  }, [lastMode, messages]);

  const handleTranscriptScroll = () => {
    const node = transcriptRef.current;
    if (!node) return;
    if (node.scrollTop < 200 && turnsHasMore && !turnsLoading) {
      prevScrollHeightRef.current = node.scrollHeight;
      void loadOlder();
    }
  };

  const handleSelectConversation = (conversationId: string) => {
    if (conversationId === activeConversationId) return;
    stop();
    resetTurns();
    setMessages([]);
    setActiveConversationId(conversationId);
    setThinkOpen({});
    setToolOpen({});
    setToolErrorOpen({});
  };

  const buildAgentAssistantMessage = (params: {
    answerText: string;
    thinkingText?: string;
    vectorSummary?: unknown;
  }): ChatMessage => {
    const id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
    const segments: NonNullable<ChatMessage['segments']> = [];
    if (params.vectorSummary !== undefined) {
      const toolId = `vector-summary-${id}`;
      const tool: ToolCall = {
        id: toolId,
        name: 'vector_summary',
        status: 'done',
        payload: params.vectorSummary,
      };
      segments.push({ id: `${id}-${toolId}`, kind: 'tool', tool });
    }
    segments.push({
      id: `${id}-text`,
      kind: 'text',
      content: params.answerText,
    });
    return {
      id,
      role: 'assistant',
      content: params.answerText,
      think: params.thinkingText,
      streamStatus: 'complete',
      segments,
      createdAt: new Date().toISOString(),
    };
  };

  const extractSegments = (segments: unknown[]) => {
    let thinkingText: string | undefined;
    let answerText = '';
    let vectorSummary: unknown | undefined;

    for (const seg of segments) {
      if (!seg || typeof seg !== 'object') continue;
      const record = seg as Record<string, unknown>;
      const type = record.type;
      if (type === 'thinking' && typeof record.text === 'string') {
        thinkingText = record.text;
      } else if (type === 'answer' && typeof record.text === 'string') {
        answerText = record.text;
      } else if (type === 'vector_summary') {
        vectorSummary = seg;
      }
    }

    return { thinkingText, answerText, vectorSummary };
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || !selectedAgentName || isRunning) return;

    stop();
    const controller = new AbortController();
    runControllerRef.current = controller;
    setIsRunning(true);
    lastSentRef.current = trimmed;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    try {
      const result = await runAgentInstruction({
        agentName: selectedAgentName,
        instruction: trimmed,
        working_folder: workingFolder.trim() || undefined,
        conversationId: activeConversationId,
        signal: controller.signal,
      });
      setActiveConversationId(result.conversationId);

      const extracted = extractSegments(result.segments);
      const assistantMessage = buildAgentAssistantMessage({
        answerText: extracted.answerText || '',
        thinkingText: extracted.thinkingText,
        vectorSummary: extracted.vectorSummary,
      });
      setMessages((prev) => [...prev, assistantMessage]);
      void refreshConversations();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setInput(lastSentRef.current);
        return;
      }
      const message =
        (err as Error).message || 'Failed to run agent instruction.';
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
          role: 'assistant',
          content: message,
          kind: 'error',
          streamStatus: 'failed',
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      if (runControllerRef.current === controller) {
        runControllerRef.current = null;
      }
      setIsRunning(false);
    }
  };

  const controlsDisabled =
    agentsLoading || !!agentsError || !selectedAgentName || persistenceLoading;

  const selectedAgent = agents.find((a) => a.name === selectedAgentName);

  const agentDescription = selectedAgent?.description?.trim();

  const showStop = isRunning;

  const renderParamsAccordion = (params: unknown, accordionId: string) => (
    <Accordion
      defaultExpanded={false}
      disableGutters
      data-testid="tool-params-accordion"
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
            m: 0,
          }}
        >
          {JSON.stringify(params ?? null, null, 2)}
        </Box>
      </AccordionDetails>
    </Accordion>
  );

  const renderResultAccordion = (payload: unknown, accordionId: string) => (
    <Accordion
      defaultExpanded={false}
      disableGutters
      data-testid="tool-result-accordion"
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon fontSize="small" />}
        aria-controls={`result-${accordionId}-content`}
      >
        <Typography variant="body2" fontWeight={600}>
          Result
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
            m: 0,
          }}
        >
          {JSON.stringify(payload ?? null, null, 2)}
        </Box>
      </AccordionDetails>
    </Accordion>
  );

  return (
    <Stack spacing={2} data-testid="agents-page">
      <Typography variant="h4">Agents</Typography>

      {agentsError && (
        <Alert severity="error" data-testid="agents-error">
          {agentsError}
        </Alert>
      )}

      {mongoConnected === false && (
        <Alert severity="warning" data-testid="agents-persistence-banner">
          Conversation persistence is currently unavailable. History and
          conversation continuation may be limited until MongoDB is reachable.
        </Alert>
      )}

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{ minHeight: 560 }}
      >
        <Paper
          variant="outlined"
          sx={{
            width: { xs: '100%', md: 340 },
            p: 1.5,
            height: { md: 'auto' },
          }}
        >
          <ConversationList
            conversations={conversations}
            selectedId={activeConversationId}
            isLoading={conversationsLoading}
            isError={conversationsError}
            error={conversationsErrorMessage}
            hasMore={conversationsHasMore}
            includeArchived={includeArchived}
            disabled={controlsDisabled}
            variant="agents"
            onSelect={handleSelectConversation}
            onToggleArchived={setIncludeArchived}
            onArchive={() => {}}
            onRestore={() => {}}
            onLoadMore={loadMoreConversations}
            onRefresh={refreshConversations}
            onRetry={refreshConversations}
          />
        </Paper>

        <Paper variant="outlined" sx={{ flex: 1, p: 2 }}>
          <Stack spacing={2} component="form" onSubmit={handleSubmit}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              alignItems={{ xs: 'stretch', sm: 'center' }}
            >
              <FormControl
                fullWidth
                size="small"
                disabled={agentsLoading || !!agentsError}
              >
                <InputLabel id="agent-select-label">Agent</InputLabel>
                <Select
                  labelId="agent-select-label"
                  label="Agent"
                  value={selectedAgentName}
                  onChange={handleAgentChange}
                  inputProps={{ 'data-testid': 'agent-select' }}
                >
                  {agents.map((agent) => (
                    <MenuItem key={agent.name} value={agent.name}>
                      {agent.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                <Button
                  type="button"
                  variant="outlined"
                  onClick={() => {
                    stop();
                    setInput(lastSentRef.current);
                    inputRef.current?.focus();
                  }}
                  disabled={!showStop}
                  data-testid="agent-stop"
                >
                  Stop
                </Button>
                <Button
                  type="button"
                  variant="outlined"
                  onClick={() => {
                    resetConversation();
                    inputRef.current?.focus();
                  }}
                  disabled={agentsLoading}
                  data-testid="agent-new-conversation"
                >
                  New conversation
                </Button>
              </Stack>
            </Stack>

            {commandsError ? (
              <Alert severity="error" data-testid="agent-commands-error">
                {commandsError}
              </Alert>
            ) : null}

            <FormControl
              fullWidth
              size="small"
              disabled={
                controlsDisabled ||
                isRunning ||
                selectedAgent?.disabled ||
                commandsLoading
              }
            >
              <InputLabel id="agent-command-select-label">Command</InputLabel>
              <Select
                labelId="agent-command-select-label"
                label="Command"
                value={selectedCommandName}
                onChange={handleCommandChange}
                inputProps={{ 'data-testid': 'agent-command-select' }}
              >
                <MenuItem value="" disabled>
                  Select a command
                </MenuItem>
                {commands.map((cmd) => (
                  <MenuItem
                    key={cmd.name}
                    value={cmd.name}
                    disabled={cmd.disabled}
                    data-testid={`agent-command-option-${cmd.name}`}
                  >
                    <Stack spacing={0.25}>
                      <Typography variant="body2">
                        {cmd.name.replace(/_/g, ' ')}
                      </Typography>
                      {cmd.disabled ? (
                        <Typography variant="caption" color="text.secondary">
                          Invalid command file
                        </Typography>
                      ) : null}
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Typography
              variant="body2"
              color="text.secondary"
              data-testid="agent-command-description"
            >
              {selectedCommandDescription}
            </Typography>

            {selectedAgent?.warnings?.length ? (
              <Alert severity="warning" data-testid="agent-warnings">
                {selectedAgent.warnings.join('\n')}
              </Alert>
            ) : null}

            {selectedAgent?.disabled ? (
              <Alert severity="warning" data-testid="agent-disabled">
                This agent is currently disabled.
              </Alert>
            ) : null}

            {agentDescription ? (
              <Paper
                variant="outlined"
                sx={{ p: 1.5 }}
                data-testid="agent-description"
              >
                <Markdown content={agentDescription} />
              </Paper>
            ) : null}

            <TextField
              fullWidth
              size="small"
              label="working_folder"
              placeholder="Absolute host path (optional)"
              value={workingFolder}
              onChange={(event) => setWorkingFolder(event.target.value)}
              disabled={
                controlsDisabled || isRunning || selectedAgent?.disabled
              }
              inputProps={{ 'data-testid': 'agent-working-folder' }}
            />

            <TextField
              inputRef={inputRef}
              fullWidth
              multiline
              minRows={2}
              label="Instruction"
              placeholder="Type your instruction"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={
                controlsDisabled || isRunning || selectedAgent?.disabled
              }
              inputProps={{ 'data-testid': 'agent-input' }}
            />

            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button
                type="submit"
                variant="contained"
                disabled={
                  controlsDisabled ||
                  isRunning ||
                  !selectedAgentName ||
                  !input.trim() ||
                  Boolean(selectedAgent?.disabled)
                }
                data-testid="agent-send"
              >
                Send
              </Button>
            </Stack>

            <Paper variant="outlined" sx={{ p: 1.5, minHeight: 260 }}>
              <Box
                ref={transcriptRef}
                onScroll={handleTranscriptScroll}
                sx={{ maxHeight: 520, overflowY: 'auto' }}
                data-testid="agent-transcript"
              >
                <Stack spacing={1} sx={{ minHeight: 240 }}>
                  {turnsLoading && (
                    <Typography
                      color="text.secondary"
                      variant="caption"
                      sx={{ px: 0.5 }}
                    >
                      Loading history...
                    </Typography>
                  )}
                  {turnsError && (
                    <Alert severity="warning" data-testid="agent-turns-error">
                      {turnsErrorMessage ??
                        'Failed to load conversation history.'}
                    </Alert>
                  )}
                  {orderedMessages.length === 0 && (
                    <Typography color="text.secondary">
                      Transcript will appear here once you send an instruction.
                    </Typography>
                  )}

                  {orderedMessages.map((message) => {
                    const alignSelf =
                      message.role === 'user' ? 'flex-end' : 'flex-start';
                    const isErrorBubble = message.kind === 'error';
                    const isStatusBubble = message.kind === 'status';
                    const isUser = message.role === 'user';
                    const baseSegments = message.segments?.length
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
                    const segments = baseSegments;

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
                              borderRadius: '14px',
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
                                const isRequesting =
                                  tool.status === 'requesting';
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
                                        variant="body2"
                                        fontWeight={700}
                                      >
                                        {tool.name || 'Tool'}
                                      </Typography>
                                      <Chip
                                        size="small"
                                        variant="outlined"
                                        label={statusLabel}
                                        color={
                                          tool.status === 'error'
                                            ? 'error'
                                            : tool.status === 'done'
                                              ? 'success'
                                              : 'default'
                                        }
                                      />
                                      <Button
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
                                      </Button>
                                      {tool.status === 'error' && (
                                        <Button
                                          size="small"
                                          variant="text"
                                          onClick={() =>
                                            toggleToolError(toggleKey)
                                          }
                                          data-testid="tool-error-toggle"
                                          sx={{
                                            textTransform: 'none',
                                            minWidth: 0,
                                            p: 0,
                                          }}
                                        >
                                          Error
                                        </Button>
                                      )}
                                    </Stack>

                                    <Accordion
                                      expanded={isOpen}
                                      onChange={() => toggleTool(toggleKey)}
                                      disableGutters
                                      sx={{
                                        display: isOpen ? 'block' : 'none',
                                      }}
                                    >
                                      <AccordionSummary
                                        expandIcon={<ExpandMoreIcon />}
                                      >
                                        <Typography
                                          variant="caption"
                                          color="text.secondary"
                                        >
                                          {tool.name || 'Tool details'}
                                        </Typography>
                                      </AccordionSummary>
                                      <AccordionDetails>
                                        <Stack spacing={1}>
                                          {renderParamsAccordion(
                                            tool.parameters,
                                            toggleKey,
                                          )}
                                          {renderResultAccordion(
                                            tool.payload,
                                            toggleKey,
                                          )}
                                          {tool.status === 'error' &&
                                            tool.errorTrimmed && (
                                              <Alert
                                                severity="error"
                                                data-testid="tool-error"
                                              >
                                                {JSON.stringify(
                                                  tool.errorTrimmed,
                                                )}
                                              </Alert>
                                            )}
                                        </Stack>
                                      </AccordionDetails>
                                    </Accordion>

                                    {tool.status === 'error' &&
                                      tool.errorFull && (
                                        <Collapse
                                          in={!!toolErrorOpen[toggleKey]}
                                          timeout="auto"
                                          unmountOnExit
                                        >
                                          <Box mt={0.5}>
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
                                                m: 0,
                                              }}
                                            >
                                              {JSON.stringify(
                                                tool.errorFull ?? null,
                                                null,
                                                2,
                                              )}
                                            </Box>
                                          </Box>
                                        </Collapse>
                                      )}
                                  </Box>
                                );
                              })}

                              {message.think && (
                                <Box mt={1}>
                                  <Stack
                                    direction="row"
                                    alignItems="center"
                                    gap={0.5}
                                  >
                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                    >
                                      Thought process
                                    </Typography>
                                    <Button
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
                                    </Button>
                                  </Stack>
                                  <Box mt={0.5}>
                                    <Accordion
                                      expanded={!!thinkOpen[message.id]}
                                      onChange={() => toggleThink(message.id)}
                                      disableGutters
                                      sx={{
                                        display: thinkOpen[message.id]
                                          ? 'block'
                                          : 'none',
                                      }}
                                    >
                                      <AccordionSummary
                                        expandIcon={<ExpandMoreIcon />}
                                      >
                                        <Typography
                                          variant="caption"
                                          color="text.secondary"
                                        >
                                          Thought process
                                        </Typography>
                                      </AccordionSummary>
                                      <AccordionDetails>
                                        <Box color="text.secondary">
                                          <Markdown
                                            content={message.think ?? ''}
                                            data-testid="think-content"
                                          />
                                        </Box>
                                      </AccordionDetails>
                                    </Accordion>
                                  </Box>
                                </Box>
                              )}
                            </Stack>
                          </Paper>
                        </Box>
                      </Stack>
                    );
                  })}
                </Stack>
              </Box>
            </Paper>
          </Stack>
        </Paper>
      </Stack>
    </Stack>
  );
}
