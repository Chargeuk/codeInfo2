import MenuIcon from '@mui/icons-material/Menu';
import {
  Container,
  Alert,
  Button,
  CircularProgress,
  IconButton,
  Link,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
  Box,
  Drawer,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  ChangeEvent,
  FormEvent,
  type HTMLAttributes,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import CodexFlagsPanel from '../components/chat/CodexFlagsPanel';
import ConversationList from '../components/chat/ConversationList';
import SharedTranscript from '../components/chat/SharedTranscript';
import {
  buildStepLine,
  buildTimingLine,
  buildUsageLine,
  formatBubbleTimestamp,
} from '../components/chat/chatTranscriptFormatting';
import useSharedTranscriptState from '../components/chat/useSharedTranscriptState';
import CodexDeviceAuthDialog from '../components/codex/CodexDeviceAuthDialog';
import DirectoryPickerDialog from '../components/ingest/DirectoryPickerDialog';
import useChatModel from '../hooks/useChatModel';
import useChatStream, {
  ChatMessage,
  ApprovalPolicy,
  ModelReasoningEffort,
  SandboxMode,
  ToolCall,
} from '../hooks/useChatStream';
import useChatWs, {
  type ChatWsCancelAckEvent,
  type ChatWsServerEvent,
  type ChatWsTranscriptEvent,
} from '../hooks/useChatWs';
import useConversationTurns, {
  StoredTurn,
} from '../hooks/useConversationTurns';
import useConversations from '../hooks/useConversations';
import usePersistenceStatus from '../hooks/usePersistenceStatus';
import { createLogger } from '../logging/logger';
import { isDevEnv } from '../utils/isDevEnv';

const DEV_0000037_T16_PREFIX = '[DEV-0000037][T16]';
const DEV_0000037_T17_PREFIX = '[DEV-0000037][T17]';

const selectDisplayTestId = (
  value: string,
): HTMLAttributes<HTMLDivElement> & { 'data-testid': string } => ({
  'data-testid': value,
});

export default function ChatPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const drawerWidth = 320;
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);
  const [desktopDrawerOpen, setDesktopDrawerOpen] = useState<boolean>(() =>
    isMobile ? false : true,
  );
  const drawerOpen = isMobile ? mobileDrawerOpen : desktopDrawerOpen;

  useEffect(() => {
    if (isMobile) {
      setMobileDrawerOpen(false);
      return;
    }

    setDesktopDrawerOpen(true);
  }, [isMobile]);

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
    codexDefaults,
    codexWarnings,
    selectedModelCapabilities,
    isLoading,
    isError,
    isEmpty,
    refreshModels,
    refreshProviders,
  } = useChatModel();
  const [sandboxMode, setSandboxMode] = useState<SandboxMode>(
    codexDefaults?.sandboxMode ?? 'danger-full-access',
  );
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>(
    codexDefaults?.approvalPolicy ?? 'on-failure',
  );
  const [modelReasoningEffort, setModelReasoningEffort] =
    useState<ModelReasoningEffort>(
      codexDefaults?.modelReasoningEffort ?? 'high',
    );
  const [networkAccessEnabled, setNetworkAccessEnabled] = useState<boolean>(
    codexDefaults?.networkAccessEnabled ?? true,
  );
  const [webSearchEnabled, setWebSearchEnabled] = useState<boolean>(
    codexDefaults?.webSearchEnabled ?? true,
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
    handleWsEvent,
  } = useChatStream(
    selected,
    provider,
    {
      sandboxMode,
      approvalPolicy,
      modelReasoningEffort,
      networkAccessEnabled,
      webSearchEnabled,
    },
    codexDefaults,
    selectedModelCapabilities,
  );

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
  } = useConversations({ agentName: '__none__', flowName: '__none__' });

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
  const codexDocsLoggedRef = useRef(false);
  const codexDynamicReasoningStateKeyRef = useRef<string | null>(null);
  const [input, setInput] = useState('');
  const [workingFolder, setWorkingFolder] = useState('');
  const [dirPickerOpen, setDirPickerOpen] = useState(false);
  const [deviceAuthOpen, setDeviceAuthOpen] = useState(false);
  const metadataLoggedRef = useRef(new Set<string>());
  const stepLoggedRef = useRef(new Set<string>());
  const toolDistanceLoggedRef = useRef(new Set<string>());
  const workingFolderRestoreKeyRef = useRef<string | null>(null);
  const workingFolderLockKeyRef = useRef<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const stoppingVisibleLoggedRef = useRef<string | null>(null);
  const stoppedVisibleLoggedRef = useRef(new Set<string>());
  const serverVisibleInflightIdRef = useRef<string | null>(null);
  const [serverVisibleInflightId, setServerVisibleInflightId] = useState<
    string | null
  >(null);
  const knownConversationIds = useMemo(
    () => new Set(conversations.map((c) => c.conversationId)),
    [conversations],
  );
  const persistenceUnavailable = mongoConnected === false;

  const syncServerVisibleInflightId = useCallback((nextId: string | null) => {
    serverVisibleInflightIdRef.current = nextId;
    setServerVisibleInflightId((current) =>
      current === nextId ? current : nextId,
    );
  }, []);

  const toolMatchCountByKey = useMemo(() => {
    const map = new Map<string, number>();
    messages.forEach((message) => {
      message.tools?.forEach((tool) => {
        if (tool.name !== 'VectorSearch') return;
        if (!tool.payload || typeof tool.payload !== 'object') return;
        const payload = tool.payload as Record<string, unknown>;
        const results = Array.isArray(
          (payload as { results?: unknown }).results,
        )
          ? ((payload as { results: unknown[] }).results as unknown[])
          : [];
        const count = results.reduce<number>((total, item) => {
          if (!item || typeof item !== 'object') return total;
          const record = item as Record<string, unknown>;
          const repo =
            typeof record.repo === 'string' ? record.repo : undefined;
          const relPath =
            typeof record.relPath === 'string' ? record.relPath : undefined;
          if (!repo || !relPath) return total;
          return total + 1;
        }, 0);
        if (count > 0) {
          map.set(`${message.id}-${tool.id}`, count);
        }
      });
    });
    return map;
  }, [messages]);

  const chatColumnRef = useRef<HTMLDivElement | null>(null);
  const [drawerTopOffsetPx, setDrawerTopOffsetPx] = useState<number>(0);

  useLayoutEffect(() => {
    const updateOffset = () => {
      const top = chatColumnRef.current?.getBoundingClientRect().top ?? 0;
      setDrawerTopOffsetPx(top);
    };

    updateOffset();
    window.addEventListener('resize', updateOffset);
    return () => window.removeEventListener('resize', updateOffset);
  }, [isMobile, persistenceUnavailable]);

  const drawerTopOffset =
    drawerTopOffsetPx > 0 ? `${drawerTopOffsetPx}px` : theme.spacing(3);
  const drawerHeight =
    drawerTopOffsetPx > 0
      ? `calc(100% - ${drawerTopOffsetPx}px)`
      : `calc(100% - ${theme.spacing(3)})`;
  const log = useMemo(() => createLogger('client'), []);
  const deviceAuthLog = useMemo(
    () => createLogger('codex-device-auth-chat'),
    [],
  );
  const selectedConversation = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.conversationId === activeConversationId,
      ),
    [activeConversationId, conversations],
  );
  const selectedConversationId = selectedConversation?.conversationId;
  const {
    citationsOpen,
    thinkOpen,
    toolOpen,
    toolErrorOpen,
    toggleCitation,
    toggleThink,
    toggleTool,
    toggleToolError,
  } = useSharedTranscriptState({
    surface: 'chat',
    conversationId: activeConversationId ?? null,
  });
  const turnsConversationId = persistenceUnavailable
    ? undefined
    : activeConversationId;
  const turnsAutoFetch = Boolean(
    turnsConversationId && knownConversationIds.has(turnsConversationId),
  );

  useEffect(() => {
    log('info', '0000023 drawer overflow guard applied', {
      page: 'chat',
      drawerWidth,
      overflowX: 'hidden',
      boxSizing: 'border-box',
    });
  }, [drawerWidth, log]);

  useEffect(() => {
    log('info', 'DEV-0000028[T1] chat transcript layout ready', {
      page: 'chat',
    });
  }, [log]);

  useEffect(() => {
    log('info', 'DEV-0000028[T6] chat controls sizing applied', {
      page: 'chat',
    });
  }, [log]);
  const {
    turns,
    inflight: inflightSnapshot,
    isLoading: turnsLoading,
    isError: turnsError,
    error: turnsErrorMessage,
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
      const forwardRealtimeEvent = (
        targetEvent: ChatWsTranscriptEvent | ChatWsCancelAckEvent,
      ) => {
        if (targetEvent.type === 'inflight_snapshot') {
          syncServerVisibleInflightId(targetEvent.inflight.inflightId);
        } else if (
          targetEvent.type !== 'turn_final' &&
          'inflightId' in targetEvent &&
          typeof targetEvent.inflightId === 'string'
        ) {
          syncServerVisibleInflightId(targetEvent.inflightId);
        }
        if (
          targetEvent.type === 'turn_final' &&
          serverVisibleInflightIdRef.current === targetEvent.inflightId
        ) {
          syncServerVisibleInflightId(null);
        }
        handleWsEvent(targetEvent);
      };
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
          forwardRealtimeEvent(event);
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
      turnsCount: turns.length,
      turnsOldest: turns[0]?.createdAt,
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
    turns,
    messages.length,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const enabled = Boolean(
      (window as unknown as { __CODEINFO_TEST__?: boolean }).__CODEINFO_TEST__,
    );
    if (!enabled) return;
    (window as unknown as { __chatTest?: unknown }).__chatTest = {
      handleWsEvent: (event: ChatWsTranscriptEvent | ChatWsCancelAckEvent) => {
        if (event.type === 'inflight_snapshot') {
          syncServerVisibleInflightId(event.inflight.inflightId);
        } else if (
          event.type !== 'turn_final' &&
          'inflightId' in event &&
          typeof event.inflightId === 'string'
        ) {
          syncServerVisibleInflightId(event.inflightId);
        }
        if (
          event.type === 'turn_final' &&
          serverVisibleInflightIdRef.current === event.inflightId
        ) {
          syncServerVisibleInflightId(null);
        }
        handleWsEvent(event);
      },
    };
  }, [handleWsEvent, syncServerVisibleInflightId]);
  const providerIsCodex = provider === 'codex';
  const codexDefaultsReady = providerIsCodex && Boolean(codexDefaults);
  const codexWarningList = useMemo(
    () => (providerIsCodex ? (codexWarnings ?? []) : []),
    [codexWarnings, providerIsCodex],
  );
  const showCodexWarnings = codexWarningList.length > 0;
  const codexDefaultsInitializedRef = useRef(false);
  const codexCapabilityStateKeyRef = useRef<string | null>(null);
  const codexWarningsRef = useRef('');
  const pendingCodexDefaultsReasonRef = useRef<
    null | 'provider-change' | 'new-conversation'
  >(null);
  const applyCodexDefaults = useCallback(
    (reason: 'initial' | 'provider-change' | 'new-conversation') => {
      if (!codexDefaults) return false;
      setSandboxMode(codexDefaults.sandboxMode);
      setApprovalPolicy(codexDefaults.approvalPolicy);
      setModelReasoningEffort(codexDefaults.modelReasoningEffort);
      setNetworkAccessEnabled(codexDefaults.networkAccessEnabled);
      setWebSearchEnabled(codexDefaults.webSearchEnabled);
      if (reason === 'initial') {
        console.info('[codex-ui-defaults] initialized', { codexDefaults });
      } else {
        console.info('[codex-ui-defaults] reset', { reason, codexDefaults });
      }
      return true;
    },
    [codexDefaults],
  );
  const codexProvider = useMemo(
    () => providers.find((p) => p.id === 'codex'),
    [providers],
  );
  const codexUnavailable = Boolean(codexProvider && !codexProvider.available);
  const canShowDeviceAuth =
    providerIsCodex && Boolean(codexProvider?.available);
  const showCodexUnavailable = providerIsCodex
    ? !providerAvailable
    : codexUnavailable;
  const showCodexToolsMissing =
    providerIsCodex && providerAvailable && !toolsAvailable;
  const activeToolsAvailable = Boolean(toolsAvailable && providerAvailable);
  const controlsDisabled =
    isLoading ||
    isError ||
    isEmpty ||
    !selected ||
    !providerAvailable ||
    (providerIsCodex && !toolsAvailable);
  const isSending = isStreaming || status === 'sending';
  const isStopping = status === 'stopping';
  const providerLocked = Boolean(
    selectedConversation && isStopping && !inflightSnapshot?.inflightId,
  );
  const showStop = isSending || isStopping;
  const chatWorkingFolderLocked =
    isSending ||
    isStopping ||
    Boolean(inflightSnapshot?.inflightId) ||
    Boolean(serverVisibleInflightId);
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
    orderedMessages.forEach((message) => {
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
  }, [log, orderedMessages]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => {
      log('info', 'DEV-0000024:T10:manual_validation_complete', {
        page: 'chat',
      });
    };
    window.addEventListener('codeinfo:manual-validation-complete', handler);
    return () =>
      window.removeEventListener(
        'codeinfo:manual-validation-complete',
        handler,
      );
  }, [log]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveConversationId(conversationId);
    syncServerVisibleInflightId(null);
    console.info('[chat-history] conversationId changed', { conversationId });
  }, [conversationId, syncServerVisibleInflightId]);

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

  const selectedConversationProviderSyncKey = selectedConversation
    ? `${selectedConversation.conversationId}:${selectedConversation.provider}:${inflightSnapshot?.inflightId ?? 'no-inflight'}`
    : null;

  useEffect(() => {
    if (!selectedConversation?.provider) return;
    setProvider((currentProvider) =>
      currentProvider === selectedConversation.provider
        ? currentProvider
        : selectedConversation.provider,
    );
  }, [selectedConversationProviderSyncKey, selectedConversation, setProvider]);

  useEffect(() => {
    if (!isDevEnv()) return;
    if (codexDocsLoggedRef.current) return;
    if (isLoading) return;
    if (providers.length === 0 && models.length === 0) return;
    codexDocsLoggedRef.current = true;
    console.info('[codex-docs] docs synced', { source: '/chat/models' });
  }, [isLoading, models.length, providers.length]);

  useEffect(() => {
    if (providerIsCodex) return;
    codexDefaultsInitializedRef.current = false;
    codexCapabilityStateKeyRef.current = null;
    pendingCodexDefaultsReasonRef.current = null;
    codexWarningsRef.current = '';
  }, [providerIsCodex]);

  useEffect(() => {
    if (!showCodexWarnings) {
      codexWarningsRef.current = '';
      return;
    }
    const serialized = JSON.stringify(codexWarningList);
    if (serialized === codexWarningsRef.current) return;
    codexWarningsRef.current = serialized;
    console.info('[codex-warnings] rendered', { warnings: codexWarningList });
  }, [codexWarningList, showCodexWarnings]);

  useEffect(() => {
    if (!providerIsCodex || !codexDefaults) return;
    if (codexDefaultsInitializedRef.current) return;
    const pendingReason = pendingCodexDefaultsReasonRef.current;
    const applied = applyCodexDefaults(pendingReason ?? 'initial');
    if (applied) {
      codexDefaultsInitializedRef.current = true;
      pendingCodexDefaultsReasonRef.current = null;
    }
  }, [applyCodexDefaults, codexDefaults, providerIsCodex]);

  useEffect(() => {
    if (!providerIsCodex || !selectedModelCapabilities || !selected) return;

    const supportedReasoningEfforts =
      selectedModelCapabilities.supportedReasoningEfforts;
    const defaultReasoningEffort =
      selectedModelCapabilities.defaultReasoningEffort;

    if (
      supportedReasoningEfforts.length === 0 ||
      !defaultReasoningEffort ||
      !supportedReasoningEfforts.includes(defaultReasoningEffort)
    ) {
      console.error(
        `${DEV_0000037_T16_PREFIX} event=chat_model_capability_defaults_applied result=error reason=invalid_model_capabilities model=${selected}`,
      );
      return;
    }

    if (!supportedReasoningEfforts.includes(modelReasoningEffort)) {
      setModelReasoningEffort(defaultReasoningEffort);
      console.info(
        `${DEV_0000037_T16_PREFIX} event=chat_model_capability_defaults_applied result=success`,
      );
      codexCapabilityStateKeyRef.current = null;
      return;
    }

    const key = `${selected}:${defaultReasoningEffort}:${modelReasoningEffort}:${supportedReasoningEfforts.join('|')}`;
    if (codexCapabilityStateKeyRef.current === key) {
      return;
    }
    codexCapabilityStateKeyRef.current = key;
    console.info(
      `${DEV_0000037_T16_PREFIX} event=chat_model_capability_defaults_applied result=success`,
    );
  }, [
    modelReasoningEffort,
    providerIsCodex,
    selected,
    selectedModelCapabilities,
  ]);

  useEffect(() => {
    if (!providerIsCodex || !selectedModelCapabilities || !selected) return;

    const supportedReasoningEfforts =
      selectedModelCapabilities.supportedReasoningEfforts;
    const defaultReasoningEffort =
      selectedModelCapabilities.defaultReasoningEffort;

    if (
      supportedReasoningEfforts.length === 0 ||
      !defaultReasoningEffort ||
      !supportedReasoningEfforts.includes(defaultReasoningEffort)
    ) {
      console.error(
        `${DEV_0000037_T17_PREFIX} event=dynamic_reasoning_options_rendered result=error reason=invalid_model_capabilities model=${selected}`,
      );
      codexDynamicReasoningStateKeyRef.current = null;
      return;
    }

    const key = `${selected}:${modelReasoningEffort}:${supportedReasoningEfforts.join('|')}`;
    if (codexDynamicReasoningStateKeyRef.current === key) {
      return;
    }
    codexDynamicReasoningStateKeyRef.current = key;
    console.info(
      `${DEV_0000037_T17_PREFIX} event=dynamic_reasoning_options_rendered result=success`,
    );
  }, [
    modelReasoningEffort,
    providerIsCodex,
    selected,
    selectedModelCapabilities,
  ]);

  const selectedConversationModelSyncKey = selectedConversation
    ? `${selectedConversation.conversationId}:${selectedConversation.model}:${inflightSnapshot?.inflightId ?? 'no-inflight'}`
    : null;

  useEffect(() => {
    if (!selectedConversation?.model) return;
    if (!models.some((model) => model.key === selectedConversation.model)) {
      return;
    }
    setSelected((currentModel) =>
      currentModel === selectedConversation.model
        ? currentModel
        : selectedConversation.model,
    );
  }, [
    models,
    selectedConversation,
    selectedConversationModelSyncKey,
    setSelected,
  ]);

  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  useEffect(() => {
    return () => {
      stopRef.current();
    };
  }, []);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const hasNonWhitespaceContent = input.trim().length > 0;
    log('info', 'DEV-0000035:T9:chat_raw_send_evaluated', {
      source: 'ChatPage',
      rawLength: input.length,
      trimmedLength: input.trim().length,
      hasNonWhitespaceContent,
      controlsDisabled,
      isSending,
    });

    if (!hasNonWhitespaceContent || controlsDisabled) {
      log('info', 'DEV-0000035:T9:chat_raw_send_result', {
        source: 'ChatPage',
        sent: false,
        reason: !hasNonWhitespaceContent
          ? 'whitespace_only'
          : 'controls_disabled',
        rawLength: input.length,
        trimmedLength: input.trim().length,
      });
      return;
    }

    lastSentRef.current = input;
    log('info', 'DEV-0000035:T9:chat_raw_send_result', {
      source: 'ChatPage',
      sent: true,
      reason: 'submitted',
      rawLength: input.length,
      trimmedLength: input.trim().length,
    });
    void send(input, {
      workingFolder: workingFolder.trim() || undefined,
    }).then(() => refreshConversations());
    setInput('');
  };

  const persistWorkingFolder = useCallback(
    async (nextValue?: string) => {
      const trimmedWorkingFolder = (nextValue ?? workingFolder).trim();
      setWorkingFolder(trimmedWorkingFolder);
      if (!selectedConversationId || chatWorkingFolderLocked) {
        return;
      }
      try {
        await updateWorkingFolder({
          conversationId: selectedConversationId,
          workingFolder: trimmedWorkingFolder || null,
          surface: 'chat',
        });
      } catch (error) {
        console.error('chat working-folder persistence failed', error);
      }
    },
    [
      chatWorkingFolderLocked,
      selectedConversationId,
      updateWorkingFolder,
      workingFolder,
    ],
  );

  const handleStop = () => {
    if (!activeConversationId || isStopping) {
      return;
    }

    const currentInflightId =
      inflightSnapshot?.inflightId ?? serverVisibleInflightIdRef.current;
    console.info('[stop-debug][chat-ui] stop-clicked', {
      conversationId: activeConversationId,
      ...(currentInflightId ? { inflightId: currentInflightId } : {}),
    });
    const requestId = cancelInflight(
      activeConversationId,
      currentInflightId ?? undefined,
    );
    stop({ requestId, showStatusBubble: true });
    setInput(lastSentRef.current);
    inputRef.current?.focus();
  };

  const handleOpenDirPicker = () => {
    if (chatWorkingFolderLocked) return;
    setDirPickerOpen(true);
  };

  const handlePickDir = (path: string) => {
    const trimmedWorkingFolder = path.trim();
    setWorkingFolder(trimmedWorkingFolder);
    setDirPickerOpen(false);
    void persistWorkingFolder(trimmedWorkingFolder);
  };

  const handleCloseDirPicker = () => {
    setDirPickerOpen(false);
  };

  const handleNewConversation = (options?: {
    reason?: 'provider-change' | 'new-conversation' | 'model-change';
    nextProvider?: string;
  }) => {
    const resetReason = options?.reason ?? 'new-conversation';
    const olderConversationRemainedInflight = Boolean(
      activeConversationId &&
        (inflightSnapshot?.inflightId ||
          serverVisibleInflightIdRef.current ||
          isSending ||
          isStopping),
    );
    resetTurns();
    const nextId = reset();
    setConversation(nextId, { clearMessages: true });
    setActiveConversationId(nextId);
    setInput('');
    setWorkingFolder('');
    lastSentRef.current = '';
    inputRef.current?.focus();
    syncServerVisibleInflightId(null);
    if (resetReason === 'new-conversation') {
      log('info', 'DEV-0000046:T8:new-conversation-local-reset', {
        previousConversationId: activeConversationId ?? null,
        nextConversationId: nextId,
        olderConversationRemainedInflight,
        cancelSent: false,
      });
    }
    const targetProvider = options?.nextProvider ?? provider;
    if (targetProvider === 'codex' && resetReason !== 'model-change') {
      const applied = applyCodexDefaults(resetReason);
      if (!applied) {
        pendingCodexDefaultsReasonRef.current = resetReason;
      }
    }
  };

  const handleProviderChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const nextProvider = event.target.value;
    const previousProvider = provider ?? null;
    const currentConversationId = activeConversationId ?? null;
    handleNewConversation({ reason: 'provider-change', nextProvider });
    setProvider(nextProvider);
    log('info', 'DEV-0000046:T9:provider-next-send-updated', {
      previousProvider,
      nextProvider,
      activeConversationId: currentConversationId,
      cancelSent: false,
    });
  };

  const handleModelChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const nextModel = event.target.value;
    if (!nextModel || nextModel === selected) {
      return;
    }

    const previousModel = selected ?? null;
    const currentConversationId = activeConversationId ?? null;
    handleNewConversation({ reason: 'model-change' });
    setSelected(nextModel);
    log('info', 'DEV-0000046:T10:model-next-send-updated', {
      previousModel,
      nextModel,
      activeConversationId: currentConversationId,
      cancelSent: false,
    });
  };

  const handleDeviceAuthOpen = () => {
    deviceAuthLog('info', 'DEV-0000031:T7:codex_device_auth_chat_button_click');
    setDeviceAuthOpen(true);
  };

  const handleDeviceAuthClose = () => {
    setDeviceAuthOpen(false);
  };

  const handleDeviceAuthSuccess = () => {
    deviceAuthLog('info', 'DEV-0000031:T7:codex_device_auth_chat_success');
    void refreshProviders();
    if (provider === 'codex') {
      void refreshModels('codex');
    }
  };

  const handleToggleTool = (id: string, messageId: string) => {
    const nextOpen = !toolOpen[id];
    if (nextOpen) {
      const matchCount = toolMatchCountByKey.get(id) ?? 0;
      if (!toolDistanceLoggedRef.current.has(id)) {
        toolDistanceLoggedRef.current.add(id);
        log('info', 'DEV-0000025:T7:tool_details_distance_rendered', {
          page: 'chat',
          matchCount,
        });
      }
    }
    toggleTool(id, messageId);
  };

  const handleSelectConversation = (conversation: string) => {
    if (conversation === activeConversationId) return;
    const previousConversationId = activeConversationId;
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
    log('info', 'DEV-0000046:T7:sidebar-selection-navigation', {
      previousConversationId,
      nextConversationId: conversation,
      cancelSent: false,
    });
    resetTurns();
    setConversation(conversation, { clearMessages: true });
    setActiveConversationId(conversation);
    syncServerVisibleInflightId(null);
    if (isMobile) {
      setMobileDrawerOpen(false);
    }
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
      surface: 'chat',
      conversationId: selectedConversation.conversationId,
      action: restoredWorkingFolder ? 'restore' : 'clear',
      pickerState: restoredWorkingFolder,
    });
  }, [emitWorkingFolderPickerSync, readWorkingFolder, selectedConversation]);

  useEffect(() => {
    if (!chatWorkingFolderLocked) {
      workingFolderLockKeyRef.current = null;
      return;
    }

    const conversationKey = activeConversationId ?? conversationId;
    const lockKey = `${conversationKey}:${workingFolder.trim()}`;
    if (workingFolderLockKeyRef.current === lockKey) return;
    workingFolderLockKeyRef.current = lockKey;
    emitWorkingFolderPickerSync({
      surface: 'chat',
      conversationId: conversationKey,
      action: 'lock',
      pickerState: workingFolder.trim(),
    });
  }, [
    activeConversationId,
    chatWorkingFolderLocked,
    conversationId,
    emitWorkingFolderPickerSync,
    workingFolder,
  ]);

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
            usage: turn.usage,
            timing: turn.timing,
            createdAt: turn.createdAt,
          }) satisfies ChatMessage,
      ),
    [mapToolCalls],
  );

  const lastHydratedRef = useRef<string | null>(null);
  const lastInflightHydratedRef = useRef<string | null>(null);
  const lastRehydratedLogRef = useRef<string | null>(null);

  useEffect(() => {
    lastHydratedRef.current = null;
    lastInflightHydratedRef.current = null;
    lastRehydratedLogRef.current = null;
  }, [activeConversationId]);

  useEffect(() => {
    if (!activeConversationId) return;
    const oldest = turns?.[0]?.createdAt ?? 'none';
    const newest = turns?.[turns.length - 1]?.createdAt ?? 'none';
    const key = `${activeConversationId}-${oldest}-${newest}-${turns.length}`;
    if (lastHydratedRef.current === key) return;
    lastHydratedRef.current = key;
    console.info('[chat-history] hydrating turns', {
      activeConversationId,
      count: turns.length,
      first: turns[0]?.createdAt,
      last: turns[turns.length - 1]?.createdAt,
    });
    hydrateHistory(activeConversationId, mapTurnsToMessages(turns), 'replace');
  }, [activeConversationId, hydrateHistory, mapTurnsToMessages, turns]);

  useEffect(() => {
    if (!activeConversationId || !inflightSnapshot) return;
    const inflightKey = `${activeConversationId}-${inflightSnapshot.inflightId}-${inflightSnapshot.seq}`;
    if (lastInflightHydratedRef.current === inflightKey) return;
    lastInflightHydratedRef.current = inflightKey;
    syncServerVisibleInflightId(inflightSnapshot.inflightId);
    hydrateInflightSnapshot(activeConversationId, inflightSnapshot);
  }, [
    activeConversationId,
    hydrateInflightSnapshot,
    inflightSnapshot,
    syncServerVisibleInflightId,
  ]);

  useEffect(() => {
    if (!activeConversationId || !turnsConversationId) return;
    if (activeConversationId !== turnsConversationId) return;
    if (!knownConversationIds.has(activeConversationId)) return;
    if (turns.length === 0 && !inflightSnapshot) return;

    const oldest = turns[0]?.createdAt ?? 'none';
    const newest = turns[turns.length - 1]?.createdAt ?? 'none';
    const key = `${activeConversationId}-${oldest}-${newest}-${turns.length}-${inflightSnapshot?.inflightId ?? 'no-inflight'}`;
    if (lastRehydratedLogRef.current === key) return;
    lastRehydratedLogRef.current = key;

    console.info('DEV-0000046:T12:hidden-run-rehydrated', {
      conversationId: activeConversationId,
      hasInflightSnapshot: Boolean(inflightSnapshot),
      inflightId: inflightSnapshot?.inflightId ?? null,
      replacedVisibleDraft: true,
      turnCount: turns.length,
    });
  }, [
    activeConversationId,
    inflightSnapshot,
    knownConversationIds,
    turns,
    turnsConversationId,
  ]);

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
    console.info('[stop-debug][chat-ui] stopping-visible', {
      conversationId: activeConversationId,
    });
  }, [activeConversationId, status]);

  useEffect(() => {
    orderedMessages.forEach((message) => {
      if (
        message.role !== 'assistant' ||
        message.streamStatus !== 'stopped' ||
        stoppedVisibleLoggedRef.current.has(message.id)
      ) {
        return;
      }
      stoppedVisibleLoggedRef.current.add(message.id);
      console.info('[stop-debug][chat-ui] stopped-visible', {
        conversationId: activeConversationId ?? conversationId,
        turnId: message.id,
      });
    });
  }, [activeConversationId, conversationId, orderedMessages]);

  return (
    <Container
      maxWidth={false}
      sx={{
        pt: 3,
        pb: 0,
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
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
                        <Button
                          color="inherit"
                          size="small"
                          onClick={retryFetch}
                        >
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
                        <TextField
                          select
                          size="small"
                          id="chat-provider-select"
                          label="Provider"
                          value={provider ?? ''}
                          onChange={handleProviderChange}
                          disabled={isLoading || providerLocked}
                          sx={{ minWidth: 220 }}
                          SelectProps={{ displayEmpty: true }}
                          slotProps={{
                            select: {
                              SelectDisplayProps: {
                                ...selectDisplayTestId('provider-select'),
                              },
                            },
                          }}
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
                        </TextField>

                        <TextField
                          select
                          size="small"
                          id="chat-model-select"
                          label="Model"
                          value={selected ?? ''}
                          onChange={handleModelChange}
                          disabled={
                            isLoading ||
                            isError ||
                            isEmpty ||
                            !providerAvailable
                          }
                          sx={{ minWidth: 260, flex: 1 }}
                          SelectProps={{ displayEmpty: true }}
                          slotProps={{
                            select: {
                              SelectDisplayProps: {
                                ...selectDisplayTestId('model-select'),
                              },
                            },
                          }}
                        >
                          {models.map((model) => (
                            <MenuItem key={model.key} value={model.key}>
                              {model.displayName}
                            </MenuItem>
                          ))}
                        </TextField>

                        <Stack
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          justifyContent="flex-end"
                          sx={{ minWidth: { xs: '100%', sm: 220 } }}
                        >
                          <Stack spacing={1} sx={{ width: '100%' }}>
                            <Button
                              type="button"
                              variant="outlined"
                              color="secondary"
                              size="small"
                              onClick={() => handleNewConversation()}
                              disabled={isLoading}
                              fullWidth
                            >
                              New conversation
                            </Button>
                            {canShowDeviceAuth ? (
                              <Button
                                type="button"
                                variant="outlined"
                                size="small"
                                onClick={handleDeviceAuthOpen}
                                disabled={isLoading}
                                fullWidth
                              >
                                Re-authenticate (device auth)
                              </Button>
                            ) : null}
                          </Stack>
                        </Stack>
                      </Stack>
                      <CodexDeviceAuthDialog
                        open={deviceAuthOpen}
                        onClose={handleDeviceAuthClose}
                        source="chat"
                        onSuccess={handleDeviceAuthSuccess}
                      />

                      {showCodexWarnings && (
                        <Alert
                          severity="warning"
                          data-testid="codex-warnings-banner"
                        >
                          <Stack spacing={0.5}>
                            {codexWarningList.map((warning, index) => (
                              <Typography
                                key={`${warning}-${index}`}
                                variant="body2"
                              >
                                {warning}
                              </Typography>
                            ))}
                          </Stack>
                        </Alert>
                      )}
                      {providerIsCodex && (
                        <CodexFlagsPanel
                          sandboxMode={sandboxMode}
                          onSandboxModeChange={(value) => setSandboxMode(value)}
                          approvalPolicy={approvalPolicy}
                          onApprovalPolicyChange={setApprovalPolicy}
                          modelReasoningEffort={modelReasoningEffort}
                          onModelReasoningEffortChange={setModelReasoningEffort}
                          reasoningEffortOptions={
                            selectedModelCapabilities?.supportedReasoningEfforts ??
                            []
                          }
                          networkAccessEnabled={networkAccessEnabled}
                          onNetworkAccessEnabledChange={setNetworkAccessEnabled}
                          webSearchEnabled={webSearchEnabled}
                          onWebSearchEnabledChange={setWebSearchEnabled}
                          disabled={controlsDisabled || !codexDefaultsReady}
                        />
                      )}

                      {showCodexUnavailable ? (
                        <Alert
                          severity="warning"
                          data-testid="codex-unavailable-banner"
                        >
                          OpenAI Codex is unavailable. Install the CLI (`npm
                          install -g @openai/codex`), log in with
                          `CODEX_HOME=./codex codex login` (or your `~/.codex`),
                          and ensure `./codex/config.toml` is seeded. Compose
                          mounts <code>{'${CODEX_HOME:-$HOME/.codex}'}</code> to
                          `/host/codex` and copies `auth.json` into `/app/codex`
                          when missing, so container logins are not required.
                          See the guidance in{' '}
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
                        <Alert
                          severity="warning"
                          data-testid="codex-tools-banner"
                        >
                          Codex requires MCP tools. Ensure `config.toml` lists
                          the `/mcp` endpoints and that tools are enabled, then
                          retry once the CLI/auth/config prerequisites above are
                          satisfied.
                        </Alert>
                      )}

                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={2}
                        alignItems={{ xs: 'stretch', sm: 'flex-start' }}
                      >
                        <TextField
                          fullWidth
                          size="small"
                          label="Working folder"
                          placeholder="Absolute host path (optional)"
                          value={workingFolder}
                          onChange={(event) =>
                            setWorkingFolder(event.target.value)
                          }
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
                          disabled={chatWorkingFolderLocked}
                          helperText="Saved per conversation while idle."
                          slotProps={{
                            htmlInput: {
                              'data-testid': 'chat-working-folder',
                            },
                          }}
                        />
                        <Button
                          type="button"
                          variant="outlined"
                          size="small"
                          onClick={handleOpenDirPicker}
                          disabled={chatWorkingFolderLocked}
                          data-testid="chat-working-folder-picker"
                          sx={{ flexShrink: 0, minWidth: 160 }}
                        >
                          Choose folder…
                        </Button>
                      </Stack>

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
                          size="small"
                          label="Message"
                          placeholder="Type your prompt"
                          value={input}
                          onChange={(event) => setInput(event.target.value)}
                          disabled={controlsDisabled}
                          slotProps={{
                            htmlInput: { 'data-testid': 'chat-input' },
                          }}
                          helperText={
                            providerIsCodex &&
                            (!providerAvailable || !toolsAvailable)
                              ? 'Codex is unavailable until the CLI is installed, logged in, and MCP tools are enabled.'
                              : undefined
                          }
                        />
                        <Stack
                          direction="row"
                          spacing={1}
                          alignItems="flex-start"
                        >
                          <Button
                            type="submit"
                            variant="contained"
                            size="small"
                            data-testid="chat-send"
                            disabled={controlsDisabled || isSending}
                          >
                            Send
                          </Button>
                          {showStop && (
                            <Button
                              type="button"
                              variant="contained"
                              color="error"
                              size="small"
                              onClick={handleStop}
                              data-testid="chat-stop"
                              disabled={isStopping}
                            >
                              {isStopping ? 'Stopping…' : 'Stop'}
                            </Button>
                          )}
                        </Stack>
                      </Stack>
                    </Stack>
                  </form>
                  <DirectoryPickerDialog
                    open={dirPickerOpen}
                    path={workingFolder}
                    onClose={handleCloseDirPicker}
                    onPick={handlePickDir}
                  />
                  {(isSending || isStopping) && (
                    <Typography variant="body2" color="text.secondary">
                      {isStopping ? 'Stopping…' : 'Responding...'}
                    </Typography>
                  )}
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
                {isLoading && (
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    justifyContent="center"
                    sx={{ flex: 1 }}
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
                  <SharedTranscript
                    ref={transcriptRef}
                    surface="chat"
                    conversationId={activeConversationId ?? null}
                    messages={orderedMessages}
                    activeToolsAvailable={activeToolsAvailable}
                    turnsLoading={turnsLoading}
                    turnsError={turnsError}
                    turnsErrorMessage={turnsErrorMessage}
                    emptyMessage="Transcript will appear here once you send a message."
                    warningTestId="turns-error"
                    transcriptTestId="chat-transcript"
                    citationsEnabled
                    isStopping={isStopping}
                    citationsOpen={citationsOpen}
                    thinkOpen={thinkOpen}
                    toolOpen={toolOpen}
                    toolErrorOpen={toolErrorOpen}
                    onToggleCitation={toggleCitation}
                    onToggleThink={toggleThink}
                    onToggleTool={handleToggleTool}
                    onToggleToolError={toggleToolError}
                    markdownLogSource="ChatPage"
                    sharedRenderLogConfig={{
                      eventName:
                        'DEV-0000049:T01:chat_shared_transcript_rendered',
                      context: {},
                    }}
                  />
                )}
              </Paper>
            </Stack>
          </Box>
        </Stack>
      </Stack>
    </Container>
  );
}
