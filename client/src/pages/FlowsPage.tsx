import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import {
  Alert,
  Box,
  Button,
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
import {
  FlowApiError,
  type FlowSummary,
  listFlows,
  runFlow,
} from '../api/flows';
import Markdown from '../components/Markdown';
import ConversationList from '../components/chat/ConversationList';
import SharedTranscript from '../components/chat/SharedTranscript';
import DirectoryPickerDialog from '../components/ingest/DirectoryPickerDialog';
import useChatStream, { ChatMessage, ToolCall } from '../hooks/useChatStream';
import useChatWs, { type ChatWsServerEvent } from '../hooks/useChatWs';
import useConversationTurns, {
  StoredTurn,
} from '../hooks/useConversationTurns';
import useConversations from '../hooks/useConversations';
import usePersistenceStatus from '../hooks/usePersistenceStatus';
import { createLogger } from '../logging/logger';

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

const buildFlowLabel = (flow: FlowSummary) => {
  const sourceLabel = flow.sourceLabel?.trim();
  return sourceLabel ? `${flow.name} - [${sourceLabel}]` : flow.name;
};

const buildFlowKey = (flow: FlowSummary) =>
  `${flow.name}::${flow.sourceId ?? 'local'}`;

type FlowOption = FlowSummary & { key: string; label: string };

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

const isVisibleAssistantMessage = (message: ChatMessage | undefined) => {
  if (!message) return false;
  if (message.role !== 'assistant') return false;
  if (message.kind === 'error' || message.kind === 'status') return false;
  if (message.content.trim().length > 0) return true;
  if (message.think?.trim().length) return true;
  if ((message.tools?.length ?? 0) > 0) return true;
  return false;
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

  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [flowsLoading, setFlowsLoading] = useState(true);
  const [flowsError, setFlowsError] = useState<string | null>(null);
  const [selectedFlowKey, setSelectedFlowKey] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [suppressAutoSelect, setSuppressAutoSelect] = useState(false);
  const [flowInfoAnchorEl, setFlowInfoAnchorEl] = useState<HTMLElement | null>(
    null,
  );

  const [workingFolder, setWorkingFolder] = useState('');
  const selectedConversationIdRef = useRef<string | undefined>(undefined);
  const workingFolderDisabledRef = useRef(false);
  const workingFolderRestoreKeyRef = useRef<string | null>(null);
  const workingFolderLockKeyRef = useRef<string | null>(null);
  const [dirPickerOpen, setDirPickerOpen] = useState(false);
  const [startPending, setStartPending] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [flowModelId, setFlowModelId] = useState('unknown');

  const log = useMemo(() => createLogger('client-flows'), []);
  const assistantTranscriptVisibleRef = useRef(false);
  const serverVisibleInflightIdRef = useRef<string | null>(null);
  const stoppingVisibleLoggedRef = useRef<string | null>(null);
  const stoppedVisibleLoggedRef = useRef<Set<string>>(new Set());
  const seenFlowInflightIdsRef = useRef<Set<string>>(new Set());
  const lastFlowInflightIdRef = useRef<string | null>(null);
  const hiddenConversationLogKeyRef = useRef<string | null>(null);
  const pendingTranscriptRetentionRef = useRef<
    Array<{
      conversationId: string;
      previousInflightId: string;
      currentInflightId: string;
      previousAssistantMessageId: string;
    }>
  >([]);

  const flowOptions = useMemo<FlowOption[]>(() => {
    const options = flows.map((flow) => ({
      ...flow,
      key: buildFlowKey(flow),
      label: buildFlowLabel(flow),
    }));
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [flows]);

  const selectedFlow = useMemo(
    () => flowOptions.find((flow) => flow.key === selectedFlowKey),
    [flowOptions, selectedFlowKey],
  );
  const selectedFlowName = selectedFlow?.name ?? '';

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
    readWorkingFolder,
    updateWorkingFolder,
    emitWorkingFolderPickerSync,
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
    reset,
    setConversation,
    hydrateHistory,
    hydrateInflightSnapshot,
    handleWsEvent,
    getInflightId,
    getConversationId,
    getAssistantMessageIdForInflight,
  } = useChatStream(flowModelId, 'codex');

  const displayMessages = useMemo<ChatMessage[]>(
    () => [...messages].reverse(),
    [messages],
  );
  const hasFlowMetaLine = useMemo(
    () =>
      displayMessages.some(
        (message) =>
          message.role === 'assistant' &&
          buildFlowMetaLine(message.command) !== null,
      ),
    [displayMessages],
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

  useEffect(() => {
    assistantTranscriptVisibleRef.current = messages.some((message) =>
      isVisibleAssistantMessage(message),
    );
  }, [messages]);

  useEffect(() => {
    seenFlowInflightIdsRef.current.clear();
    lastFlowInflightIdRef.current = null;
    hiddenConversationLogKeyRef.current = null;
    pendingTranscriptRetentionRef.current = [];
    serverVisibleInflightIdRef.current = null;
    stoppingVisibleLoggedRef.current = null;
  }, [activeConversationId]);

  const updateLiveTranscriptRetentionCandidate = useCallback(
    (event: ChatWsServerEvent) => {
      if (event.type !== 'user_turn' && event.type !== 'inflight_snapshot') {
        return;
      }

      const currentInflightId =
        event.type === 'inflight_snapshot'
          ? event.inflight.inflightId
          : event.inflightId;
      if (!currentInflightId) return;

      const seenInflights = seenFlowInflightIdsRef.current;
      const activeInflightId = getInflightId();
      const previousInflightId =
        lastFlowInflightIdRef.current ?? activeInflightId ?? null;

      if (
        !seenInflights.has(currentInflightId) &&
        previousInflightId &&
        previousInflightId !== currentInflightId &&
        assistantTranscriptVisibleRef.current
      ) {
        const previousAssistantMessageId =
          getAssistantMessageIdForInflight(previousInflightId);
        if (!previousAssistantMessageId) {
          return;
        }
        const hasPendingCandidate = pendingTranscriptRetentionRef.current.some(
          (candidate) => candidate.currentInflightId === currentInflightId,
        );
        if (!hasPendingCandidate) {
          pendingTranscriptRetentionRef.current.push({
            conversationId: event.conversationId,
            previousInflightId,
            currentInflightId,
            previousAssistantMessageId,
          });
        }
      }

      const isNewInflight = !seenInflights.has(currentInflightId);
      if (isNewInflight) {
        seenInflights.add(currentInflightId);
        lastFlowInflightIdRef.current = currentInflightId;
        return;
      }

      if (activeInflightId === currentInflightId) {
        lastFlowInflightIdRef.current = currentInflightId;
      }
    },
    [getAssistantMessageIdForInflight, getInflightId],
  );

  useEffect(() => {
    if (pendingTranscriptRetentionRef.current.length === 0) return;

    while (pendingTranscriptRetentionRef.current.length > 0) {
      const nextRetention = pendingTranscriptRetentionRef.current[0];
      if (nextRetention.conversationId !== activeConversationId) {
        pendingTranscriptRetentionRef.current.shift();
        continue;
      }

      const previousAssistantMessage = messages.find(
        (message) => message.id === nextRetention.previousAssistantMessageId,
      );
      const currentAssistantMessageId = getAssistantMessageIdForInflight(
        nextRetention.currentInflightId,
      );
      const currentAssistantMessage = messages.find(
        (message) => message.id === currentAssistantMessageId,
      );

      if (!isVisibleAssistantMessage(previousAssistantMessage)) {
        pendingTranscriptRetentionRef.current.shift();
        continue;
      }

      const activeInflightId = getInflightId();
      if (!isVisibleAssistantMessage(currentAssistantMessage)) {
        if (activeInflightId !== nextRetention.currentInflightId) {
          pendingTranscriptRetentionRef.current.shift();
          continue;
        }
        return;
      }

      log('info', 'flows.page.live_transcript_retained', {
        conversationId: nextRetention.conversationId,
        previousInflightId: nextRetention.previousInflightId,
        currentInflightId: nextRetention.currentInflightId,
        reason: 'next_step_started',
        proof: 'post_event_transcript_visible',
      });
      pendingTranscriptRetentionRef.current.shift();
    }
  }, [
    activeConversationId,
    getAssistantMessageIdForInflight,
    getInflightId,
    log,
    messages,
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
          applyWsUpsert(event.conversation);
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
        case 'cancel_ack':
          if (event.type === 'inflight_snapshot') {
            serverVisibleInflightIdRef.current = event.inflight.inflightId;
          } else if (
            event.type !== 'cancel_ack' &&
            event.type !== 'turn_final' &&
            typeof event.inflightId === 'string'
          ) {
            serverVisibleInflightIdRef.current = event.inflightId;
          } else if (
            event.type === 'turn_final' &&
            serverVisibleInflightIdRef.current === event.inflightId
          ) {
            serverVisibleInflightIdRef.current = null;
          }
          updateLiveTranscriptRetentionCandidate(event);
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
  const qaLogSentRef = useRef(false);

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

  useEffect(() => {
    if (qaLogSentRef.current) return;
    if (flowsLoading) return;
    if (flowsError) return;
    qaLogSentRef.current = true;
    log('info', 'flows.qa.validation_ready', { flowCount: flows.length });
  }, [flows.length, flowsError, flowsLoading, log]);

  const persistWorkingFolder = useCallback(
    async (nextValue?: string) => {
      const trimmedWorkingFolder = (nextValue ?? workingFolder).trim();
      setWorkingFolder(trimmedWorkingFolder);
      if (
        !selectedConversationIdRef.current ||
        workingFolderDisabledRef.current
      ) {
        return;
      }
      try {
        await updateWorkingFolder({
          conversationId: selectedConversationIdRef.current,
          workingFolder: trimmedWorkingFolder || null,
          surface: 'flows',
        });
      } catch (error) {
        console.error('flow working-folder persistence failed', error);
      }
    },
    [updateWorkingFolder, workingFolder],
  );

  const handleOpenDirPicker = () => {
    if (workingFolderDisabledRef.current) return;
    setDirPickerOpen(true);
  };

  const handlePickDir = (path: string) => {
    const trimmedWorkingFolder = path.trim();
    setWorkingFolder(trimmedWorkingFolder);
    log('info', 'flows.ui.working_folder.selected', {
      workingFolder: trimmedWorkingFolder,
    });
    setDirPickerOpen(false);
    void persistWorkingFolder(trimmedWorkingFolder);
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
      const flowKeys = result.flows.map((flow) => buildFlowKey(flow));
      if (!selectedFlowKey || !flowKeys.includes(selectedFlowKey)) {
        const firstAvailable = result.flows.find((flow) => !flow.disabled);
        if (firstAvailable) {
          setSelectedFlowKey(buildFlowKey(firstAvailable));
        } else if (result.flows.length > 0) {
          setSelectedFlowKey(buildFlowKey(result.flows[0]));
        } else {
          setSelectedFlowKey('');
        }
      }
    } catch (err) {
      setFlowsError((err as Error).message ?? 'Failed to load flows.');
      setFlows([]);
    } finally {
      setFlowsLoading(false);
    }
  }, [selectedFlowKey]);

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
    if (suppressAutoSelect) return;
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
    suppressAutoSelect,
  ]);

  useEffect(() => {
    if (!selectedFlowName.trim()) return;
    if (!activeConversationId) return;
    const stillVisible = flowConversations.some(
      (conversation) => conversation.conversationId === activeConversationId,
    );
    if (stillVisible) {
      hiddenConversationLogKeyRef.current = null;
      return;
    }
    const hasVisibleAssistantTranscript = assistantTranscriptVisibleRef.current;
    const hasProcessingTranscript = messages.some(
      (message) => message.streamStatus === 'processing',
    );
    const shouldPreserveHiddenConversation =
      hasVisibleAssistantTranscript ||
      hasProcessingTranscript ||
      isStreaming ||
      startPending ||
      status === 'sending' ||
      status === 'stopping';
    const action = shouldPreserveHiddenConversation
      ? 'preserve_transcript'
      : 'clear_transcript';
    const hiddenLogKey = `${activeConversationId}:${selectedFlowName}:${action}`;
    const shouldLogHiddenTransition =
      hiddenConversationLogKeyRef.current !== hiddenLogKey;
    hiddenConversationLogKeyRef.current = hiddenLogKey;
    if (shouldPreserveHiddenConversation) {
      if (shouldLogHiddenTransition) {
        log('info', 'flows.page.active_conversation_temporarily_hidden', {
          conversationId: activeConversationId,
          selectedFlowName,
          flowConversationCount: flowConversations.length,
          messageCount: messages.length,
          hasVisibleAssistantTranscript,
          hasProcessingTranscript,
          isStreaming,
          status,
          action,
        });
      }
      return;
    }
    if (shouldLogHiddenTransition) {
      log('info', 'flows.page.active_conversation_hidden_reset', {
        conversationId: activeConversationId,
        selectedFlowName,
        flowConversationCount: flowConversations.length,
        messageCount: messages.length,
        hasVisibleAssistantTranscript,
        hasProcessingTranscript,
        isStreaming,
        status,
        action,
      });
    }
    resetTurns();
    setActiveConversationId(undefined);
    setConversation(reset(), { clearMessages: true });
    serverVisibleInflightIdRef.current = null;
    stoppingVisibleLoggedRef.current = null;
    setSuppressAutoSelect(false);
  }, [
    activeConversationId,
    flowConversations,
    isStreaming,
    log,
    messages,
    startPending,
    reset,
    resetTurns,
    selectedFlowName,
    setConversation,
    status,
  ]);

  useEffect(() => {
    if (!selectedConversation?.model) return;
    if (selectedConversation.model !== flowModelId) {
      setFlowModelId(selectedConversation.model);
    }
  }, [flowModelId, selectedConversation?.model]);

  useEffect(() => {
    if (!activeConversationId || !inflightSnapshot) return;
    serverVisibleInflightIdRef.current = inflightSnapshot.inflightId;
    hydrateInflightSnapshot(activeConversationId, inflightSnapshot);
  }, [activeConversationId, hydrateInflightSnapshot, inflightSnapshot]);

  useEffect(() => {
    if (!activeConversationId) {
      stoppingVisibleLoggedRef.current = null;
      return;
    }
    if (status !== 'stopping') {
      stoppingVisibleLoggedRef.current = null;
      return;
    }
    if (stoppingVisibleLoggedRef.current === activeConversationId) return;
    stoppingVisibleLoggedRef.current = activeConversationId;
    console.info('[stop-debug][flows-ui] stopping-visible', {
      conversationId: activeConversationId,
    });
  }, [activeConversationId, status]);

  useEffect(() => {
    displayMessages.forEach((message) => {
      if (
        message.role !== 'assistant' ||
        message.streamStatus !== 'stopped' ||
        stoppedVisibleLoggedRef.current.has(message.id)
      ) {
        return;
      }
      stoppedVisibleLoggedRef.current.add(message.id);
      console.info('[stop-debug][flows-ui] stopped-visible', {
        conversationId: activeConversationId ?? getConversationId(),
        turnId: message.id,
      });
    });
  }, [activeConversationId, displayMessages, getConversationId]);

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
            streamStatus:
              turn.status === 'failed'
                ? 'failed'
                : turn.status === 'stopped'
                  ? 'stopped'
                  : 'complete',
            command: turn.command,
            usage: turn.usage,
            timing: turn.timing,
            createdAt: turn.createdAt,
          }) satisfies ChatMessage,
      ),
    [mapToolCalls],
  );

  const lastHydratedRef = useRef<string | null>(null);
  const hydratedStatusLogKeysRef = useRef<Set<string>>(new Set());
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

    const hydratedMessages = mapTurnsToMessages(turns);
    hydratedMessages.forEach((message) => {
      if (message.role !== 'assistant' || !message.streamStatus) return;
      const logKey = `${activeConversationId}:${message.id}:${message.streamStatus}`;
      if (hydratedStatusLogKeysRef.current.has(logKey)) return;
      hydratedStatusLogKeysRef.current.add(logKey);
      log('info', 'DEV-0000049:T03:hydrated_persisted_turn_status', {
        conversationId: activeConversationId,
        turnId: message.id.startsWith('turn-')
          ? message.id.slice(5)
          : message.id,
        messageId: message.id,
        streamStatus: message.streamStatus,
        source: 'rest_hydration',
      });
    });

    hydrateHistory(activeConversationId, hydratedMessages, 'replace');
  }, [
    activeConversationId,
    hydrateHistory,
    log,
    mapTurnsToMessages,
    messages.length,
    turns,
    turnsLoading,
  ]);

  const resetConversation = useCallback(() => {
    setStartPending(false);
    setRunError(null);
    resetTurns();
    setActiveConversationId(undefined);
    setConversation(reset(), { clearMessages: true });
    setFlowModelId('unknown');
    setWorkingFolder('');
    setCustomTitle('');
    serverVisibleInflightIdRef.current = null;
    stoppingVisibleLoggedRef.current = null;
  }, [reset, resetTurns, setConversation]);

  const handleNewFlowReset = useCallback(() => {
    setSuppressAutoSelect(true);
    resetConversation();
    log('info', 'flows.ui.new_flow_reset', {
      selectedFlowName,
      clearedFields: [
        'activeConversationId',
        'messages',
        'resumeStepPath',
        'customTitle',
        'workingFolder',
      ],
    });
  }, [log, resetConversation, selectedFlowName, setSuppressAutoSelect]);

  const handleFlowChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      if (next === selectedFlowKey) return;
      setSelectedFlowKey(next);
      setSuppressAutoSelect(false);
      resetConversation();
    },
    [resetConversation, selectedFlowKey, setSuppressAutoSelect],
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
    resetTurns();
    setSuppressAutoSelect(false);
    setConversation(conversationId, { clearMessages: true });
    serverVisibleInflightIdRef.current = null;
    stoppingVisibleLoggedRef.current = null;
    const summary = flowConversations.find(
      (conversation) => conversation.conversationId === conversationId,
    );
    if (summary?.model) {
      setFlowModelId(summary.model);
    }
    setActiveConversationId(conversationId);
  };

  useEffect(() => {
    if (!selectedConversation?.conversationId) {
      workingFolderRestoreKeyRef.current = null;
      return;
    }

    const restoredWorkingFolder = readWorkingFolder(selectedConversation) ?? '';
    setWorkingFolder((current) =>
      current === restoredWorkingFolder ? current : restoredWorkingFolder,
    );

    const restoreKey = `${selectedConversation.conversationId}:${restoredWorkingFolder}`;
    if (workingFolderRestoreKeyRef.current === restoreKey) return;
    workingFolderRestoreKeyRef.current = restoreKey;
    emitWorkingFolderPickerSync({
      surface: 'flows',
      conversationId: selectedConversation.conversationId,
      action: restoredWorkingFolder ? 'restore' : 'clear',
      pickerState: restoredWorkingFolder,
    });
  }, [emitWorkingFolderPickerSync, readWorkingFolder, selectedConversation]);

  const handleStopClick = useCallback(() => {
    if (!selectedFlowName || !activeConversationId || status === 'stopping') {
      return;
    }
    log('info', 'flows.ui.stop_clicked', { flowName: selectedFlowName });
    const inflightId =
      inflightSnapshot?.inflightId ??
      serverVisibleInflightIdRef.current ??
      undefined;
    console.info('[stop-debug][flows-ui] stop-clicked', {
      conversationId: activeConversationId,
      ...(inflightId ? { inflightId } : {}),
    });
    const requestId = cancelInflight(activeConversationId, inflightId);
    stop({ requestId, showStatusBubble: true });
  }, [
    activeConversationId,
    cancelInflight,
    inflightSnapshot?.inflightId,
    log,
    selectedFlowName,
    status,
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

      setSuppressAutoSelect(false);

      log(
        'info',
        mode === 'resume' ? 'flows.ui.resume_clicked' : 'flows.ui.run_clicked',
        { flowName: selectedFlowName },
      );

      setStartPending(true);

      const nextConversationId =
        activeConversationId && activeConversationId.trim().length > 0
          ? activeConversationId
          : makeClientConversationId();
      const isNewConversation = nextConversationId !== activeConversationId;
      const trimmedCustomTitle = customTitle.trim();
      const shouldIncludeCustomTitle =
        mode === 'run' && isNewConversation && trimmedCustomTitle.length > 0;

      if (isNewConversation) {
        setConversation(nextConversationId, { clearMessages: true });
        setActiveConversationId(nextConversationId);
      }

      subscribeConversation(nextConversationId);

      try {
        log('info', 'DEV-0000034:T6:flows.run_payload', {
          flowName: selectedFlowName,
          sourceId: selectedFlow?.sourceId ?? 'local',
        });
        const result = await runFlow({
          flowName: selectedFlowName,
          sourceId: selectedFlow?.sourceId,
          conversationId: nextConversationId,
          customTitle: shouldIncludeCustomTitle
            ? trimmedCustomTitle
            : undefined,
          isNewConversation,
          mode,
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
      customTitle,
      hydrateHistory,
      log,
      messages,
      persistenceUnavailable,
      refreshConversations,
      resumeStepPath,
      selectedFlowDisabled,
      selectedFlow?.sourceId,
      selectedFlowName,
      setConversation,
      setSuppressAutoSelect,
      subscribeConversation,
      workingFolder,
      wsTranscriptReady,
    ],
  );

  const isSending = startPending || isStreaming || status === 'sending';
  const isStopping = status === 'stopping';
  const retainedAssistantVisible = useMemo(
    () =>
      displayMessages.some((message) => isVisibleAssistantMessage(message)) &&
      (isSending ||
        isStopping ||
        Boolean(inflightSnapshot?.inflightId) ||
        Boolean(serverVisibleInflightIdRef.current)),
    [displayMessages, inflightSnapshot?.inflightId, isSending, isStopping],
  );
  const flowWorkingFolderLocked =
    isSending ||
    isStopping ||
    Boolean(inflightSnapshot?.inflightId) ||
    Boolean(serverVisibleInflightIdRef.current);
  const isWorkingFolderDisabled =
    flowsLoading || !!flowsError || flowWorkingFolderLocked;
  const showStop = isSending || isStopping;
  const customTitleDisabled =
    isSending || Boolean(resumeStepPath) || selectedFlowHasHistory;

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversation?.conversationId;
  }, [selectedConversation?.conversationId]);

  useEffect(() => {
    workingFolderDisabledRef.current = isWorkingFolderDisabled;
  }, [isWorkingFolderDisabled]);

  useEffect(() => {
    if (!flowWorkingFolderLocked) {
      workingFolderLockKeyRef.current = null;
      return;
    }

    const conversationKey = activeConversationId ?? getConversationId();
    const lockKey = `${conversationKey}:${workingFolder.trim()}`;
    if (workingFolderLockKeyRef.current === lockKey) return;
    workingFolderLockKeyRef.current = lockKey;
    emitWorkingFolderPickerSync({
      surface: 'flows',
      conversationId: conversationKey,
      action: 'lock',
      pickerState: workingFolder.trim(),
    });
  }, [
    activeConversationId,
    emitWorkingFolderPickerSync,
    flowWorkingFolderLocked,
    getConversationId,
    workingFolder,
  ]);

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
                      value={selectedFlowKey}
                      onChange={handleFlowChange}
                      disabled={flowsLoading || !!flowsError}
                      inputProps={{ 'data-testid': 'flow-select' }}
                    >
                      {flowOptions.map((flow) => (
                        <MenuItem
                          key={flow.key}
                          value={flow.key}
                          disabled={flow.disabled}
                        >
                          {flow.label}
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
                      onBlur={(event) => {
                        void persistWorkingFolder(event.target.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        event.stopPropagation();
                        void persistWorkingFolder(
                          (event.currentTarget as HTMLInputElement).value,
                        );
                      }}
                      disabled={isWorkingFolderDisabled}
                      inputProps={{ 'data-testid': 'flow-working-folder' }}
                    />
                    <Button
                      type="button"
                      variant="outlined"
                      size="small"
                      onClick={handleOpenDirPicker}
                      disabled={isWorkingFolderDisabled}
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
                      onClick={handleNewFlowReset}
                      disabled={!selectedFlowName || flowsLoading}
                      data-testid="flow-new"
                    >
                      New Flow
                    </Button>
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
                      disabled={!showStop || isStopping}
                      data-testid="flow-stop"
                    >
                      {isStopping ? 'Stopping...' : 'Stop'}
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
                <SharedTranscript
                  surface="flows"
                  messages={displayMessages}
                  activeToolsAvailable={false}
                  turnsLoading={turnsLoading}
                  turnsError={turnsError}
                  turnsErrorMessage={turnsErrorMessage}
                  emptyMessage="Transcript will appear here once a flow run starts."
                  emptyStateContent={
                    flowsLoading && flows.length === 0 ? (
                      <Typography color="text.secondary">
                        Loading flows...
                      </Typography>
                    ) : !flowsLoading && flows.length === 0 ? (
                      <Typography color="text.secondary">
                        No flows found. Add a flow JSON file under `flows/` to
                        get started.
                      </Typography>
                    ) : undefined
                  }
                  warningTestId="flows-turns-error"
                  transcriptTestId="flows-transcript"
                  citationsEnabled={false}
                  isStopping={isStopping}
                  thinkOpen={{}}
                  toolOpen={{}}
                  toolErrorOpen={{}}
                  onToggleThink={() => {}}
                  onToggleTool={() => {}}
                  onToggleToolError={() => {}}
                  renderMetadataContent={(message) => {
                    const flowLine =
                      message.role === 'assistant'
                        ? buildFlowMetaLine(message.command)
                        : null;
                    if (!flowLine) {
                      return null;
                    }
                    return (
                      <Typography
                        variant="caption"
                        color={
                          message.role === 'user' ? 'inherit' : 'text.secondary'
                        }
                        data-testid="bubble-flow-meta"
                      >
                        {flowLine}
                      </Typography>
                    );
                  }}
                  sharedRenderLogConfig={{
                    eventName:
                      'DEV-0000049:T05:flows_shared_transcript_rendered',
                    context: {
                      hasTurnsError: turnsError,
                      retainedAssistantVisible,
                      hasFlowMetaLine,
                      citationsVisible: false,
                    },
                  }}
                />
              </Paper>
            </Stack>
          </Box>
        </Stack>
      </Stack>
    </Container>
  );
}
