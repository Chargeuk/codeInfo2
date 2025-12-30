import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Container,
  Alert,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  Link,
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
import type { SelectChangeEvent } from '@mui/material/Select';
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Markdown from '../components/Markdown';
import CodexFlagsPanel from '../components/chat/CodexFlagsPanel';
import ConversationList from '../components/chat/ConversationList';
import useChatModel from '../hooks/useChatModel';
import useChatStream, {
  ChatMessage,
  ApprovalPolicy,
  ModelReasoningEffort,
  SandboxMode,
  ToolCitation,
  ToolCall,
} from '../hooks/useChatStream';
import useChatWs, { type ChatWsServerEvent } from '../hooks/useChatWs';
import useConversationTurns, {
  StoredTurn,
} from '../hooks/useConversationTurns';
import useConversations from '../hooks/useConversations';
import usePersistenceStatus from '../hooks/usePersistenceStatus';

export default function ChatPage() {
  const {
    providers,
    provider,
    setProvider,
    providerReason,
    available: providerAvailable,
    toolsAvailable,
    models,
    selected,
    setSelected,
    errorMessage,
    providerErrorMessage,
    isLoading,
    isError,
    isEmpty,
    refreshModels,
    refreshProviders,
  } = useChatModel();
  const defaultSandboxMode: SandboxMode = 'workspace-write';
  const defaultApprovalPolicy: ApprovalPolicy = 'on-failure';
  const defaultModelReasoningEffort: ModelReasoningEffort = 'high';
  const defaultNetworkAccessEnabled = true;
  const defaultWebSearchEnabled = true;
  const [sandboxMode, setSandboxMode] =
    useState<SandboxMode>(defaultSandboxMode);
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>(
    defaultApprovalPolicy,
  );
  const [modelReasoningEffort, setModelReasoningEffort] =
    useState<ModelReasoningEffort>(defaultModelReasoningEffort);
  const [networkAccessEnabled, setNetworkAccessEnabled] = useState<boolean>(
    defaultNetworkAccessEnabled,
  );
  const [webSearchEnabled, setWebSearchEnabled] = useState<boolean>(
    defaultWebSearchEnabled,
  );
  const {
    messages,
    status,
    isStreaming,
    send,
    stop,
    reset,
    conversationId,
    setConversation,
    hydrateHistory,
    hydrateInflightSnapshot,
    getInflightId,
    handleWsEvent,
  } = useChatStream(selected, provider, {
    sandboxMode,
    approvalPolicy,
    modelReasoningEffort,
    networkAccessEnabled,
    webSearchEnabled,
  });

  const {
    conversations,
    filterState,
    setFilterState,
    isLoading: conversationsLoading,
    isError: conversationsError,
    error: conversationsErrorMessage,
    hasMore: conversationsHasMore,
    loadMore: loadMoreConversations,
    refresh: refreshConversations,
    archive: archiveConversation,
    restore: restoreConversation,
    bulkArchive,
    bulkRestore,
    bulkDelete,
    applyWsUpsert,
    applyWsDelete,
  } = useConversations({ agentName: '__none__' });

  const {
    mongoConnected,
    isLoading: persistenceLoading,
    refresh: refreshPersistence,
  } = usePersistenceStatus();

  const [activeConversationId, setActiveConversationId] = useState<
    string | undefined
  >(conversationId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const stopRef = useRef(stop);
  const lastSentRef = useRef('');
  const [input, setInput] = useState('');
  const [thinkOpen, setThinkOpen] = useState<Record<string, boolean>>({});
  const [toolOpen, setToolOpen] = useState<Record<string, boolean>>({});
  const [toolErrorOpen, setToolErrorOpen] = useState<Record<string, boolean>>(
    {},
  );
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const prevScrollHeightRef = useRef<number>(0);
  const knownConversationIds = useMemo(
    () => new Set(conversations.map((c) => c.conversationId)),
    [conversations],
  );
  const persistenceUnavailable = mongoConnected === false;

  const selectedConversation = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.conversationId === activeConversationId,
      ),
    [activeConversationId, conversations],
  );
  const turnsConversationId = persistenceUnavailable
    ? undefined
    : activeConversationId;
  const turnsAutoFetch = Boolean(
    turnsConversationId && knownConversationIds.has(turnsConversationId),
  );
  const {
    lastPage,
    lastMode,
    inflight: inflightSnapshot,
    isLoading: turnsLoading,
    isError: turnsError,
    error: turnsErrorMessage,
    hasMore: turnsHasMore,
    loadOlder,
    refresh: refreshTurns,
    reset: resetTurns,
  } = useConversationTurns(turnsConversationId, { autoFetch: turnsAutoFetch });

  const refreshSnapshots = useCallback(async () => {
    if (persistenceUnavailable) return;
    await Promise.all([
      refreshConversations(),
      turnsConversationId ? refreshTurns() : Promise.resolve(),
    ]);
  }, [
    persistenceUnavailable,
    refreshConversations,
    refreshTurns,
    turnsConversationId,
  ]);

  const {
    connectionState: wsConnectionState,
    subscribeSidebar,
    unsubscribeSidebar,
    subscribeConversation,
    unsubscribeConversation,
    cancelInflight,
  } = useChatWs({
    realtimeEnabled: mongoConnected !== false,
    onReconnectBeforeResubscribe: async () => {
      if (mongoConnected === false) return;
      await refreshSnapshots();
    },
    onEvent: (event: ChatWsServerEvent) => {
      if (mongoConnected === false) return;
      switch (event.type) {
        case 'conversation_upsert': {
          const agentName = event.conversation.agentName;
          if (typeof agentName === 'string' && agentName.trim().length > 0) {
            return;
          }
          applyWsUpsert({
            conversationId: event.conversation.conversationId,
            title: event.conversation.title,
            provider: event.conversation.provider,
            model: event.conversation.model,
            source: event.conversation.source === 'MCP' ? 'MCP' : 'REST',
            lastMessageAt: event.conversation.lastMessageAt,
            archived: event.conversation.archived,
            flags: event.conversation.flags,
            agentName: event.conversation.agentName,
          });
          return;
        }
        case 'conversation_delete':
          applyWsDelete(event.conversationId);
          return;
        case 'inflight_snapshot':
        case 'user_turn':
        case 'assistant_delta':
        case 'stream_warning':
        case 'analysis_delta':
        case 'tool_event':
        case 'turn_final':
          handleWsEvent(event);
          return;
        default:
          return;
      }
    },
  });

  useEffect(() => {
    const debugState = {
      activeConversationId,
      wsConnectionState,
      persistenceUnavailable,
      knownIds: Array.from(knownConversationIds),
      turnsConversationId,
      turnsAutoFetch,
      lastMode,
      lastPageCount: lastPage.length,
      lastPageFirst: lastPage[0]?.createdAt,
      messageCount: messages.length,
    };
    if (typeof window !== 'undefined') {
      (window as unknown as { __chatDebug?: unknown }).__chatDebug = debugState;
    }
    console.info('[chat-history] load-turns-state', debugState);
  }, [
    activeConversationId,
    wsConnectionState,
    knownConversationIds,
    persistenceUnavailable,
    turnsAutoFetch,
    turnsConversationId,
    lastMode,
    lastPage,
    messages.length,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const enabled = Boolean(
      (window as unknown as { __CODEINFO_TEST__?: boolean }).__CODEINFO_TEST__,
    );
    if (!enabled) return;
    (window as unknown as { __chatTest?: unknown }).__chatTest = {
      handleWsEvent,
    };
  }, [handleWsEvent]);
  const providerLocked = Boolean(selectedConversation || messages.length > 0);
  const providerIsCodex = provider === 'codex';
  const codexProvider = useMemo(
    () => providers.find((p) => p.id === 'codex'),
    [providers],
  );
  const codexUnavailable = Boolean(codexProvider && !codexProvider.available);
  const showCodexUnavailable = providerIsCodex
    ? !providerAvailable
    : codexUnavailable;
  const showCodexToolsMissing =
    providerIsCodex && providerAvailable && !toolsAvailable;
  const showCodexReady = providerIsCodex && providerAvailable && toolsAvailable;
  const activeToolsAvailable = Boolean(toolsAvailable && providerAvailable);
  const controlsDisabled =
    isLoading ||
    isError ||
    isEmpty ||
    !selected ||
    !providerAvailable ||
    (providerIsCodex && !toolsAvailable);
  const isSending = isStreaming || status === 'sending';
  const showStop = isSending;
  const combinedError =
    providerErrorMessage ?? errorMessage ?? 'Failed to load chat options.';
  const retryFetch = useCallback(() => {
    void refreshProviders();
    if (provider) {
      void refreshModels(provider);
    }
  }, [provider, refreshModels, refreshProviders]);

  const orderedMessages = useMemo<ChatMessage[]>(
    () => [...messages].reverse(),
    [messages],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveConversationId(conversationId);
    console.info('[chat-history] conversationId changed', { conversationId });
  }, [conversationId]);

  useEffect(() => {
    if (persistenceUnavailable) return;
    subscribeSidebar();
    return () => unsubscribeSidebar();
  }, [persistenceUnavailable, subscribeSidebar, unsubscribeSidebar]);

  useEffect(() => {
    if (persistenceUnavailable) return;

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshSnapshots();
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [persistenceUnavailable, refreshSnapshots]);

  useEffect(() => {
    if (persistenceUnavailable) return;
    if (!activeConversationId) return;
    subscribeConversation(activeConversationId);
    return () => unsubscribeConversation(activeConversationId);
  }, [
    activeConversationId,
    persistenceUnavailable,
    subscribeConversation,
    unsubscribeConversation,
  ]);

  useEffect(() => {
    if (!selectedConversation?.provider) return;
    if (selectedConversation.provider !== provider) {
      setProvider(selectedConversation.provider);
    }
  }, [provider, selectedConversation, setProvider]);

  useEffect(() => {
    if (!selectedConversation?.model) return;
    if (models.some((model) => model.key === selectedConversation.model)) {
      setSelected(selectedConversation.model);
    }
  }, [models, selectedConversation, setSelected]);

  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  useEffect(() => {
    return () => {
      stopRef.current();
    };
  }, []);

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

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || controlsDisabled) return;
    lastSentRef.current = trimmed;
    void send(trimmed).then(() => refreshConversations());
    setInput('');
  };

  const handleStop = () => {
    const currentInflightId = getInflightId();
    if (activeConversationId && currentInflightId) {
      cancelInflight(activeConversationId, currentInflightId);
    }
    stop({ showStatusBubble: true });
    setInput(lastSentRef.current);
    inputRef.current?.focus();
  };

  const handleNewConversation = () => {
    const currentInflightId = getInflightId();
    if (activeConversationId && currentInflightId) {
      cancelInflight(activeConversationId, currentInflightId);
    }
    stop();
    resetTurns();
    const nextId = reset();
    setConversation(nextId, { clearMessages: true });
    setActiveConversationId(nextId);
    setInput('');
    lastSentRef.current = '';
    inputRef.current?.focus();
    setThinkOpen({});
    setToolOpen({});
    setSandboxMode(defaultSandboxMode);
    setApprovalPolicy(defaultApprovalPolicy);
    setModelReasoningEffort(defaultModelReasoningEffort);
    setNetworkAccessEnabled(defaultNetworkAccessEnabled);
    setWebSearchEnabled(defaultWebSearchEnabled);
  };

  const handleProviderChange = (event: SelectChangeEvent<string>) => {
    const nextProvider = event.target.value;
    setProvider(nextProvider);
    handleNewConversation();
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

  const handleSelectConversation = (conversation: string) => {
    if (conversation === activeConversationId) return;
    console.info('[chat-history] handleSelect', {
      clickedId: conversation,
      activeConversationId,
    });
    const nextConversation = conversations.find(
      (c) => c.conversationId === conversation,
    );
    console.info('[chat-history] selecting conversation', {
      conversation,
      provider: nextConversation?.provider,
      model: nextConversation?.model,
    });
    if (nextConversation?.provider && nextConversation.provider !== provider) {
      setProvider(nextConversation.provider);
    }
    if (
      nextConversation?.model &&
      models.some((model) => model.key === nextConversation.model)
    ) {
      setSelected(nextConversation.model);
    }
    stop();
    resetTurns();
    setConversation(conversation, { clearMessages: true });
    setActiveConversationId(conversation);
    setTimeout(() => {
      console.info('[chat-history] post-select scheduled', {
        clickedId: conversation,
        activeConversationId: conversationId,
      });
    }, 0);
  };

  const handleArchive = async (id: string) => {
    await archiveConversation(id);
    void refreshConversations();
  };

  const handleRestore = async (id: string) => {
    await restoreConversation(id);
    void refreshConversations();
  };

  const handleTranscriptScroll = () => {
    const node = transcriptRef.current;
    if (!node) return;
    if (node.scrollTop < 200 && turnsHasMore && !turnsLoading) {
      prevScrollHeightRef.current = node.scrollHeight;
      void loadOlder();
    }
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
  const lastInflightHydratedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeConversationId || !lastMode) return;
    const key = `${activeConversationId}-${lastMode}-${lastPage?.[0]?.createdAt ?? 'none'}`;
    if (lastHydratedRef.current === key) return;
    lastHydratedRef.current = key;
    console.info('[chat-history] hydrating turns', {
      activeConversationId,
      mode: lastMode,
      count: lastPage.length,
      first: lastPage[0]?.createdAt,
    });
    if (lastMode === 'replace') {
      hydrateHistory(
        activeConversationId,
        mapTurnsToMessages(lastPage),
        'replace',
      );
      return;
    }
    if (lastMode === 'prepend' && lastPage.length > 0) {
      hydrateHistory(
        activeConversationId,
        mapTurnsToMessages(lastPage),
        'prepend',
      );
    }
  }, [
    activeConversationId,
    hydrateHistory,
    lastMode,
    lastPage,
    mapTurnsToMessages,
  ]);

  useEffect(() => {
    if (!activeConversationId || !inflightSnapshot) return;
    const inflightKey = `${activeConversationId}-${inflightSnapshot.inflightId}-${inflightSnapshot.seq}`;
    if (lastInflightHydratedRef.current === inflightKey) return;
    lastInflightHydratedRef.current = inflightKey;
    hydrateInflightSnapshot(activeConversationId, inflightSnapshot);
  }, [activeConversationId, hydrateInflightSnapshot, inflightSnapshot]);

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
            style={{
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
            }}
            sx={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
            }}
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
        {persistenceUnavailable && (
          <Alert
            severity="warning"
            data-testid="persistence-banner"
            action={
              <Button color="inherit" size="small" onClick={refreshPersistence}>
                Retry
              </Button>
            }
          >
            Conversation history unavailable — messages won’t be stored until
            Mongo reconnects.
          </Alert>
        )}
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          alignItems="stretch"
        >
          <Box sx={{ width: { xs: '100%', md: 320 }, flexShrink: 0 }}>
            <ConversationList
              conversations={conversations}
              selectedId={activeConversationId}
              isLoading={conversationsLoading}
              isError={conversationsError}
              error={conversationsErrorMessage}
              hasMore={conversationsHasMore}
              filterState={filterState}
              mongoConnected={mongoConnected}
              disabled={persistenceUnavailable || persistenceLoading}
              onSelect={handleSelectConversation}
              onFilterChange={setFilterState}
              onArchive={handleArchive}
              onRestore={handleRestore}
              onBulkArchive={bulkArchive}
              onBulkRestore={bulkRestore}
              onBulkDelete={bulkDelete}
              onLoadMore={loadMoreConversations}
              onRefresh={refreshConversations}
              onRetry={refreshConversations}
            />
          </Box>

          <Box sx={{ flex: 1, minWidth: 0 }} data-testid="chat-column">
            <Stack spacing={2}>
              {isLoading && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <CircularProgress size={18} />
                  <Typography variant="body2" color="text.secondary">
                    Loading chat providers and models...
                  </Typography>
                </Stack>
              )}
              {isError && (
                <Alert
                  severity="error"
                  action={
                    <Button color="inherit" size="small" onClick={retryFetch}>
                      Retry
                    </Button>
                  }
                >
                  {combinedError}
                </Alert>
              )}
              {!isLoading && !isError && isEmpty && (
                <Alert severity="info">
                  No chat-capable models available for this provider.
                </Alert>
              )}
              <form onSubmit={handleSubmit}>
                <Stack spacing={1.5}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={2}
                    alignItems="stretch"
                  >
                    <FormControl
                      sx={{ minWidth: 220 }}
                      disabled={isLoading || providerLocked}
                    >
                      <InputLabel id="chat-provider-label">Provider</InputLabel>
                      <Select
                        labelId="chat-provider-label"
                        id="chat-provider-select"
                        label="Provider"
                        value={provider ?? ''}
                        onChange={handleProviderChange}
                        displayEmpty
                        data-testid="provider-select"
                      >
                        {providers.map((entry) => (
                          <MenuItem
                            key={entry.id}
                            value={entry.id}
                            disabled={!entry.available}
                          >
                            {entry.label}
                            {!entry.available ? ' (unavailable)' : ''}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>

                    <FormControl
                      sx={{ minWidth: 260, flex: 1 }}
                      disabled={
                        isLoading || isError || isEmpty || !providerAvailable
                      }
                    >
                      <InputLabel id="chat-model-label">Model</InputLabel>
                      <Select
                        labelId="chat-model-label"
                        id="chat-model-select"
                        label="Model"
                        value={selected ?? ''}
                        onChange={(event) => setSelected(event.target.value)}
                        displayEmpty
                        data-testid="model-select"
                      >
                        {models.map((model) => (
                          <MenuItem key={model.key} value={model.key}>
                            {model.displayName}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>

                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      justifyContent="flex-end"
                      sx={{ minWidth: { xs: '100%', sm: 220 } }}
                    >
                      <Button
                        type="button"
                        variant="outlined"
                        color="secondary"
                        onClick={handleNewConversation}
                        disabled={isLoading}
                        fullWidth
                      >
                        New conversation
                      </Button>
                    </Stack>
                  </Stack>

                  {providerIsCodex && (
                    <CodexFlagsPanel
                      sandboxMode={sandboxMode}
                      onSandboxModeChange={(value) => setSandboxMode(value)}
                      approvalPolicy={approvalPolicy}
                      onApprovalPolicyChange={setApprovalPolicy}
                      modelReasoningEffort={modelReasoningEffort}
                      onModelReasoningEffortChange={setModelReasoningEffort}
                      networkAccessEnabled={networkAccessEnabled}
                      onNetworkAccessEnabledChange={setNetworkAccessEnabled}
                      webSearchEnabled={webSearchEnabled}
                      onWebSearchEnabledChange={setWebSearchEnabled}
                      disabled={controlsDisabled}
                    />
                  )}

                  {showCodexUnavailable ? (
                    <Alert
                      severity="warning"
                      data-testid="codex-unavailable-banner"
                    >
                      OpenAI Codex is unavailable. Install the CLI (`npm install
                      -g @openai/codex`), log in with `CODEX_HOME=./codex codex
                      login` (or your `~/.codex`), and ensure
                      `./codex/config.toml` is seeded. Compose mounts{' '}
                      <code>{'${CODEX_HOME:-$HOME/.codex}'}</code> to
                      `/host/codex` and copies `auth.json` into `/app/codex`
                      when missing, so container logins are not required. See
                      the guidance in{' '}
                      <Link
                        href="https://github.com/Chargeuk/codeInfo2#codex-cli"
                        target="_blank"
                        rel="noreferrer"
                      >
                        README ▸ Codex (CLI)
                      </Link>
                      .
                      {providerIsCodex || codexProvider?.reason
                        ? ` (${providerIsCodex ? (providerReason ?? '') : (codexProvider?.reason ?? '')})`
                        : ''}
                    </Alert>
                  ) : null}
                  {showCodexToolsMissing && (
                    <Alert severity="warning" data-testid="codex-tools-banner">
                      Codex requires MCP tools. Ensure `config.toml` lists the
                      `/mcp` endpoints and that tools are enabled, then retry
                      once the CLI/auth/config prerequisites above are
                      satisfied.
                    </Alert>
                  )}
                  {showCodexReady && (
                    <Alert severity="info" data-testid="codex-ready-banner">
                      Codex chats are enabled with MCP tools. Threads reuse
                      returned thread IDs so conversations can continue across
                      turns.
                    </Alert>
                  )}

                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={2}
                    alignItems={{ xs: 'stretch', sm: 'flex-start' }}
                  >
                    <TextField
                      inputRef={inputRef}
                      fullWidth
                      multiline
                      minRows={2}
                      label="Message"
                      placeholder="Type your prompt"
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      disabled={controlsDisabled}
                      inputProps={{ 'data-testid': 'chat-input' }}
                      helperText={
                        providerIsCodex &&
                        (!providerAvailable || !toolsAvailable)
                          ? 'Codex is unavailable until the CLI is installed, logged in, and MCP tools are enabled.'
                          : undefined
                      }
                    />
                    <Stack direction="row" spacing={1} alignItems="flex-start">
                      <Button
                        type="submit"
                        variant="contained"
                        data-testid="chat-send"
                        disabled={
                          controlsDisabled || isSending || !input.trim()
                        }
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
                    </Stack>
                  </Stack>
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
                    <Typography color="text.secondary">
                      Loading chat providers and models...
                    </Typography>
                  </Stack>
                )}
                {isError && (
                  <Alert
                    severity="error"
                    action={
                      <Button color="inherit" size="small" onClick={retryFetch}>
                        Retry
                      </Button>
                    }
                  >
                    {combinedError}
                  </Alert>
                )}
                {!isLoading && !isError && isEmpty && (
                  <Typography color="text.secondary">
                    No chat-capable models for this provider. Add a supported
                    model or switch providers, then retry.
                  </Typography>
                )}
                {!isLoading && !isError && !isEmpty && (
                  <Box
                    ref={transcriptRef}
                    onScroll={handleTranscriptScroll}
                    data-testid="chat-transcript"
                    sx={{
                      maxHeight: 640,
                      overflowY: 'auto',
                      overflowX: 'hidden',
                      pr: 1,
                      minWidth: 0,
                    }}
                  >
                    <Stack spacing={1} sx={{ minHeight: 280 }}>
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
                        <Alert severity="warning" data-testid="turns-error">
                          {turnsErrorMessage ??
                            'Failed to load conversation history.'}
                        </Alert>
                      )}
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
                        const hasCitations =
                          activeToolsAvailable && !!message.citations?.length;
                        const baseSegments = message.segments?.length
                          ? message.segments
                          : ([
                              {
                                id: `${message.id}-text`,
                                kind: 'text' as const,
                                content: message.content ?? '',
                              },
                              ...(activeToolsAvailable
                                ? (message.tools?.map((tool) => ({
                                    id: `${message.id}-${tool.id}`,
                                    kind: 'tool' as const,
                                    tool,
                                  })) ?? [])
                                : []),
                            ] as const);
                        const segments = activeToolsAvailable
                          ? baseSegments
                          : baseSegments.filter(
                              (segment) => segment.kind === 'text',
                            );
                        return (
                          <Stack
                            key={message.id}
                            alignItems={
                              alignSelf === 'flex-end'
                                ? 'flex-end'
                                : 'flex-start'
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
                                          message.streamStatus ===
                                          'complete' ? (
                                            <CheckCircleOutlineIcon fontSize="small" />
                                          ) : message.streamStatus ===
                                            'failed' ? (
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
                                  {message.role === 'assistant' &&
                                    message.warnings &&
                                    message.warnings.length > 0 && (
                                      <Stack
                                        direction="row"
                                        spacing={1}
                                        sx={{ flexWrap: 'wrap' }}
                                      >
                                        {message.warnings.map((warning) => (
                                          <Chip
                                            key={`${message.id}-warning-${warning}`}
                                            size="small"
                                            variant="outlined"
                                            color="warning"
                                            icon={
                                              <WarningAmberIcon fontSize="small" />
                                            }
                                            label={warning}
                                            data-testid="warning-chip"
                                            sx={{ alignSelf: 'flex-start' }}
                                          />
                                        ))}
                                      </Stack>
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
                                      <Box
                                        key={segment.id}
                                        data-testid="tool-row"
                                      >
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
                                            onClick={() =>
                                              toggleTool(toggleKey)
                                            }
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
                                            {isOpen
                                              ? 'Hide details'
                                              : 'Show details'}
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
                                  {message.role === 'assistant' &&
                                    message.thinking && (
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
                                      expandIcon={
                                        <ExpandMoreIcon fontSize="small" />
                                      }
                                      aria-controls="citations-panel"
                                      id="citations-summary"
                                      data-testid="citations-toggle"
                                    >
                                      <Typography
                                        variant="body2"
                                        fontWeight={600}
                                      >
                                        Citations (
                                        {message.citations?.length ?? 0})
                                      </Typography>
                                    </AccordionSummary>
                                    <AccordionDetails id="citations-panel">
                                      <Stack
                                        spacing={1}
                                        data-testid="citations"
                                      >
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
                                                  title={
                                                    citation.hostPath ??
                                                    pathLabel
                                                  }
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
                                                  style={{
                                                    overflowWrap: 'anywhere',
                                                    wordBreak: 'break-word',
                                                  }}
                                                  sx={{
                                                    whiteSpace: 'pre-wrap',
                                                    overflowWrap: 'anywhere',
                                                    wordBreak: 'break-word',
                                                  }}
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
                                        {thinkOpen[message.id]
                                          ? 'Hide'
                                          : 'Show'}
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
                  </Box>
                )}
              </Paper>
            </Stack>
          </Box>
        </Stack>
      </Stack>
    </Container>
  );
}
