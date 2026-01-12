import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import MenuIcon from '@mui/icons-material/Menu';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Container,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import { useTheme } from '@mui/material/styles';
import {
  FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  listAgentCommands,
  listAgents,
  runAgentCommand,
  runAgentInstruction,
  AgentApiError,
} from '../api/agents';
import Markdown from '../components/Markdown';
import ConversationList from '../components/chat/ConversationList';
import useChatStream, {
  type ChatMessage,
  type ToolCall,
} from '../hooks/useChatStream';
import useChatWs, {
  type ChatWsServerEvent,
  type ChatWsTranscriptEvent,
} from '../hooks/useChatWs';
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

export default function AgentsPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const drawerWidth = 320;
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);
  const [desktopDrawerOpen, setDesktopDrawerOpen] = useState<boolean>(() =>
    isMobile ? false : true,
  );
  const drawerOpen = isMobile ? mobileDrawerOpen : desktopDrawerOpen;

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

  const [agentModelId, setAgentModelId] = useState<string>('unknown');
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
  } = useChatStream(agentModelId, 'codex');

  const displayMessages = useMemo<ChatMessage[]>(
    () => [...messages].reverse(),
    [messages],
  );

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [workingFolder, setWorkingFolder] = useState('');
  const [input, setInput] = useState('');
  const lastSentRef = useRef('');

  const [startPending, setStartPending] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const [thinkOpen, setThinkOpen] = useState<Record<string, boolean>>({});
  const [toolOpen, setToolOpen] = useState<Record<string, boolean>>({});
  const [toolErrorOpen, setToolErrorOpen] = useState<Record<string, boolean>>(
    {},
  );
  const metadataLoggedRef = useRef(new Set<string>());
  const stepLoggedRef = useRef(new Set<string>());

  const citationsReadyLoggedRef = useRef<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const chatColumnRef = useRef<HTMLDivElement | null>(null);
  const [drawerTopOffsetPx, setDrawerTopOffsetPx] = useState<number>(0);

  const { mongoConnected, isLoading: persistenceLoading } =
    usePersistenceStatus();
  const persistenceUnavailable = mongoConnected === false;

  useLayoutEffect(() => {
    const updateOffset = () => {
      const top = chatColumnRef.current?.getBoundingClientRect().top ?? 0;
      setDrawerTopOffsetPx(top);
    };

    updateOffset();
    window.addEventListener('resize', updateOffset);
    return () => window.removeEventListener('resize', updateOffset);
  }, [isMobile, persistenceUnavailable, agentsError, agentsLoading]);

  const drawerTopOffset =
    drawerTopOffsetPx > 0 ? `${drawerTopOffsetPx}px` : theme.spacing(3);
  const drawerHeight =
    drawerTopOffsetPx > 0
      ? `calc(100% - ${drawerTopOffsetPx}px)`
      : `calc(100% - ${theme.spacing(3)})`;

  const log = useMemo(() => createLogger('client'), []);

  useEffect(() => {
    displayMessages.forEach((message) => {
      const isErrorBubble = message.kind === 'error';
      const isStatusBubble = message.kind === 'status';
      const showMetadata = !isErrorBubble && !isStatusBubble;
      if (!showMetadata) return;

      const timestampLabel = formatBubbleTimestamp(message.createdAt);
      const usageLine =
        message.role === 'assistant' ? buildUsageLine(message.usage) : null;
      const timingLine =
        message.role === 'assistant' ? buildTimingLine(message.timing) : null;
      const stepLine =
        message.role === 'assistant' ? buildStepLine(message.command) : null;

      if (
        message.role === 'assistant' &&
        timestampLabel &&
        (usageLine || timingLine) &&
        !metadataLoggedRef.current.has(message.id)
      ) {
        metadataLoggedRef.current.add(message.id);
        log('info', 'DEV-0000024:T9:ui_metadata_rendered', {
          messageId: message.id,
          role: message.role,
          hasTokenLine: Boolean(usageLine),
          hasTimingLine: Boolean(timingLine),
          hasTimestamp: true,
        });
      }

      if (stepLine && !stepLoggedRef.current.has(message.id)) {
        stepLoggedRef.current.add(message.id);
        log('info', 'DEV-0000024:T9:ui_step_indicator', {
          messageId: message.id,
          role: message.role,
          stepIndex: message.command?.stepIndex,
          totalSteps: message.command?.totalSteps,
        });
      }
    });
  }, [displayMessages, log]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => {
      log('info', 'DEV-0000024:T10:manual_validation_complete', {
        page: 'agents',
        selectedAgentName,
      });
    };
    window.addEventListener('codeinfo:manual-validation-complete', handler);
    return () =>
      window.removeEventListener(
        'codeinfo:manual-validation-complete',
        handler,
      );
  }, [log, selectedAgentName]);

  const unificationReadyLoggedRef = useRef(false);

  useEffect(() => {
    if (unificationReadyLoggedRef.current) return;
    if (!selectedAgentName) return;

    unificationReadyLoggedRef.current = true;
    log('info', 'DEV-0000021[T9] agents.unification ready', {
      selectedAgentName,
      activeConversationId,
    });
  }, [activeConversationId, log, selectedAgentName]);

  useEffect(() => {
    const variant = isMobile ? 'temporary' : 'persistent';
    log('info', 'DEV-0000021[T8] agents.layout drawer variant', {
      isMobile,
      variant,
    });
  }, [isMobile, log]);

  useEffect(() => {
    log('info', '0000023 drawer overflow guard applied', {
      page: 'agents',
      drawerWidth,
      overflowX: 'hidden',
      boxSizing: 'border-box',
    });
  }, [drawerWidth, log]);

  useEffect(() => {
    if (isMobile) {
      setMobileDrawerOpen(false);
      return;
    }

    setDesktopDrawerOpen(true);
  }, [isMobile]);

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
  const selectedAgentNameRef = useRef<string>(selectedAgentName);

  useEffect(() => {
    selectedAgentNameRef.current = selectedAgentName;
  }, [selectedAgentName]);

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
  } = useConversations({ agentName: effectiveAgentName });

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
  } = useConversationTurns(turnsConversationId);

  const refreshSnapshots = useCallback(async () => {
    if (persistenceUnavailable) return;
    await Promise.all([
      refreshConversations(),
      activeConversationId ? refreshTurns() : Promise.resolve(),
    ]);
  }, [
    activeConversationId,
    persistenceUnavailable,
    refreshConversations,
    refreshTurns,
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
    modelId: agentModelId,
    onReconnectBeforeResubscribe: async () => {
      if (mongoConnected === false) return;
      await refreshSnapshots();
    },
    onEvent: (event: ChatWsServerEvent) => {
      switch (event.type) {
        case 'conversation_upsert': {
          const conversationAgentName = event.conversation.agentName;
          if (conversationAgentName !== selectedAgentName) return;

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

          log('info', 'DEV-0000021[T7] agents.sidebar conversation_upsert', {
            selectedAgentName,
            conversationId: event.conversation.conversationId,
          });
          return;
        }
        case 'conversation_delete': {
          applyWsDelete(event.conversationId);
          log('info', 'DEV-0000021[T7] agents.sidebar conversation_delete', {
            selectedAgentName,
            conversationId: event.conversationId,
          });
          return;
        }
        case 'user_turn':
        case 'inflight_snapshot':
        case 'assistant_delta':
        case 'analysis_delta':
        case 'tool_event':
        case 'stream_warning':
        case 'turn_final': {
          const transcriptEvent = event as ChatWsTranscriptEvent;

          if (transcriptEvent.type === 'user_turn') {
            log('info', 'DEV-0000021[T4] agents.ws event user_turn', {
              conversationId: transcriptEvent.conversationId,
              inflightId: transcriptEvent.inflightId,
              modelId: agentModelId,
            });
          }

          if (transcriptEvent.type === 'inflight_snapshot') {
            log('info', 'DEV-0000021[T4] agents.ws event inflight_snapshot', {
              conversationId: transcriptEvent.conversationId,
              inflightId: transcriptEvent.inflight.inflightId,
              modelId: agentModelId,
            });
          }

          if (transcriptEvent.type === 'turn_final') {
            log('info', 'DEV-0000021[T4] agents.ws event turn_final', {
              conversationId: transcriptEvent.conversationId,
              inflightId: transcriptEvent.inflightId,
              modelId: agentModelId,
              status: transcriptEvent.status,
            });
          }

          if (transcriptEvent.type === 'tool_event') {
            log('info', 'DEV-0000021[T5] agents.ws event tool_event', {
              conversationId: transcriptEvent.conversationId,
              inflightId: transcriptEvent.inflightId,
              modelId: agentModelId,
              toolName: transcriptEvent.event?.name,
              stage: transcriptEvent.event?.stage,
              eventType: transcriptEvent.event?.type,
            });
          }

          handleWsEvent(transcriptEvent);
          return;
        }
        default:
          return;
      }
    },
  });

  const wsTranscriptReady =
    mongoConnected !== false && wsConnectionState === 'open';

  useEffect(() => {
    if (persistenceUnavailable) return;
    subscribeSidebar();
    log('info', 'DEV-0000021[T7] agents.ws subscribe_sidebar', {
      selectedAgentName: selectedAgentNameRef.current,
    });
    return () => unsubscribeSidebar();
  }, [log, persistenceUnavailable, subscribeSidebar, unsubscribeSidebar]);

  useEffect(() => {
    if (!activeConversationId) {
      citationsReadyLoggedRef.current = null;
      return;
    }

    if (citationsReadyLoggedRef.current === activeConversationId) return;

    const hasCitations = messages.some(
      (message) => (message.citations?.length ?? 0) > 0,
    );
    if (!hasCitations) return;

    citationsReadyLoggedRef.current = activeConversationId;
    log('info', 'DEV-0000021[T5] agents.transcript citations ready', {
      conversationId: activeConversationId,
      inflightId: getInflightId(),
    });
  }, [activeConversationId, getInflightId, log, messages]);

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

  const handleStopClick = useCallback(() => {
    const inflightId = getInflightId();
    log('info', 'DEV-0000021[T6] agents.stop clicked', {
      conversationId: activeConversationId,
      inflightId,
    });

    if (activeConversationId && inflightId) {
      cancelInflight(activeConversationId, inflightId);
      log('info', 'DEV-0000021[T6] agents.ws cancel_inflight sent', {
        conversationId: activeConversationId,
        inflightId,
      });
    }

    stop({ showStatusBubble: true });
    setInput(lastSentRef.current);
    inputRef.current?.focus();
  }, [activeConversationId, cancelInflight, getInflightId, log, stop]);

  const makeClientConversationId = () =>
    crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);

  const resetConversation = useCallback(() => {
    stop();
    setStartPending(false);
    setRunError(null);
    resetTurns();
    setActiveConversationId(undefined);
    setConversation(makeClientConversationId(), { clearMessages: true });
    setAgentModelId('unknown');
    setWorkingFolder('');
    setInput('');
    lastSentRef.current = '';
    setThinkOpen({});
    setToolOpen({});
    setToolErrorOpen({});
    void refreshConversations();
  }, [refreshConversations, resetTurns, setConversation, stop]);

  const handleAgentChange = useCallback(
    (event: SelectChangeEvent<string>) => {
      const next = event.target.value;
      if (next === selectedAgentName) return;
      setSelectedAgentName(next);
      setSelectedCommandName('');
      setAgentModelId('unknown');
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
  const lastInflightHydratedRef = useRef<string | null>(null);
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

  useEffect(() => {
    if (!activeConversationId || !inflightSnapshot) return;
    const inflightKey = `${activeConversationId}-${inflightSnapshot.inflightId}-${inflightSnapshot.seq}`;
    if (lastInflightHydratedRef.current === inflightKey) return;
    lastInflightHydratedRef.current = inflightKey;
    hydrateInflightSnapshot(activeConversationId, inflightSnapshot);
  }, [activeConversationId, hydrateInflightSnapshot, inflightSnapshot]);

  const handleTranscriptScroll = () => {};

  const handleSelectConversation = (conversationId: string) => {
    if (conversationId === activeConversationId) return;
    stop();
    resetTurns();
    setConversation(conversationId, { clearMessages: true });
    const summary = conversations.find(
      (conversation) => conversation.conversationId === conversationId,
    );
    if (summary?.model) {
      setAgentModelId(summary.model);
    }
    setActiveConversationId(conversationId);
    setThinkOpen({});
    setToolOpen({});
    setToolErrorOpen({});
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setRunError(null);
    const trimmed = input.trim();
    if (!trimmed || !selectedAgentName || startPending) return;

    if (persistenceUnavailable || !wsTranscriptReady) {
      setRunError(
        'Realtime connection unavailable — Agents runs require WebSocket streaming.',
      );
      return;
    }

    stop();
    setStartPending(true);
    lastSentRef.current = trimmed;
    setInput('');

    const nextConversationId =
      activeConversationId && activeConversationId.trim().length > 0
        ? activeConversationId
        : makeClientConversationId();
    const isNewConversation = nextConversationId !== activeConversationId;

    if (isNewConversation) {
      setConversation(nextConversationId, { clearMessages: true });
      setActiveConversationId(nextConversationId);
      setThinkOpen({});
      setToolOpen({});
      setToolErrorOpen({});
      setAgentModelId('unknown');
    }

    log('info', 'DEV-0000021[T4] agents.ws subscribe_conversation', {
      conversationId: nextConversationId,
      inflightId: getInflightId(),
      modelId: agentModelId,
      wsConnectionState,
    });
    subscribeConversation(nextConversationId);

    try {
      const result = await runAgentInstruction({
        agentName: selectedAgentName,
        instruction: trimmed,
        working_folder: workingFolder.trim() || undefined,
        conversationId: nextConversationId,
      });
      setActiveConversationId(result.conversationId);
      if (result.modelId) {
        setAgentModelId(result.modelId);
      }
      void refreshConversations();
    } catch (err) {
      if (
        err instanceof AgentApiError &&
        err.status === 409 &&
        err.code === 'RUN_IN_PROGRESS'
      ) {
        const errorMessage: ChatMessage = {
          id: makeClientConversationId(),
          role: 'assistant',
          content:
            'This conversation already has a run in progress in another tab/window. Please wait for it to finish or press Abort in the other tab.',
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
      const message =
        (err as Error).message || 'Failed to run agent instruction.';
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
  };
  const handleExecuteCommand = useCallback(async () => {
    setRunError(null);
    if (
      !selectedAgentName ||
      !selectedCommandName ||
      startPending ||
      persistenceUnavailable ||
      !wsTranscriptReady
    ) {
      return;
    }

    const nextConversationId =
      activeConversationId && activeConversationId.trim().length > 0
        ? activeConversationId
        : makeClientConversationId();
    const isNewConversation = nextConversationId !== activeConversationId;

    stop();
    setStartPending(true);

    try {
      if (isNewConversation) {
        setConversation(nextConversationId, { clearMessages: true });
        setActiveConversationId(nextConversationId);
        setThinkOpen({});
        setToolOpen({});
        setToolErrorOpen({});
        setAgentModelId('unknown');
      }

      log('info', 'DEV-0000021[T4] agents.ws subscribe_conversation', {
        conversationId: nextConversationId,
        inflightId: getInflightId(),
        modelId: agentModelId,
        wsConnectionState,
      });
      subscribeConversation(nextConversationId);

      const result = await runAgentCommand({
        agentName: selectedAgentName,
        commandName: selectedCommandName,
        working_folder: workingFolder.trim() || undefined,
        conversationId: nextConversationId,
      });

      if (result.modelId) {
        setAgentModelId(result.modelId);
      }

      await refreshConversations();
      setActiveConversationId(result.conversationId);
      lastHydratedRef.current = null;
    } catch (err) {
      if (
        err instanceof AgentApiError &&
        err.status === 409 &&
        err.code === 'RUN_IN_PROGRESS'
      ) {
        const errorMessage: ChatMessage = {
          id: makeClientConversationId(),
          role: 'assistant',
          content:
            'This conversation already has a run in progress in another tab/window. Please wait for it to finish or press Abort in the other tab.',
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

      const message = (err as Error).message || 'Failed to run agent command.';
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
  }, [
    activeConversationId,
    agentModelId,
    getInflightId,
    hydrateHistory,
    log,
    messages,
    persistenceUnavailable,
    refreshConversations,
    selectedAgentName,
    selectedCommandName,
    setConversation,
    startPending,
    stop,
    subscribeConversation,
    wsConnectionState,
    wsTranscriptReady,
    workingFolder,
  ]);

  const isSending = startPending || isStreaming || status === 'sending';

  const controlsDisabled =
    agentsLoading ||
    !!agentsError ||
    !selectedAgentName ||
    persistenceLoading ||
    isSending;
  const conversationListDisabled = controlsDisabled || persistenceUnavailable;

  const hasFilters = Boolean(setFilterState && refreshConversations);
  const hasBulkActions = Boolean(bulkArchive || bulkRestore || bulkDelete);
  const hasRowActions = Boolean(archiveConversation && restoreConversation);

  useEffect(() => {
    log('info', '0000023 agents sidebar handlers wired', {
      agentName: selectedAgentName,
      hasFilters,
      hasBulkActions,
      hasRowActions,
      persistenceEnabled: !persistenceUnavailable,
    });
  }, [
    hasBulkActions,
    hasFilters,
    hasRowActions,
    log,
    persistenceUnavailable,
    selectedAgentName,
  ]);

  const selectedAgent = agents.find((a) => a.name === selectedAgentName);

  const agentDescription = selectedAgent?.description?.trim();

  const showStop = isSending;
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

  const renderResultAccordion = (payload: unknown, accordionId: string) => (
    <Accordion
      defaultExpanded={false}
      disableGutters
      data-testid="tool-result-accordion"
      id={`result-${accordionId}`}
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
            lineHeight: 1.4,
          }}
        >
          {JSON.stringify(payload ?? {}, null, 2)}
        </Box>
      </AccordionDetails>
    </Accordion>
  );

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
                <Button
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
                </Button>
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
        {renderResultAccordion(tool.payload, toggleKey)}

        {hasRepos && renderRepoList(repos)}
        {hasVectorFiles && renderVectorFiles(files)}

        {!hasRepos && !hasVectorFiles && tool.payload && (
          <Typography
            variant="caption"
            color="text.secondary"
            style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
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
    <Container
      maxWidth={false}
      data-testid="agents-page"
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

        {!persistenceUnavailable && !wsTranscriptReady && (
          <Alert severity="warning" data-testid="agents-ws-banner">
            Realtime connection unavailable — Agents runs require an open
            WebSocket connection.
          </Alert>
        )}

        {runError && (
          <Alert severity="error" data-testid="agents-run-error">
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
                  log('info', 'DEV-0000021[T8] agents.layout drawer toggle', {
                    open: false,
                  });
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
                  conversations={conversations}
                  selectedId={activeConversationId}
                  isLoading={conversationsLoading}
                  isError={conversationsError}
                  error={conversationsErrorMessage}
                  hasMore={conversationsHasMore}
                  filterState={filterState}
                  mongoConnected={mongoConnected}
                  disabled={conversationListDisabled}
                  variant="agents"
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
            data-testid="chat-column"
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
              <Box data-testid="chat-controls" style={{ flex: '0 0 auto' }}>
                <Stack spacing={2} component="form" onSubmit={handleSubmit}>
                  <Stack direction="row" justifyContent="flex-start">
                    <IconButton
                      aria-label="Toggle conversations"
                      aria-controls="conversation-drawer"
                      aria-expanded={drawerOpen}
                      onClick={() => {
                        if (isMobile) {
                          setMobileDrawerOpen((prev) => {
                            const next = !prev;
                            log(
                              'info',
                              'DEV-0000021[T8] agents.layout drawer toggle',
                              {
                                open: next,
                              },
                            );
                            return next;
                          });
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
                        onClick={handleStopClick}
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
                      isSending ||
                      selectedAgent?.disabled ||
                      commandsLoading
                    }
                  >
                    <InputLabel id="agent-command-select-label">
                      Command
                    </InputLabel>
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
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
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

                  <Stack spacing={0.75} alignItems="flex-start">
                    <Button
                      type="button"
                      variant="contained"
                      disabled={
                        !selectedCommandName ||
                        isSending ||
                        persistenceUnavailable ||
                        !wsTranscriptReady ||
                        controlsDisabled ||
                        selectedAgent?.disabled
                      }
                      onClick={handleExecuteCommand}
                      data-testid="agent-command-execute"
                    >
                      Execute command
                    </Button>
                    {persistenceUnavailable ? (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        data-testid="agent-command-persistence-note"
                      >
                        Commands require conversation history (Mongo) to display
                        multi-step results.
                      </Typography>
                    ) : !wsTranscriptReady ? (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        data-testid="agent-command-ws-note"
                      >
                        Commands require an open WebSocket connection.
                      </Typography>
                    ) : null}
                  </Stack>

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
                      controlsDisabled ||
                      isSending ||
                      !wsTranscriptReady ||
                      selectedAgent?.disabled
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
                      controlsDisabled ||
                      isSending ||
                      !wsTranscriptReady ||
                      selectedAgent?.disabled
                    }
                    inputProps={{ 'data-testid': 'agent-input' }}
                  />

                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Button
                      type="submit"
                      variant="contained"
                      disabled={
                        controlsDisabled ||
                        isSending ||
                        !wsTranscriptReady ||
                        !selectedAgentName ||
                        !input.trim() ||
                        Boolean(selectedAgent?.disabled)
                      }
                      data-testid="agent-send"
                    >
                      Send
                    </Button>
                  </Stack>
                </Stack>
              </Box>
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  flex: '1 1 0%',
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <Box
                  ref={transcriptRef}
                  onScroll={handleTranscriptScroll}
                  data-testid="chat-transcript"
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
                      <Alert severity="warning" data-testid="agent-turns-error">
                        {turnsErrorMessage ??
                          'Failed to load conversation history.'}
                      </Alert>
                    )}
                    {displayMessages.length === 0 && (
                      <Typography color="text.secondary">
                        Transcript will appear here once you send an
                        instruction.
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
                      const metadataColor = isUser
                        ? 'inherit'
                        : 'text.secondary';
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
                                        <Button
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
                                          {isOpen
                                            ? 'Hide details'
                                            : 'Show details'}
                                        </Button>
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
                                  (message.citations?.length ?? 0) > 0 && (
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
                                            (citation, idx) => {
                                              const pathLabel = `${citation.repo}/${citation.relPath}`;
                                              const hostSuffix =
                                                citation.hostPath
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
                                        {thinkOpen[message.id]
                                          ? 'Hide'
                                          : 'Show'}
                                      </Button>
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
