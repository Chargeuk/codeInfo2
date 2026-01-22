import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Drawer,
  IconButton,
  MenuItem,
  Paper,
  Popover,
  Stack,
  TextField,
  Typography,
  Tooltip,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  type ChangeEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { FlowApiError, listFlows, runFlow } from '../api/flows';
import Markdown from '../components/Markdown';
import ConversationList from '../components/chat/ConversationList';
import DirectoryPickerDialog from '../components/ingest/DirectoryPickerDialog';
import useChatStream, { ChatMessage, ToolCall } from '../hooks/useChatStream';
import useChatWs, { type ChatWsServerEvent } from '../hooks/useChatWs';
import useConversationTurns, {
  StoredTurn,
} from '../hooks/useConversationTurns';
import useConversations from '../hooks/useConversations';
import usePersistenceStatus from '../hooks/usePersistenceStatus';
import { createLogger } from '../logging/logger';

const bubbleTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const formatBubbleTimestamp = (value?: string) => {
  const candidate = value ? new Date(value) : new Date();
  if (Number.isNaN(candidate.getTime())) {
    return bubbleTimestampFormatter.format(new Date());
  }
  return bubbleTimestampFormatter.format(candidate);
};

const formatDecimal = (value: number) =>
  value.toFixed(2).replace(/\.?(0+)$/, '');

const buildUsageLine = (usage: ChatMessage['usage']) => {
  if (!usage) return null;
  const hasUsage =
    usage.inputTokens !== undefined ||
    usage.outputTokens !== undefined ||
    usage.totalTokens !== undefined ||
    usage.cachedInputTokens !== undefined;
  if (!hasUsage) return null;
  const cachedSuffix =
    usage.cachedInputTokens !== undefined
      ? ` (cached ${usage.cachedInputTokens})`
      : '';
  return (
    `Tokens: in ${usage.inputTokens ?? 0} · out ${usage.outputTokens ?? 0} · total ` +
    `${usage.totalTokens ?? 0}${cachedSuffix}`
  );
};

const buildTimingLine = (timing: ChatMessage['timing']) => {
  if (!timing) return null;
  const hasTiming =
    timing.totalTimeSec !== undefined || timing.tokensPerSecond !== undefined;
  if (!hasTiming) return null;
  const parts: string[] = [];
  if (timing.totalTimeSec !== undefined) {
    parts.push(`Time: ${formatDecimal(timing.totalTimeSec)}s`);
  }
  if (timing.tokensPerSecond !== undefined) {
    parts.push(`Rate: ${formatDecimal(timing.tokensPerSecond)} tok/s`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
};

const buildStepLine = (command: ChatMessage['command']) => {
  if (!command) return null;
  if (
    !Number.isFinite(command.stepIndex) ||
    !Number.isFinite(command.totalSteps)
  ) {
    return null;
  }
  return `Step ${command.stepIndex} of ${command.totalSteps}`;
};

const buildFlowMetaLine = (command: ChatMessage['command']) => {
  if (!command || command.name !== 'flow') return null;
  const extended = command as ChatMessage['command'] & {
    label?: unknown;
    agentType?: unknown;
    identifier?: unknown;
  };
  const label =
    typeof extended.label === 'string' && extended.label.trim().length > 0
      ? extended.label.trim()
      : 'flow';
  const agentType =
    typeof extended.agentType === 'string' ? extended.agentType.trim() : '';
  const identifier =
    typeof extended.identifier === 'string' ? extended.identifier.trim() : '';
  const agentSuffix =
    agentType && identifier ? `${agentType}/${identifier}` : '';
  return agentSuffix ? `${label} · ${agentSuffix}` : label;
};

type FlowResumeState = {
  stepPath?: unknown;
};

const readResumeStepPath = (flags?: Record<string, unknown>) => {
  if (!flags || typeof flags !== 'object') return undefined;
  const flow = (flags as { flow?: unknown }).flow;
  if (!flow || typeof flow !== 'object') return undefined;
  const stepPath = (flow as FlowResumeState).stepPath;
  if (
    Array.isArray(stepPath) &&
    stepPath.every(
      (value) => typeof value === 'number' && Number.isFinite(value),
    )
  ) {
    return stepPath as number[];
  }
  return undefined;
};

export default function FlowsPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const drawerWidth = 320;
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [desktopDrawerOpen, setDesktopDrawerOpen] = useState<boolean>(() =>
    isMobile ? false : true,
  );
  const drawerOpen = isMobile ? mobileDrawerOpen : desktopDrawerOpen;

  const [flows, setFlows] = useState<
    Array<{
      name: string;
      description?: string;
      disabled?: boolean;
      error?: string;
    }>
  >([]);
  const [flowsLoading, setFlowsLoading] = useState(true);
  const [flowsError, setFlowsError] = useState<string | null>(null);
  const [selectedFlowName, setSelectedFlowName] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [flowInfoAnchorEl, setFlowInfoAnchorEl] = useState<HTMLElement | null>(
    null,
  );

  const [workingFolder, setWorkingFolder] = useState('');
  const [dirPickerOpen, setDirPickerOpen] = useState(false);
  const [startPending, setStartPending] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [flowModelId, setFlowModelId] = useState('unknown');

  const log = useMemo(() => createLogger('client-flows'), []);

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
  } = useConversations({ flowName: selectedFlowName });

  const [activeConversationId, setActiveConversationId] = useState<
    string | undefined
  >(undefined);

  const { mongoConnected } = usePersistenceStatus();
  const persistenceUnavailable = mongoConnected === false;

  const {
    messages,
    status,
    isStreaming,
    stop,
    setConversation,
    hydrateHistory,
    hydrateInflightSnapshot,
    handleWsEvent,
    getInflightId,
    getConversationId,
  } = useChatStream(flowModelId, 'codex');

  const displayMessages = useMemo<ChatMessage[]>(
    () => [...messages].reverse(),
    [messages],
  );

  const selectedFlow = useMemo(
    () => flows.find((flow) => flow.name === selectedFlowName),
    [flows, selectedFlowName],
  );
  const flowDescription = selectedFlow?.description?.trim();
  const flowWarnings =
    selectedFlow?.disabled && selectedFlow?.error ? [selectedFlow.error] : [];
  const flowInfoOpen = Boolean(flowInfoAnchorEl);
  const flowInfoId = flowInfoOpen ? 'flow-info-popover' : undefined;
  const flowInfoDisabled = flowsLoading || !selectedFlowName;
  const showFlowInfoButton = !flowsError;
  const flowInfoEmpty = !flowDescription && flowWarnings.length === 0;
  const flowInfoEmptyMessage =
    'No description or warnings are available for this flow yet.';
  const selectedFlowDisabled = Boolean(selectedFlow?.disabled);

  const flowConversations = useMemo(
    () => (selectedFlowName.trim() ? conversations : []),
    [conversations, selectedFlowName],
  );

  const selectedConversation = useMemo(
    () =>
      flowConversations.find(
        (conversation) => conversation.conversationId === activeConversationId,
      ),
    [activeConversationId, flowConversations],
  );
  const selectedFlowHasHistory = Boolean(selectedConversation);

  const resumeStepPath = useMemo(() => {
    const flags = selectedConversation?.flags;
    return readResumeStepPath(flags);
  }, [selectedConversation?.flags]);

  const turnsConversationId = persistenceUnavailable
    ? undefined
    : activeConversationId;

  const {
    turns,
    inflight: inflightSnapshot,
    isLoading: turnsLoading,
    isError: turnsError,
    error: turnsErrorMessage,
    refresh: refreshTurns,
    reset: resetTurns,
  } = useConversationTurns(turnsConversationId, {
    autoFetch: Boolean(turnsConversationId),
  });

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
            flowName: event.conversation.flowName,
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

  const wsTranscriptReady = wsConnectionState === 'open';

  const conversationListDisabled = persistenceUnavailable;

  const [drawerTopOffsetPx, setDrawerTopOffsetPx] = useState(0);
  const chatColumnRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const updateOffset = () => {
      const top = chatColumnRef.current?.getBoundingClientRect().top ?? 0;
      setDrawerTopOffsetPx(top);
    };

    updateOffset();
    window.addEventListener('resize', updateOffset);
    return () => window.removeEventListener('resize', updateOffset);
  }, [isMobile, flowsError, flowsLoading, persistenceUnavailable]);

  const drawerTopOffset =
    drawerTopOffsetPx > 0 ? `${drawerTopOffsetPx}px` : theme.spacing(3);
  const drawerHeight =
    drawerTopOffsetPx > 0
      ? `calc(100% - ${drawerTopOffsetPx}px)`
      : `calc(100% - ${theme.spacing(3)})`;

  useEffect(() => {
    if (isMobile) {
      setMobileDrawerOpen(false);
      return;
    }
    setDesktopDrawerOpen(true);
  }, [isMobile]);

  useEffect(() => {
    log('info', 'flows.ui.opened');
  }, [log]);

  const handleOpenDirPicker = () => {
    setDirPickerOpen(true);
  };

  const handlePickDir = (path: string) => {
    setWorkingFolder(path);
    log('info', 'flows.ui.working_folder.selected', { workingFolder: path });
    setDirPickerOpen(false);
  };

  const handleCloseDirPicker = () => {
    setDirPickerOpen(false);
  };

  const loadFlows = useCallback(async () => {
    setFlowsLoading(true);
    setFlowsError(null);
    try {
      const result = await listFlows();
      setFlows(result.flows);
      if (!selectedFlowName) {
        const firstAvailable = result.flows.find((flow) => !flow.disabled);
        if (firstAvailable) {
          setSelectedFlowName(firstAvailable.name);
        } else if (result.flows.length > 0) {
          setSelectedFlowName(result.flows[0].name);
        }
      }
    } catch (err) {
      setFlowsError((err as Error).message ?? 'Failed to load flows.');
      setFlows([]);
    } finally {
      setFlowsLoading(false);
    }
  }, [selectedFlowName]);

  useEffect(() => {
    void loadFlows();
  }, [loadFlows]);

  useEffect(() => {
    if (persistenceUnavailable) return;
    subscribeSidebar();
    return () => unsubscribeSidebar();
  }, [persistenceUnavailable, subscribeSidebar, unsubscribeSidebar]);

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

  const makeClientConversationId = () =>
    crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);

  useEffect(() => {
    if (!selectedFlowName.trim()) return;
    if (!activeConversationId && flowConversations.length > 0) {
      const first = flowConversations[0];
      setActiveConversationId(first.conversationId);
      setConversation(first.conversationId, { clearMessages: true });
    }
  }, [
    activeConversationId,
    flowConversations,
    selectedFlowName,
    setConversation,
  ]);

  useEffect(() => {
    if (!selectedFlowName.trim()) return;
    if (!activeConversationId) return;
    const stillVisible = flowConversations.some(
      (conversation) => conversation.conversationId === activeConversationId,
    );
    if (stillVisible) return;
    resetTurns();
    setActiveConversationId(undefined);
    setConversation(makeClientConversationId(), { clearMessages: true });
  }, [
    activeConversationId,
    flowConversations,
    resetTurns,
    selectedFlowName,
    setConversation,
  ]);

  useEffect(() => {
    if (!selectedConversation?.model) return;
    if (selectedConversation.model !== flowModelId) {
      setFlowModelId(selectedConversation.model);
    }
  }, [flowModelId, selectedConversation?.model]);

  useEffect(() => {
    if (!activeConversationId || !inflightSnapshot) return;
    hydrateInflightSnapshot(activeConversationId, inflightSnapshot);
  }, [activeConversationId, hydrateInflightSnapshot, inflightSnapshot]);

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
            id:
              typeof turn.turnId === 'string' && turn.turnId.trim().length > 0
                ? `turn-${turn.turnId}`
                : `${turn.createdAt}-${turn.role}-${turn.provider}`,
            role: turn.role === 'system' ? 'assistant' : turn.role,
            content: turn.content,
            tools: mapToolCalls(turn.toolCalls ?? null),
            streamStatus: turn.status === 'failed' ? 'failed' : 'complete',
            command: turn.command,
            usage: turn.usage,
            timing: turn.timing,
            createdAt: turn.createdAt,
          }) satisfies ChatMessage,
      ),
    [mapToolCalls],
  );

  const lastHydratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeConversationId) return;
    const oldest = turns?.[0]?.createdAt ?? 'none';
    const newest = turns?.[turns.length - 1]?.createdAt ?? 'none';
    const key = `${activeConversationId}-${oldest}-${newest}-${turns.length}`;
    if (lastHydratedRef.current === key) return;
    lastHydratedRef.current = key;

    if (turns.length === 0 && messages.length > 0 && turnsLoading) {
      return;
    }

    hydrateHistory(activeConversationId, mapTurnsToMessages(turns), 'replace');
  }, [
    activeConversationId,
    hydrateHistory,
    mapTurnsToMessages,
    messages.length,
    turns,
    turnsLoading,
  ]);

  const resetConversation = useCallback(() => {
    stop();
    setStartPending(false);
    setRunError(null);
    resetTurns();
    setActiveConversationId(undefined);
    setConversation(makeClientConversationId(), { clearMessages: true });
    setFlowModelId('unknown');
    setWorkingFolder('');
    setCustomTitle('');
  }, [resetTurns, setConversation, stop]);

  const handleFlowChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      if (next === selectedFlowName) return;
      setSelectedFlowName(next);
      resetConversation();
    },
    [resetConversation, selectedFlowName],
  );

  const handleFlowInfoOpen = (event: MouseEvent<HTMLElement>) => {
    if (flowInfoDisabled) return;
    setFlowInfoAnchorEl(event.currentTarget);
    log('info', 'flows.ui.info_popover.opened', {
      flowName: selectedFlowName,
      hasWarnings: flowWarnings.length > 0,
      hasDescription: Boolean(flowDescription),
    });
  };
  const handleFlowInfoClose = () => {
    setFlowInfoAnchorEl(null);
  };

  const handleCustomTitleBlur = () => {
    log('info', 'flows.ui.custom_title.updated', {
      customTitleLength: customTitle.length,
    });
  };

  const handleSelectConversation = (conversationId: string) => {
    if (conversationId === activeConversationId) return;
    stop();
    resetTurns();
    setConversation(conversationId, { clearMessages: true });
    const summary = flowConversations.find(
      (conversation) => conversation.conversationId === conversationId,
    );
    if (summary?.model) {
      setFlowModelId(summary.model);
    }
    setActiveConversationId(conversationId);
  };

  const handleStopClick = useCallback(() => {
    if (!selectedFlowName) return;
    log('info', 'flows.ui.stop_clicked', { flowName: selectedFlowName });
    const inflightId = getInflightId();
    const conversationId = getConversationId() ?? activeConversationId;

    if (conversationId && inflightId) {
      cancelInflight(conversationId, inflightId);
    }

    stop({ showStatusBubble: true });
  }, [
    activeConversationId,
    cancelInflight,
    getConversationId,
    getInflightId,
    log,
    selectedFlowName,
    stop,
  ]);

  const startFlowRun = useCallback(
    async (mode: 'run' | 'resume') => {
      if (!selectedFlowName || selectedFlowDisabled) return;
      setRunError(null);
      if (persistenceUnavailable || !wsTranscriptReady) {
        setRunError(
          'Realtime connection unavailable — Flow runs require WebSocket streaming.',
        );
        return;
      }
      if (mode === 'resume' && !resumeStepPath) return;

      log(
        'info',
        mode === 'resume' ? 'flows.ui.resume_clicked' : 'flows.ui.run_clicked',
        { flowName: selectedFlowName },
      );

      stop();
      setStartPending(true);

      const nextConversationId =
        activeConversationId && activeConversationId.trim().length > 0
          ? activeConversationId
          : makeClientConversationId();
      const isNewConversation = nextConversationId !== activeConversationId;

      if (isNewConversation) {
        setConversation(nextConversationId, { clearMessages: true });
        setActiveConversationId(nextConversationId);
      }

      subscribeConversation(nextConversationId);

      try {
        const result = await runFlow({
          flowName: selectedFlowName,
          conversationId: nextConversationId,
          working_folder: workingFolder.trim() || undefined,
          resumeStepPath: mode === 'resume' ? resumeStepPath : undefined,
        });
        setActiveConversationId(result.conversationId);
        if (result.modelId) {
          setFlowModelId(result.modelId);
        }
        await refreshConversations();
      } catch (err) {
        if (
          err instanceof FlowApiError &&
          err.status === 409 &&
          err.code === 'RUN_IN_PROGRESS'
        ) {
          const errorMessage: ChatMessage = {
            id: makeClientConversationId(),
            role: 'assistant',
            content:
              'This flow conversation already has a run in progress in another tab/window. Please wait for it to finish or press Stop in the other tab.',
            kind: 'error',
            streamStatus: 'failed',
            createdAt: new Date().toISOString(),
          };
          hydrateHistory(
            nextConversationId,
            [...messages, errorMessage],
            'replace',
          );
          setRunError(errorMessage.content);
          return;
        }
        const message = (err as Error).message || 'Failed to run flow.';
        const errorMessage: ChatMessage = {
          id: makeClientConversationId(),
          role: 'assistant',
          content: message,
          kind: 'error',
          streamStatus: 'failed',
          createdAt: new Date().toISOString(),
        };
        hydrateHistory(
          nextConversationId,
          [...messages, errorMessage],
          'replace',
        );
        setRunError(message);
      } finally {
        setStartPending(false);
      }
    },
    [
      activeConversationId,
      hydrateHistory,
      log,
      messages,
      persistenceUnavailable,
      refreshConversations,
      resumeStepPath,
      selectedFlowDisabled,
      selectedFlowName,
      setConversation,
      stop,
      subscribeConversation,
      workingFolder,
      wsTranscriptReady,
    ],
  );

  const isSending = startPending || isStreaming || status === 'sending';
  const showStop = isSending;
  const customTitleDisabled =
    isSending || Boolean(resumeStepPath) || selectedFlowHasHistory;

  return (
    <Container
      maxWidth={false}
      data-testid="flows-page"
      sx={{
        pt: 3,
        pb: 6,
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
        {flowsError && (
          <Alert severity="error" data-testid="flows-error">
            {flowsError}
          </Alert>
        )}
        {mongoConnected === false && (
          <Alert severity="warning" data-testid="flows-persistence-banner">
            Conversation persistence is currently unavailable. Flow runs require
            MongoDB to resume and stream.
          </Alert>
        )}
        {!persistenceUnavailable && !wsTranscriptReady && (
          <Alert severity="warning" data-testid="flows-ws-banner">
            Realtime connection unavailable — Flows require an open WebSocket
            connection.
          </Alert>
        )}
        {runError && (
          <Alert severity="error" data-testid="flows-run-error">
            {runError}
          </Alert>
        )}

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems="stretch"
          sx={{
            width: '100%',
            minWidth: 0,
            overflowX: 'hidden',
            flex: 1,
            minHeight: 0,
          }}
        >
          {(!isMobile || drawerOpen) && (
            <Drawer
              key={isMobile ? 'mobile' : 'desktop'}
              open={drawerOpen}
              onClose={() => {
                if (isMobile) {
                  setMobileDrawerOpen(false);
                  return;
                }
                setDesktopDrawerOpen(false);
              }}
              variant={isMobile ? 'temporary' : 'persistent'}
              ModalProps={{ keepMounted: false }}
              data-testid="conversation-drawer"
              slotProps={{
                paper: {
                  sx: {
                    boxSizing: 'border-box',
                    overflowX: 'hidden',
                    width: drawerWidth,
                    mt: drawerTopOffset,
                    height: drawerHeight,
                  },
                },
              }}
              sx={{
                width: isMobile ? undefined : drawerOpen ? drawerWidth : 0,
                flexShrink: 0,
              }}
            >
              <Box
                id="conversation-drawer"
                data-testid="conversation-list"
                sx={{ width: drawerWidth, height: '100%' }}
              >
                <ConversationList
                  conversations={flowConversations}
                  selectedId={activeConversationId}
                  isLoading={conversationsLoading}
                  isError={conversationsError}
                  error={conversationsErrorMessage}
                  hasMore={conversationsHasMore}
                  filterState={filterState}
                  mongoConnected={mongoConnected}
                  disabled={conversationListDisabled}
                  variant="chat"
                  onSelect={handleSelectConversation}
                  onFilterChange={setFilterState}
                  onArchive={archiveConversation}
                  onRestore={restoreConversation}
                  onBulkArchive={bulkArchive}
                  onBulkRestore={bulkRestore}
                  onBulkDelete={bulkDelete}
                  onLoadMore={loadMoreConversations}
                  onRefresh={refreshConversations}
                  onRetry={refreshConversations}
                />
              </Box>
            </Drawer>
          )}

          <Box
            data-testid="flows-column"
            ref={chatColumnRef}
            sx={{
              flex: 1,
              minWidth: 0,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
            style={{
              minWidth: 0,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              flex: '1 1 0%',
              minHeight: 0,
            }}
          >
            <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
              <Box data-testid="flows-controls" style={{ flex: '0 0 auto' }}>
                <Stack spacing={2}>
                  <Stack direction="row" justifyContent="flex-start">
                    <IconButton
                      aria-label="Toggle conversations"
                      aria-controls="conversation-drawer"
                      aria-expanded={drawerOpen}
                      onClick={() => {
                        if (isMobile) {
                          setMobileDrawerOpen((prev) => !prev);
                          return;
                        }
                        setDesktopDrawerOpen((prev) => !prev);
                      }}
                      size="small"
                      data-testid="conversation-drawer-toggle"
                    >
                      <MenuIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    alignItems={{ xs: 'stretch', sm: 'center' }}
                  >
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label="Flow"
                      value={selectedFlowName}
                      onChange={handleFlowChange}
                      disabled={flowsLoading || !!flowsError}
                      inputProps={{ 'data-testid': 'flow-select' }}
                    >
                      {flows.map((flow) => (
                        <MenuItem
                          key={flow.name}
                          value={flow.name}
                          disabled={flow.disabled}
                        >
                          {flow.name}
                        </MenuItem>
                      ))}
                    </TextField>
                    {showFlowInfoButton ? (
                      <Tooltip title="Flow info">
                        <span>
                          <IconButton
                            aria-describedby={flowInfoId}
                            onClick={handleFlowInfoOpen}
                            disabled={flowInfoDisabled}
                            size="small"
                            data-testid="flow-info"
                          >
                            <InfoOutlinedIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    ) : null}
                  </Stack>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    alignItems={{ xs: 'stretch', sm: 'flex-start' }}
                  >
                    <TextField
                      fullWidth
                      size="small"
                      label="Working folder"
                      value={workingFolder}
                      onChange={(event) => setWorkingFolder(event.target.value)}
                      inputProps={{ 'data-testid': 'flow-working-folder' }}
                    />
                    <Button
                      type="button"
                      variant="outlined"
                      size="small"
                      onClick={handleOpenDirPicker}
                      data-testid="flow-working-folder-picker"
                      sx={{ flexShrink: 0 }}
                    >
                      Choose folder…
                    </Button>
                  </Stack>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    alignItems={{ xs: 'stretch', sm: 'flex-start' }}
                  >
                    <TextField
                      fullWidth
                      size="small"
                      label="Custom title"
                      value={customTitle}
                      onChange={(event) => setCustomTitle(event.target.value)}
                      onBlur={handleCustomTitleBlur}
                      helperText="Optional: name for this run"
                      disabled={customTitleDisabled}
                      inputProps={{ 'data-testid': 'flow-custom-title' }}
                    />
                  </Stack>
                  <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                    <Button
                      type="button"
                      variant="outlined"
                      onClick={() => startFlowRun('run')}
                      disabled={
                        !selectedFlowName ||
                        flowsLoading ||
                        selectedFlowDisabled ||
                        startPending ||
                        persistenceUnavailable ||
                        !wsTranscriptReady
                      }
                      data-testid="flow-run"
                    >
                      Run
                    </Button>
                    <Button
                      type="button"
                      variant="outlined"
                      onClick={() => startFlowRun('resume')}
                      disabled={
                        !selectedFlowName ||
                        flowsLoading ||
                        selectedFlowDisabled ||
                        startPending ||
                        !resumeStepPath ||
                        persistenceUnavailable ||
                        !wsTranscriptReady
                      }
                      data-testid="flow-resume"
                    >
                      Resume
                    </Button>
                    <Button
                      type="button"
                      variant="outlined"
                      onClick={handleStopClick}
                      disabled={!showStop}
                      data-testid="flow-stop"
                    >
                      Stop
                    </Button>
                  </Stack>
                  {resumeStepPath && (
                    <Typography
                      color="text.secondary"
                      variant="caption"
                      data-testid="flow-resume-path"
                    >
                      Resume step path: {resumeStepPath.join(' / ')}
                    </Typography>
                  )}
                  <DirectoryPickerDialog
                    open={dirPickerOpen}
                    path={workingFolder}
                    onClose={handleCloseDirPicker}
                    onPick={handlePickDir}
                  />
                  <Popover
                    id={flowInfoId}
                    open={flowInfoOpen}
                    anchorEl={flowInfoAnchorEl}
                    onClose={handleFlowInfoClose}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                    transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                    data-testid="flow-info-popover"
                  >
                    <Stack spacing={1} sx={{ p: 2, maxWidth: 360 }}>
                      {flowWarnings.length > 0 ? (
                        <Stack spacing={0.5} data-testid="flow-warnings">
                          <Typography variant="subtitle2" color="warning.main">
                            Warnings
                          </Typography>
                          {flowWarnings.map((warning) => (
                            <Typography
                              key={warning}
                              variant="body2"
                              color="warning.main"
                            >
                              {warning}
                            </Typography>
                          ))}
                        </Stack>
                      ) : null}
                      {flowDescription ? (
                        <Paper
                          variant="outlined"
                          sx={{ p: 1.5 }}
                          data-testid="flow-description"
                        >
                          <Markdown content={flowDescription} />
                        </Paper>
                      ) : null}
                      {flowInfoEmpty ? (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          data-testid="flow-info-empty"
                        >
                          {flowInfoEmptyMessage}
                        </Typography>
                      ) : null}
                    </Stack>
                  </Popover>
                </Stack>
              </Box>

              <Paper
                variant="outlined"
                sx={{
                  flex: '1 1 auto',
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  p: 2,
                }}
              >
                <Box
                  data-testid="flows-transcript"
                  style={{
                    flex: '1 1 0%',
                    minHeight: 0,
                    overflowY: 'auto',
                  }}
                  sx={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    pr: 1,
                    minWidth: 0,
                  }}
                >
                  <Stack spacing={1} sx={{ minHeight: 0 }}>
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
                      <Alert severity="warning" data-testid="flows-turns-error">
                        {turnsErrorMessage ??
                          'Failed to load conversation history.'}
                      </Alert>
                    )}
                    {flowsLoading && flows.length === 0 && (
                      <Typography color="text.secondary">
                        Loading flows...
                      </Typography>
                    )}
                    {!flowsLoading && flows.length === 0 && (
                      <Typography color="text.secondary">
                        No flows found. Add a flow JSON file under `flows/` to
                        get started.
                      </Typography>
                    )}
                    {displayMessages.length === 0 && flows.length > 0 && (
                      <Typography color="text.secondary">
                        Transcript will appear here once a flow run starts.
                      </Typography>
                    )}

                    {displayMessages.map((message) => {
                      const alignSelf =
                        message.role === 'user' ? 'flex-end' : 'flex-start';
                      const isErrorBubble = message.kind === 'error';
                      const isStatusBubble = message.kind === 'status';
                      const isUser = message.role === 'user';
                      const showMetadata = !isErrorBubble && !isStatusBubble;
                      const timestampLabel = showMetadata
                        ? formatBubbleTimestamp(message.createdAt)
                        : null;
                      const usageLine =
                        message.role === 'assistant'
                          ? buildUsageLine(message.usage)
                          : null;
                      const timingLine =
                        message.role === 'assistant'
                          ? buildTimingLine(message.timing)
                          : null;
                      const stepLine =
                        message.role === 'assistant'
                          ? buildStepLine(message.command)
                          : null;
                      const flowLine =
                        message.role === 'assistant'
                          ? buildFlowMetaLine(message.command)
                          : null;
                      const metadataColor = isUser
                        ? 'inherit'
                        : 'text.secondary';
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
                                {showMetadata && timestampLabel && (
                                  <Stack spacing={0.25}>
                                    <Typography
                                      variant="caption"
                                      color={metadataColor}
                                      data-testid="bubble-timestamp"
                                    >
                                      {timestampLabel}
                                    </Typography>
                                    {usageLine && (
                                      <Typography
                                        variant="caption"
                                        color={metadataColor}
                                        data-testid="bubble-tokens"
                                      >
                                        {usageLine}
                                      </Typography>
                                    )}
                                    {timingLine && (
                                      <Typography
                                        variant="caption"
                                        color={metadataColor}
                                        data-testid="bubble-timing"
                                      >
                                        {timingLine}
                                      </Typography>
                                    )}
                                    {stepLine && (
                                      <Typography
                                        variant="caption"
                                        color={metadataColor}
                                        data-testid="bubble-step"
                                      >
                                        {stepLine}
                                      </Typography>
                                    )}
                                    {flowLine && (
                                      <Typography
                                        variant="caption"
                                        color={metadataColor}
                                        data-testid="bubble-flow-meta"
                                      >
                                        {flowLine}
                                      </Typography>
                                    )}
                                  </Stack>
                                )}
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

                                {message.role === 'assistant' ? (
                                  <Markdown content={message.content ?? ''} />
                                ) : (
                                  <Typography
                                    variant="body1"
                                    component="div"
                                    sx={{ whiteSpace: 'pre-wrap' }}
                                  >
                                    {message.content}
                                  </Typography>
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
          </Box>
        </Stack>
      </Stack>
    </Container>
  );
}
