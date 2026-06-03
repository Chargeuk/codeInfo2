import {
  type ChatAgentFlagDescriptor,
  type ChatAgentFlagKey,
  type ChatAgentFlagValue,
} from '@codeinfo2/common';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LayersRoundedIcon from '@mui/icons-material/LayersRounded';
import SettingsSuggestRoundedIcon from '@mui/icons-material/SettingsSuggestRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import {
  Alert,
  Avatar,
  Chip,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Box,
  IconButton,
  Link,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  type ChangeEvent,
  type FocusEvent,
  FormEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AgentFlagsPanel from '../components/chat/AgentFlagsPanel';
import ConversationList from '../components/chat/ConversationList';
import SharedTranscript from '../components/chat/SharedTranscript';
import SharedTranscriptSurface from '../components/chat/SharedTranscriptSurface';
import {
  buildStepLine,
  buildTimingLine,
  buildUsageLine,
  formatBubbleTimestamp,
} from '../components/chat/chatTranscriptFormatting';
import useSharedTranscriptState from '../components/chat/useSharedTranscriptState';
import DirectoryPickerDialog from '../components/ingest/DirectoryPickerDialog';
import WorkspaceDesktopShell from '../components/workspace/WorkspaceDesktopShell';
import WorkspaceMobileAppMenuOverlay from '../components/workspace/WorkspaceMobileAppMenuOverlay';
import WorkspaceMobileConversationsOverlay from '../components/workspace/WorkspaceMobileConversationsOverlay';
import WorkspaceMobileTopBar from '../components/workspace/WorkspaceMobileTopBar';
import CommonComposerFooter from '../components/workspace/composer/CommonComposerFooter';
import CommonComposerMainInputRow from '../components/workspace/composer/CommonComposerMainInputRow';
import CommonComposerShell from '../components/workspace/composer/CommonComposerShell';
import ComposerDesktopPopover from '../components/workspace/composer/ComposerDesktopPopover';
import ComposerFooterButton from '../components/workspace/composer/ComposerFooterButton';
import ComposerMobileDialog from '../components/workspace/composer/ComposerMobileDialog';
import ComposerSendButton from '../components/workspace/composer/ComposerSendButton';
import ThinkingLevelIcon from '../components/workspace/composer/ThinkingLevelIcon';
import {
  buildComposerOptionSummary,
  formatEndpointAwareModelLabel,
  formatComposerModelLabel,
  formatThinkingModeLabel,
  getComposerModelPresentation,
  getComposerProviderPresentation,
  getWorkingFolderName,
} from '../components/workspace/composer/composerFormatting';
import useChatModel from '../hooks/useChatModel';
import useChatStream, {
  type ChatAgentFlagDraft,
  ChatMessage,
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
import buildStoredTurnHydrationKey from '../utils/buildStoredTurnHydrationKey';
import { isDevEnv } from '../utils/isDevEnv';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeAgentFlagValue = (
  descriptor: ChatAgentFlagDescriptor,
  value: unknown,
): ChatAgentFlagValue | undefined => {
  if (descriptor.controlType === 'boolean') {
    return typeof value === 'boolean' ? value : undefined;
  }

  if (descriptor.controlType === 'number') {
    const nextValue =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim().length > 0
          ? Number(value)
          : NaN;
    if (!Number.isFinite(nextValue)) {
      return undefined;
    }
    if (descriptor.integer && !Number.isInteger(nextValue)) {
      return undefined;
    }
    if (typeof descriptor.min === 'number' && nextValue < descriptor.min) {
      return undefined;
    }
    if (typeof descriptor.max === 'number' && nextValue > descriptor.max) {
      return undefined;
    }
    return nextValue;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (
    descriptor.supportedValues &&
    !descriptor.supportedValues.some((entry) => entry.value === trimmed)
  ) {
    return undefined;
  }

  return trimmed;
};

const buildAgentFlagDraft = (
  descriptors: ChatAgentFlagDescriptor[],
  preferredValues?: Record<string, unknown>,
): ChatAgentFlagDraft => {
  const nextDraft: ChatAgentFlagDraft = {};

  descriptors.forEach((descriptor) => {
    const preferredValue =
      preferredValues && Object.hasOwn(preferredValues, descriptor.key)
        ? preferredValues[descriptor.key]
        : undefined;
    nextDraft[descriptor.key] =
      normalizeAgentFlagValue(descriptor, preferredValue) ??
      descriptor.resolvedDefault;
  });

  return nextDraft;
};

const readConversationAgentFlags = (
  flags: unknown,
): Record<string, unknown> | undefined => {
  if (!isRecord(flags) || !isRecord(flags.agentFlags)) {
    return undefined;
  }
  return flags.agentFlags;
};

type ComposerInfoEntry = {
  key: string;
  label: string;
  value: string;
  icon: ReactNode;
  iconTestId?: string;
};

type ComposerInfoSection = {
  key: string;
  title: string;
  eyebrow: string;
  entries: ComposerInfoEntry[];
  emptyMessage?: string;
  summaryChipLabel?: string;
};

export default function ChatPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const drawerWidth = 320;
  const [mobileConversationsOpen, setMobileConversationsOpen] =
    useState<boolean>(false);
  const [mobileAppMenuOpen, setMobileAppMenuOpen] = useState<boolean>(false);
  const [desktopDrawerOpen, setDesktopDrawerOpen] = useState<boolean>(() =>
    isMobile ? false : true,
  );
  const conversationPaneOpen = isMobile
    ? mobileConversationsOpen
    : desktopDrawerOpen;

  useEffect(() => {
    if (!isMobile || typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('codeinfo-mobile-conversations-overlay-change', {
        detail: { open: mobileConversationsOpen },
      }),
    );
  }, [isMobile, mobileConversationsOpen]);

  useEffect(() => {
    if (isMobile) {
      setMobileConversationsOpen(false);
      setMobileAppMenuOpen(false);
      return;
    }

    setDesktopDrawerOpen(true);
  }, [isMobile]);

  const {
    providers,
    provider,
    setProvider,
    providerStatus,
    providerReason,
    available: providerAvailable,
    toolsAvailable,
    models,
    selected,
    setSelected,
    selectedModelCapabilities,
    agentFlags: availableAgentFlags,
    errorMessage,
    providerErrorMessage,
    codexWarnings,
    isLoading,
    isError,
    isEmpty,
    refreshModels,
    refreshProviders,
    selectedEndpointId,
  } = useChatModel();
  const [agentFlagsDraft, setAgentFlagsDraft] = useState<ChatAgentFlagDraft>(
    {},
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
  } = useChatStream(selected, provider, selectedEndpointId, agentFlagsDraft);

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
  const draftSelectionRef = useRef<{
    provider?: string;
    model?: string;
    endpointId?: string | null;
  } | null>(null);
  const previousConversationIdRef = useRef<string | undefined>(undefined);
  const [input, setInput] = useState('');
  const [workingFolder, setWorkingFolder] = useState('');
  const [dirPickerOpen, setDirPickerOpen] = useState(false);
  const [composerInfoAnchorEl, setComposerInfoAnchorEl] =
    useState<HTMLElement | null>(null);
  const [composerWorkingFolderAnchorEl, setComposerWorkingFolderAnchorEl] =
    useState<HTMLElement | null>(null);
  const [composerProviderAnchorEl, setComposerProviderAnchorEl] =
    useState<HTMLElement | null>(null);
  const [composerModelAnchorEl, setComposerModelAnchorEl] =
    useState<HTMLElement | null>(null);
  const [composerOptionsAnchorEl, setComposerOptionsAnchorEl] =
    useState<HTMLElement | null>(null);
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
      setDrawerTopOffsetPx(top > 0 ? top : 24);
    };

    updateOffset();
    window.addEventListener('resize', updateOffset);
    return () => window.removeEventListener('resize', updateOffset);
  }, [isMobile, persistenceUnavailable]);

  const log = useMemo(() => createLogger('client'), []);
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
  const codexWarningList = useMemo(
    () => (providerIsCodex ? (codexWarnings ?? []) : []),
    [codexWarnings, providerIsCodex],
  );
  const showCodexWarnings = codexWarningList.length > 0;
  const codexWarningsRef = useRef('');
  const agentFlagsAppliedStateRef = useRef<string | null>(null);
  const activeAgentFlagsStateKey = useMemo(
    () =>
      JSON.stringify(
        availableAgentFlags.map((descriptor) => ({
          key: descriptor.key,
          resolvedDefault: descriptor.resolvedDefault,
          supportedValues:
            descriptor.supportedValues?.map((entry) => entry.value) ?? [],
          min: descriptor.min,
          max: descriptor.max,
          integer: descriptor.integer,
        })),
      ),
    [availableAgentFlags],
  );
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
  const nextSendContextLocked = providerLocked;
  const showStop = isSending || isStopping;
  const chatWorkingFolderLocked =
    isSending ||
    isStopping ||
    Boolean(inflightSnapshot?.inflightId) ||
    Boolean(serverVisibleInflightId);
  const isWorkingFolderDisabled =
    chatWorkingFolderLocked || persistenceUnavailable;
  const combinedError =
    providerErrorMessage ?? errorMessage ?? 'Failed to load chat options.';
  const retryFetch = useCallback(() => {
    void refreshProviders();
    if (provider) {
      void refreshModels(provider);
    }
  }, [provider, refreshModels, refreshProviders]);

  const orderedMessages = messages;

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
    const el = document.querySelector(
      '[data-testid="chat-controls"]',
    ) as HTMLElement | null;
    if (el) {
      console.info(
        '[ChatPage] chat-controls inline style.flex:',
        el.style.flex,
      );
    }
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

  useEffect(() => {
    if (!isDevEnv()) return;
    if (codexDocsLoggedRef.current) return;
    if (isLoading) return;
    if (providers.length === 0 && models.length === 0) return;
    codexDocsLoggedRef.current = true;
    console.info('[codex-docs] docs synced', { source: '/chat/models' });
  }, [isLoading, models.length, providers.length]);

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
    if (availableAgentFlags.length === 0) {
      if (Object.keys(agentFlagsDraft).length > 0) {
        setAgentFlagsDraft({});
      }
      agentFlagsAppliedStateRef.current = null;
      return;
    }

    const restoredFlags = readConversationAgentFlags(
      selectedConversation?.flags,
    );
    const stateKey = selectedConversation?.conversationId
      ? `conversation:${selectedConversation.conversationId}:${provider ?? 'none'}:${selected ?? 'none'}:${activeAgentFlagsStateKey}`
      : `draft:${activeConversationId ?? conversationId}:${provider ?? 'none'}:${selected ?? 'none'}:${activeAgentFlagsStateKey}`;

    if (agentFlagsAppliedStateRef.current === stateKey) {
      return;
    }

    setAgentFlagsDraft(buildAgentFlagDraft(availableAgentFlags, restoredFlags));
    agentFlagsAppliedStateRef.current = stateKey;
  }, [
    activeAgentFlagsStateKey,
    activeConversationId,
    agentFlagsDraft,
    availableAgentFlags,
    conversationId,
    provider,
    selected,
    selectedConversation?.conversationId,
    selectedConversation?.flags,
  ]);

  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const resumedProvider = selectedConversation?.provider?.trim() || undefined;
  const resumedModel = selectedConversation?.model?.trim() || undefined;
  const resumedExecutionIdentityLocked = Boolean(
    selectedConversation?.conversationId && resumedProvider && resumedModel,
  );

  useEffect(() => {
    if (selectedConversation?.conversationId) {
      return;
    }

    if (previousConversationIdRef.current) {
      return;
    }

    draftSelectionRef.current = {
      provider: provider ?? undefined,
      model: selected ?? undefined,
      endpointId: selectedEndpointId ?? null,
    };
  }, [
    provider,
    selected,
    selectedConversation?.conversationId,
    selectedEndpointId,
  ]);

  useEffect(() => {
    const previousConversationId = previousConversationIdRef.current;
    previousConversationIdRef.current = selectedConversation?.conversationId;

    if (selectedConversation?.conversationId) {
      if (resumedProvider) {
        setProvider(resumedProvider, { source: 'conversation-select' });
      }
      if (resumedModel) {
        const endpointAwareMatch =
          models.find(
            (model) =>
              model.key === resumedModel &&
              (selectedEndpointId === undefined ||
                (model.endpointId ?? undefined) ===
                  (selectedEndpointId ?? undefined)),
          ) ?? models.find((model) => model.key === resumedModel);
        setSelected(endpointAwareMatch?.key ?? resumedModel, {
          source: 'conversation-select',
          endpointId:
            endpointAwareMatch?.endpointId ?? selectedEndpointId ?? null,
        });
      }
      return;
    }

    if (!previousConversationId) {
      return;
    }

    const draftSelection = draftSelectionRef.current;
    if (!draftSelection?.provider || !draftSelection.model) {
      return;
    }

    if (draftSelection.provider !== provider) {
      setProvider(draftSelection.provider, {
        source: 'conversation-sync',
      });
    }
    if (
      draftSelection.model !== selected ||
      (draftSelection.endpointId ?? undefined) !==
        (selectedEndpointId ?? undefined)
    ) {
      setSelected(draftSelection.model, {
        source: 'conversation-sync',
        endpointId: draftSelection.endpointId ?? null,
      });
    }
  }, [
    models,
    resumedModel,
    resumedProvider,
    provider,
    selected,
    selectedConversation?.conversationId,
    setProvider,
    setSelected,
    selectedEndpointId,
  ]);

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
      useResumedExecutionIdentity: resumedExecutionIdentityLocked,
      resumedProvider: resumedProvider ?? null,
      resumedModel: resumedModel ?? null,
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
      providerOverride: resumedExecutionIdentityLocked
        ? resumedProvider
        : undefined,
      modelOverride: resumedExecutionIdentityLocked ? resumedModel : undefined,
    }).then(() => refreshConversations());
    setInput('');
  };

  const persistWorkingFolder = useCallback(
    async (nextValue?: string) => {
      const trimmedWorkingFolder = (nextValue ?? workingFolder).trim();
      setWorkingFolder(trimmedWorkingFolder);
      if (!selectedConversationId || isWorkingFolderDisabled) {
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
      isWorkingFolderDisabled,
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
    if (isWorkingFolderDisabled) return;
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
    if (providerLocked && resetReason === 'new-conversation') {
      return;
    }
    if (nextSendContextLocked && resetReason === 'model-change') {
      return;
    }
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
    agentFlagsAppliedStateRef.current = null;
    if (resetReason === 'new-conversation') {
      log('info', 'DEV-0000046:T8:new-conversation-local-reset', {
        previousConversationId: activeConversationId ?? null,
        nextConversationId: nextId,
        olderConversationRemainedInflight,
        cancelSent: false,
      });
    }
  };

  const applyProviderSelection = (nextProvider: string) => {
    if (nextSendContextLocked || resumedExecutionIdentityLocked) {
      return;
    }

    const previousProvider = provider ?? null;
    const currentConversationId = activeConversationId ?? null;
    handleNewConversation({ reason: 'provider-change', nextProvider });
    setSelected(undefined, {
      nextSendOnly: true,
      source: 'model-fallback',
    });
    setProvider(nextProvider, {
      nextSendOnly: true,
      source: 'provider-change',
    });
    void refreshModels(nextProvider);
    log('info', 'DEV-0000046:T9:provider-next-send-updated', {
      previousProvider,
      nextProvider,
      activeConversationId: currentConversationId,
      cancelSent: false,
    });
  };

  const applyModelSelection = (nextModel: string, nextEndpointId?: string) => {
    if (nextSendContextLocked || resumedExecutionIdentityLocked) {
      return;
    }

    if (
      !nextModel ||
      (nextModel === selected && nextEndpointId === selectedEndpointId)
    ) {
      return;
    }

    const previousModel = selected ?? null;
    const currentConversationId = activeConversationId ?? null;
    handleNewConversation({ reason: 'model-change' });
    setSelected(nextModel, {
      nextSendOnly: true,
      source: 'model-change',
      endpointId: nextEndpointId ?? null,
    });
    log('info', 'DEV-0000046:T10:model-next-send-updated', {
      previousModel,
      nextModel,
      activeConversationId: currentConversationId,
      cancelSent: false,
    });
  };

  const handleAgentFlagChange = useCallback(
    (key: ChatAgentFlagKey, value: ChatAgentFlagValue | undefined) => {
      setAgentFlagsDraft((current) => {
        if (value === undefined) {
          const next = { ...current };
          delete next[key];
          return next;
        }
        return { ...current, [key]: value };
      });
    },
    [],
  );

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
    if (nextSendContextLocked) return;
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
      setMobileConversationsOpen(false);
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

  const composerProviderPresentation = useMemo(
    () => getComposerProviderPresentation(provider, selected),
    [provider, selected],
  );
  const modelDisplayLabelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    models.forEach((model) => {
      const baseLabel = formatEndpointAwareModelLabel(
        model.displayName,
        model.endpointId,
      );
      counts.set(baseLabel, (counts.get(baseLabel) ?? 0) + 1);
    });
    return counts;
  }, [models]);
  const getModelDisplayLabel = useCallback(
    (model: (typeof models)[number]) => {
      const baseLabel = formatEndpointAwareModelLabel(
        model.displayName,
        model.endpointId,
      );
      if ((modelDisplayLabelCounts.get(baseLabel) ?? 0) > 1) {
        return formatEndpointAwareModelLabel(
          model.displayName,
          model.endpointId,
          {
            includePathHint: true,
          },
        );
      }
      return baseLabel;
    },
    [modelDisplayLabelCounts],
  );
  const selectedModel = useMemo(
    () =>
      models.find(
        (model) =>
          model.key === selected &&
          (model.endpointId ?? undefined) === (selectedEndpointId ?? undefined),
      ),
    [models, selected, selectedEndpointId],
  );
  const selectedModelDisplayName = selectedModel
    ? getModelDisplayLabel(selectedModel)
    : formatEndpointAwareModelLabel(selected, selectedEndpointId);
  const reasoningDescriptor = availableAgentFlags.find(
    (descriptor) => descriptor.key === 'modelReasoningEffort',
  );
  const composerThinkingMode =
    typeof agentFlagsDraft.modelReasoningEffort === 'string'
      ? agentFlagsDraft.modelReasoningEffort
      : typeof reasoningDescriptor?.resolvedDefault === 'string'
        ? reasoningDescriptor.resolvedDefault
        : undefined;
  const composerModelValue = formatComposerModelLabel(
    composerThinkingMode,
    selectedModelDisplayName,
  );
  const composerModelButtonValue = isMobile
    ? selectedModelDisplayName
    : composerModelValue;
  const composerWorkingFolderName =
    getWorkingFolderName(workingFolder) || 'Select folder';
  const composerOptionDescriptors = availableAgentFlags.filter(
    (descriptor) => descriptor.key !== 'modelReasoningEffort',
  );
  const composerOptionSummary = useMemo(
    () => buildComposerOptionSummary(availableAgentFlags, agentFlagsDraft),
    [agentFlagsDraft, availableAgentFlags],
  );
  const composerReasoningOptions = useMemo(() => {
    const supportedReasoningEfforts = selectedModelCapabilities
      ?.supportedReasoningEfforts?.length
      ? selectedModelCapabilities.supportedReasoningEfforts
      : (reasoningDescriptor?.supportedValues?.map((entry) =>
          String(entry.value),
        ) ?? []);

    return supportedReasoningEfforts.map((value) => ({
      value,
      label: formatThinkingModeLabel(value),
    }));
  }, [reasoningDescriptor, selectedModelCapabilities]);
  const composerInfoSections = useMemo<ComposerInfoSection[]>(
    () => [
      {
        key: 'context',
        title: 'Run context',
        eyebrow: 'Current chat send context',
        summaryChipLabel: 'Live',
        entries: [
          {
            key: 'provider',
            label: 'Provider',
            value: composerProviderPresentation.label,
            icon: composerProviderPresentation.icon,
            iconTestId: 'chat-composer-info-provider-icon',
          },
          {
            key: 'model',
            label: 'Model',
            value: composerModelValue,
            icon: getComposerModelPresentation(
              provider,
              selectedModelDisplayName,
            ).icon,
            iconTestId: 'chat-composer-info-model-icon',
          },
          {
            key: 'thinking-mode',
            label: 'Thinking mode',
            value: formatThinkingModeLabel(composerThinkingMode),
            icon: (
              <ThinkingLevelIcon
                level={composerThinkingMode}
                data-testid="chat-composer-info-thinking-icon"
              />
            ),
          },
          {
            key: 'working-path',
            label: 'Selected working path',
            value: composerWorkingFolderName,
            icon: <FolderOutlinedIcon fontSize="small" />,
            iconTestId: 'chat-composer-info-working-path-icon',
          },
        ],
      },
      {
        key: 'options',
        title: 'Active options',
        eyebrow: 'Overrides from defaults',
        summaryChipLabel:
          composerOptionSummary.length > 0
            ? `${composerOptionSummary.length} changed`
            : 'Defaults',
        emptyMessage:
          'No option overrides are active. New sends will use the current defaults.',
        entries: composerOptionSummary.map((entry) => ({
          key: entry.label,
          label: entry.label,
          value: entry.value,
          icon: <SettingsSuggestRoundedIcon fontSize="small" />,
        })),
      },
    ],
    [
      composerModelValue,
      composerOptionSummary,
      composerProviderPresentation.icon,
      composerProviderPresentation.label,
      composerThinkingMode,
      composerWorkingFolderName,
      provider,
      selectedModelDisplayName,
    ],
  );
  const isComposerTestMode =
    typeof window !== 'undefined' &&
    (window as unknown as { __CODEINFO_TEST__?: boolean }).__CODEINFO_TEST__;

  const closeComposerSurfaces = () => {
    setComposerInfoAnchorEl(null);
    setComposerWorkingFolderAnchorEl(null);
    setComposerProviderAnchorEl(null);
    setComposerModelAnchorEl(null);
    setComposerOptionsAnchorEl(null);
  };

  const handleComposerInfoOpen = (event: MouseEvent<HTMLElement>) => {
    closeComposerSurfaces();
    setComposerInfoAnchorEl(event.currentTarget);
  };

  const handleComposerInfoClose = () => {
    setComposerInfoAnchorEl(null);
  };

  const handleComposerWorkingFolderOpen = (event: MouseEvent<HTMLElement>) => {
    void event;
    closeComposerSurfaces();
    handleOpenDirPicker();
  };

  const handleComposerWorkingFolderClose = () => {
    setComposerWorkingFolderAnchorEl(null);
  };

  const handleComposerProviderOpen = (event: MouseEvent<HTMLElement>) => {
    closeComposerSurfaces();
    setComposerProviderAnchorEl(event.currentTarget);
  };

  const handleComposerProviderClose = () => {
    setComposerProviderAnchorEl(null);
  };

  const handleComposerModelOpen = (event: MouseEvent<HTMLElement>) => {
    closeComposerSurfaces();
    setComposerModelAnchorEl(event.currentTarget);
  };

  const handleComposerModelClose = () => {
    setComposerModelAnchorEl(null);
  };

  const handleComposerOptionsOpen = (event: MouseEvent<HTMLElement>) => {
    closeComposerSurfaces();
    setComposerOptionsAnchorEl(event.currentTarget);
  };

  const handleComposerOptionsClose = () => {
    setComposerOptionsAnchorEl(null);
  };

  const handleComposerReasoningSelection = (nextReasoning: string) => {
    if (nextSendContextLocked || resumedExecutionIdentityLocked) {
      return;
    }

    handleAgentFlagChange('modelReasoningEffort', nextReasoning);
    handleComposerModelClose();
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
    if (!isWorkingFolderDisabled) {
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
    isWorkingFolderDisabled,
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
            provider: turn.provider,
            model: turn.model,
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
    const key = buildStoredTurnHydrationKey(activeConversationId, turns);
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

  const conversationList = (
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
      selectionDisabled={nextSendContextLocked}
      newActionDisabled={providerLocked}
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
      onNewConversation={() => handleNewConversation()}
    />
  );

  const chatContentFrameSx = {
    width: { xs: 'calc(100vw - 8px)', sm: '100%' },
    maxWidth: 'none',
    position: 'relative',
    left: { xs: '50%', sm: 'auto' },
    transform: { xs: 'translateX(-50%)', sm: 'none' },
    px: { xs: 0, sm: 1.5 },
  } as const;

  const transcriptSurface = (
    <SharedTranscriptSurface>
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
          No chat-capable models available for this provider. Add a supported
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
            eventName: 'DEV-0000049:T01:chat_shared_transcript_rendered',
            context: {},
          }}
        />
      )}
    </SharedTranscriptSurface>
  );

  const composerInfoContent = (
    <Stack spacing={2} data-testid="chat-composer-info-content">
      <Box
        sx={{
          p: 1.5,
          borderRadius: 3,
          border: `1px solid ${alpha(theme.palette.info.main, 0.22)}`,
          backgroundColor: alpha(theme.palette.info.main, 0.08),
        }}
      >
        <Stack direction="row" spacing={1.25} alignItems="flex-start">
          <Avatar
            sx={{
              width: 34,
              height: 34,
              bgcolor: alpha(theme.palette.info.main, 0.16),
              color: 'info.main',
            }}
          >
            <InfoOutlinedIcon fontSize="small" />
          </Avatar>
          <Stack spacing={0.25} minWidth={0}>
            <Typography variant="subtitle2" fontWeight={700}>
              Current send context
            </Typography>
            <Typography variant="body2" color="text.secondary">
              These values describe exactly what the next chat run will use.
            </Typography>
          </Stack>
        </Stack>
      </Box>

      {composerInfoSections.map((section) => (
        <Box
          key={section.key}
          sx={{
            borderRadius: 3,
            border: `1px solid ${theme.palette.divider}`,
            overflow: 'hidden',
            bgcolor: 'background.paper',
          }}
          data-testid={`chat-composer-info-section-${section.key}`}
        >
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={1}
            sx={{
              px: 1.5,
              py: 1.25,
              borderBottom: `1px solid ${theme.palette.divider}`,
              bgcolor: alpha(theme.palette.text.primary, 0.02),
            }}
          >
            <Stack spacing={0.125} minWidth={0}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  fontWeight: 700,
                }}
              >
                {section.eyebrow}
              </Typography>
              <Typography variant="subtitle2" fontWeight={700}>
                {section.title}
              </Typography>
            </Stack>
            {section.summaryChipLabel ? (
              <Chip
                size="small"
                label={section.summaryChipLabel}
                color={section.key === 'options' ? 'default' : 'info'}
                variant={section.key === 'options' ? 'outlined' : 'filled'}
              />
            ) : null}
          </Stack>

          {section.entries.length > 0 ? (
            <Stack divider={<Divider flexItem />}>
              {section.entries.map((entry) => (
                <Stack
                  key={entry.key}
                  direction="row"
                  spacing={1.25}
                  alignItems="center"
                  sx={{ px: 1.5, py: 1.25 }}
                >
                  <Avatar
                    variant="rounded"
                    sx={{
                      width: 34,
                      height: 34,
                      borderRadius: 2,
                      bgcolor:
                        section.key === 'options'
                          ? alpha(theme.palette.text.primary, 0.07)
                          : alpha(theme.palette.info.main, 0.12),
                      color:
                        section.key === 'options'
                          ? 'text.secondary'
                          : 'info.main',
                    }}
                  >
                    <Box
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      data-testid={entry.iconTestId}
                    >
                      {entry.icon}
                    </Box>
                  </Avatar>
                  <Stack spacing={0.2} minWidth={0} sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {entry.label}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        wordBreak: 'break-word',
                        fontWeight: 600,
                      }}
                    >
                      {entry.value}
                    </Typography>
                  </Stack>
                </Stack>
              ))}
            </Stack>
          ) : (
            <Stack
              direction="row"
              spacing={1.25}
              alignItems="center"
              sx={{ px: 1.5, py: 1.5 }}
            >
              <Avatar
                variant="rounded"
                sx={{
                  width: 34,
                  height: 34,
                  borderRadius: 2,
                  bgcolor: alpha(theme.palette.text.primary, 0.07),
                  color: 'text.secondary',
                }}
              >
                <LayersRoundedIcon fontSize="small" />
              </Avatar>
              <Typography variant="body2" color="text.secondary">
                {section.emptyMessage}
              </Typography>
            </Stack>
          )}
        </Box>
      ))}
    </Stack>
  );

  const composerWorkingFolderContent = (
    <Stack spacing={2}>
      <TextField
        fullWidth
        size="small"
        label="Working folder"
        placeholder="Absolute host path (optional)"
        value={workingFolder}
        onChange={(event) => setWorkingFolder(event.target.value)}
        onBlur={(event) => {
          void persistWorkingFolder(event.target.value);
        }}
        slotProps={{
          htmlInput: { 'data-testid': 'chat-working-folder-input' },
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
      />
      <Stack direction="row" spacing={1.5} justifyContent="space-between">
        <Button
          type="button"
          variant="outlined"
          size="small"
          onClick={handleOpenDirPicker}
          disabled={isWorkingFolderDisabled}
          data-testid="chat-working-folder-picker"
        >
          Choose folder…
        </Button>
        <Button
          type="button"
          variant="text"
          size="small"
          onClick={() => void persistWorkingFolder('')}
          disabled={isWorkingFolderDisabled}
        >
          Clear
        </Button>
      </Stack>
    </Stack>
  );

  const composerProviderContent = (
    <List disablePadding dense role="listbox" aria-label="Provider options">
      {providers.map((entry) => {
        const presentation = getComposerProviderPresentation(
          entry.id,
          entry.defaultModel,
        );
        const unavailable = !entry.available;
        return (
          <ListItemButton
            key={entry.id}
            component="div"
            role="option"
            aria-label={
              unavailable
                ? `${entry.label} (unavailable: ${entry.reason ?? 'Unavailable'})`
                : entry.label
            }
            aria-selected={entry.id === provider}
            selected={entry.id === provider}
            disabled={
              unavailable ||
              providerStatus === 'loading' ||
              providerLocked ||
              resumedExecutionIdentityLocked
            }
            onClick={() => {
              handleComposerProviderClose();
              applyProviderSelection(entry.id);
            }}
          >
            <ListItemIcon sx={{ minWidth: 36, color: 'text.secondary' }}>
              {presentation.icon}
            </ListItemIcon>
            <ListItemText
              primary={entry.label}
              secondary={
                unavailable
                  ? entry.reason
                    ? ` (unavailable: ${entry.reason})`
                    : '(unavailable)'
                  : null
              }
            />
          </ListItemButton>
        );
      })}
    </List>
  );

  const composerModelContent = (
    <Stack spacing={1.5}>
      {composerReasoningOptions.length > 0 ? (
        <Stack spacing={0.75}>
          {isMobile ? null : (
            <Typography variant="overline" color="text.secondary">
              Thinking modes
            </Typography>
          )}
          <List
            disablePadding
            dense
            role="listbox"
            aria-label="Thinking mode options"
          >
            {composerReasoningOptions.map((option) => (
              <ListItemButton
                key={`reasoning-${option.value}`}
                component="div"
                role="option"
                aria-label={option.label}
                aria-selected={composerThinkingMode === option.value}
                selected={composerThinkingMode === option.value}
                disabled={
                  nextSendContextLocked || resumedExecutionIdentityLocked
                }
                onClick={() => handleComposerReasoningSelection(option.value)}
              >
                <ListItemIcon sx={{ minWidth: 36, color: 'text.secondary' }}>
                  <ThinkingLevelIcon level={option.value} />
                </ListItemIcon>
                <ListItemText
                  primary={option.label}
                  secondary={isMobile ? null : 'Thinking mode'}
                />
              </ListItemButton>
            ))}
          </List>
        </Stack>
      ) : null}
      {composerReasoningOptions.length > 0 ? <Divider /> : null}
      <List disablePadding dense role="listbox" aria-label="Model options">
        {models.length > 0 ? (
          models.map((model) => {
            const presentation = getComposerModelPresentation(
              provider,
              model.displayName,
            );
            const isSelectedModel =
              selected === model.key &&
              (selectedEndpointId ?? undefined) ===
                (model.endpointId ?? undefined);
            const modelLabel = getModelDisplayLabel(model);

            return (
              <ListItemButton
                key={`${model.key}:${model.endpointId ?? ''}`}
                component="div"
                role="option"
                aria-label={modelLabel}
                aria-selected={isSelectedModel}
                selected={isSelectedModel}
                disabled={
                  isLoading ||
                  isError ||
                  isEmpty ||
                  !providerAvailable ||
                  nextSendContextLocked ||
                  resumedExecutionIdentityLocked
                }
                onClick={() => {
                  handleComposerModelClose();
                  applyModelSelection(model.key, model.endpointId);
                }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  {presentation.icon}
                </ListItemIcon>
                <ListItemText
                  primary={modelLabel}
                  secondary={presentation.label}
                />
              </ListItemButton>
            );
          })
        ) : (
          <Stack sx={{ px: 1, py: 2 }}>
            <Typography variant="body2" color="text.secondary">
              No chat-capable models are available for the selected provider.
            </Typography>
          </Stack>
        )}
      </List>
    </Stack>
  );

  const composerOptionsContent = (
    <Stack spacing={1.5}>
      {composerOptionDescriptors.length > 0 ? (
        <AgentFlagsPanel
          descriptors={composerOptionDescriptors}
          values={agentFlagsDraft}
          onChange={handleAgentFlagChange}
          disabled={controlsDisabled}
        />
      ) : (
        <Typography variant="body2" color="text.secondary">
          No additional options are available for the selected provider and
          model.
        </Typography>
      )}
    </Stack>
  );
  const composerSupplementalContent = (
    <>
      {isComposerTestMode && availableAgentFlags.length > 0 ? (
        <Box
          sx={{
            position: 'absolute',
            left: -10000,
            top: 'auto',
            width: 320,
          }}
        >
          <AgentFlagsPanel
            descriptors={availableAgentFlags}
            values={agentFlagsDraft}
            onChange={handleAgentFlagChange}
            disabled={controlsDisabled}
          />
        </Box>
      ) : null}
      {showCodexWarnings ? (
        <Alert severity="warning" data-testid="codex-warnings-banner">
          <Stack spacing={0.5}>
            {codexWarningList.map((warning, index) => (
              <Typography key={`${warning}-${index}`} variant="body2">
                {warning}
              </Typography>
            ))}
          </Stack>
        </Alert>
      ) : null}
      {showCodexUnavailable ? (
        <Alert severity="warning" data-testid="codex-unavailable-banner">
          OpenAI Codex is unavailable. Install the CLI (`npm install -g
          @openai/codex`), log in with `CODEX_HOME=./codex codex login` (or your
          `~/.codex`), and ensure `./codex/config.toml` is seeded. The
          checked-in main Compose stack exposes the host Codex home read-only at
          `/host/codex` and seeds or repairs the writable `/app/codex` runtime
          home from it, so container logins are not required there. If Codex
          later fails with `refresh_token_reused` or `token_expired`, rerun
          `codex login` against the Codex home backing the runtime you are using
          and restart that stack. See the guidance in{' '}
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
      {showCodexToolsMissing ? (
        <Alert severity="warning" data-testid="codex-tools-banner">
          Codex requires MCP tools. Ensure `config.toml` lists the `/mcp`
          endpoints and that tools are enabled, then retry once the
          CLI/auth/config prerequisites above are satisfied.
        </Alert>
      ) : null}
    </>
  );
  const hasComposerSupplementalContent =
    (isComposerTestMode && availableAgentFlags.length > 0) ||
    showCodexWarnings ||
    showCodexUnavailable ||
    showCodexToolsMissing;

  const composerSurface = (
    <CommonComposerShell
      data-testid="chat-controls"
      onSubmit={handleSubmit}
      mainInputRow={
        <CommonComposerMainInputRow>
          <TextField
            inputRef={inputRef}
            fullWidth
            multiline
            minRows={1}
            maxRows={6}
            size="small"
            placeholder="Type your prompt"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={controlsDisabled}
            slotProps={{
              htmlInput: {
                'data-testid': 'chat-input',
                'aria-label': 'Message',
              },
            }}
            helperText={
              providerIsCodex && (!providerAvailable || !toolsAvailable)
                ? 'Codex is unavailable until the CLI is installed, logged in, and MCP tools are enabled.'
                : undefined
            }
            sx={{
              flex: 1,
              minWidth: 0,
              '& .MuiInputBase-root': {
                minHeight: { xs: 32, sm: 42 },
                alignItems: 'center',
                pl: { xs: 0.125, sm: 1.25 },
                pr: { xs: 0.75, sm: 1.25 },
                py: { xs: 0.5, sm: 0.75 },
              },
              '& .MuiInputBase-inputMultiline': {
                p: 0,
                lineHeight: 1.35,
              },
            }}
          />
          <ComposerSendButton
            showStop={showStop}
            isStopping={isStopping}
            disabled={showStop ? isStopping : controlsDisabled || isSending}
            onClick={showStop ? handleStop : undefined}
            data-testid="chat-send"
          />
        </CommonComposerMainInputRow>
      }
      footerRow={
        <CommonComposerFooter>
          <ComposerFooterButton
            icon={<InfoOutlinedIcon fontSize="small" />}
            label="Info"
            iconOnly
            ariaLabel="Composer info"
            selected={Boolean(composerInfoAnchorEl)}
            onClick={handleComposerInfoOpen}
            data-testid="chat-composer-info"
          />
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
            <Tooltip title="New conversation">
              <span>
                <ComposerFooterButton
                  icon={<EditOutlinedIcon fontSize="small" />}
                  label="New"
                  iconOnly
                  ariaLabel="Reset chat draft"
                  onClick={() => handleNewConversation()}
                  disabled={providerLocked}
                  data-testid="chat-new-conversation-trigger"
                />
              </span>
            </Tooltip>
          </Box>
          <ComposerFooterButton
            icon={<FolderOutlinedIcon fontSize="small" />}
            label="Working path"
            value={composerWorkingFolderName}
            selected={dirPickerOpen}
            onClick={handleComposerWorkingFolderOpen}
            data-testid="chat-working-folder-trigger"
            disabled={isWorkingFolderDisabled}
            ariaHaspopup="dialog"
            ariaExpanded={dirPickerOpen}
          />
          <ComposerFooterButton
            icon={composerProviderPresentation.icon}
            label="Provider"
            value={composerProviderPresentation.label}
            selected={Boolean(composerProviderAnchorEl)}
            onClick={handleComposerProviderOpen}
            data-testid="provider-select"
            role="combobox"
            ariaHaspopup="listbox"
            ariaExpanded={Boolean(composerProviderAnchorEl)}
            hiddenInputValue={provider ?? ''}
            iconOnlyOnMobile
            disabled={
              providerStatus === 'loading' ||
              providerLocked ||
              resumedExecutionIdentityLocked
            }
          />
          <ComposerFooterButton
            icon={
              <ThinkingLevelIcon
                level={composerThinkingMode}
                data-testid="model-thinking-level-icon"
              />
            }
            label="Model"
            value={composerModelButtonValue}
            selected={Boolean(composerModelAnchorEl)}
            onClick={handleComposerModelOpen}
            data-testid="model-select"
            role="combobox"
            ariaHaspopup="listbox"
            ariaExpanded={Boolean(composerModelAnchorEl)}
            ariaLabel="Model"
            hiddenInputValue={selected ?? ''}
            disabled={
              isLoading ||
              isError ||
              isEmpty ||
              !providerAvailable ||
              nextSendContextLocked ||
              resumedExecutionIdentityLocked
            }
          />
          <ComposerFooterButton
            icon={<TuneRoundedIcon fontSize="small" />}
            label="Options"
            iconOnly
            ariaLabel="Options"
            selected={Boolean(composerOptionsAnchorEl)}
            onClick={handleComposerOptionsOpen}
            data-testid="chat-options"
          />
        </CommonComposerFooter>
      }
    >
      <Box
        component="input"
        value={workingFolder}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          setWorkingFolder(event.target.value)
        }
        onBlur={(event: FocusEvent<HTMLInputElement>) => {
          void persistWorkingFolder(event.target.value);
        }}
        disabled={isWorkingFolderDisabled}
        data-testid="chat-working-folder"
        aria-label="Working folder"
        sx={{
          position: 'absolute',
          width: 1,
          height: 1,
          p: 0,
          m: -1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      />
      {hasComposerSupplementalContent ? (
        <Stack spacing={1.5}>{composerSupplementalContent}</Stack>
      ) : null}

      <ComposerDesktopPopover
        id="chat-composer-info-popover"
        open={!isMobile && Boolean(composerInfoAnchorEl)}
        anchorEl={composerInfoAnchorEl}
        onClose={handleComposerInfoClose}
        width={380}
        data-testid="chat-composer-info-popover"
      >
        {composerInfoContent}
      </ComposerDesktopPopover>
      <ComposerMobileDialog
        open={isMobile && Boolean(composerInfoAnchorEl)}
        onClose={handleComposerInfoClose}
        data-testid="chat-composer-info-dialog"
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography variant="h6">Info</Typography>
            <IconButton onClick={handleComposerInfoClose} aria-label="Close">
              <CloseRoundedIcon />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>{composerInfoContent}</DialogContent>
        <DialogActions>
          <Button onClick={handleComposerInfoClose}>Close</Button>
        </DialogActions>
      </ComposerMobileDialog>

      <ComposerDesktopPopover
        id="chat-working-folder-popover"
        open={!isMobile && Boolean(composerWorkingFolderAnchorEl)}
        anchorEl={composerWorkingFolderAnchorEl}
        onClose={handleComposerWorkingFolderClose}
        width={420}
        data-testid="chat-working-folder-popover"
      >
        {composerWorkingFolderContent}
      </ComposerDesktopPopover>
      <ComposerMobileDialog
        open={isMobile && Boolean(composerWorkingFolderAnchorEl)}
        onClose={handleComposerWorkingFolderClose}
        data-testid="chat-working-folder-dialog"
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography variant="h6">Working path</Typography>
            <IconButton
              onClick={handleComposerWorkingFolderClose}
              aria-label="Close"
            >
              <CloseRoundedIcon />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>{composerWorkingFolderContent}</DialogContent>
        <DialogActions>
          <Button onClick={handleComposerWorkingFolderClose}>Close</Button>
        </DialogActions>
      </ComposerMobileDialog>

      <ComposerDesktopPopover
        id="chat-provider-popover"
        open={!isMobile && Boolean(composerProviderAnchorEl)}
        anchorEl={composerProviderAnchorEl}
        onClose={handleComposerProviderClose}
        width={360}
        data-testid="chat-provider-popover"
      >
        {composerProviderContent}
      </ComposerDesktopPopover>
      <ComposerMobileDialog
        open={isMobile && Boolean(composerProviderAnchorEl)}
        onClose={handleComposerProviderClose}
        data-testid="chat-provider-dialog"
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography variant="h6">Provider</Typography>
            <IconButton
              onClick={handleComposerProviderClose}
              aria-label="Close"
            >
              <CloseRoundedIcon />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>{composerProviderContent}</DialogContent>
        <DialogActions>
          <Button onClick={handleComposerProviderClose}>Close</Button>
        </DialogActions>
      </ComposerMobileDialog>

      <ComposerDesktopPopover
        id="chat-model-popover"
        open={!isMobile && Boolean(composerModelAnchorEl)}
        anchorEl={composerModelAnchorEl}
        onClose={handleComposerModelClose}
        width={460}
        data-testid="chat-model-popover"
      >
        {composerModelContent}
      </ComposerDesktopPopover>
      <ComposerMobileDialog
        open={isMobile && Boolean(composerModelAnchorEl)}
        onClose={handleComposerModelClose}
        data-testid="chat-model-dialog"
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography variant="h6">Model</Typography>
            <IconButton onClick={handleComposerModelClose} aria-label="Close">
              <CloseRoundedIcon />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>{composerModelContent}</DialogContent>
        <DialogActions>
          <Button onClick={handleComposerModelClose}>Close</Button>
        </DialogActions>
      </ComposerMobileDialog>

      <ComposerDesktopPopover
        id="chat-options-popover"
        open={!isMobile && Boolean(composerOptionsAnchorEl)}
        anchorEl={composerOptionsAnchorEl}
        onClose={handleComposerOptionsClose}
        width={420}
        data-testid="chat-options-popover"
      >
        {composerOptionsContent}
      </ComposerDesktopPopover>
      <ComposerMobileDialog
        open={isMobile && Boolean(composerOptionsAnchorEl)}
        onClose={handleComposerOptionsClose}
        data-testid="chat-options-dialog"
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography variant="h6">Options</Typography>
            <IconButton onClick={handleComposerOptionsClose} aria-label="Close">
              <CloseRoundedIcon />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>{composerOptionsContent}</DialogContent>
        <DialogActions>
          <Button onClick={handleComposerOptionsClose}>Close</Button>
        </DialogActions>
      </ComposerMobileDialog>

      <DirectoryPickerDialog
        open={dirPickerOpen}
        path={workingFolder}
        onClose={handleCloseDirPicker}
        onPick={handlePickDir}
        onClear={() => {
          setWorkingFolder('');
          setDirPickerOpen(false);
          void persistWorkingFolder('');
        }}
      />
    </CommonComposerShell>
  );

  const desktopWorkspace = (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <WorkspaceDesktopShell
        conversationPane={conversationList}
        transcript={transcriptSurface}
        composer={composerSurface}
        conversationPaneOpen={conversationPaneOpen}
        conversationPaneWidth={drawerWidth}
        isMobile={isMobile}
        onToggleConversationPane={() => {
          setDesktopDrawerOpen((prev) => !prev);
        }}
      />
    </Box>
  );

  const mobileWorkspace = (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
      }}
    >
      <WorkspaceMobileTopBar
        title="Chat"
        showConversationsButton
        onConversationsClick={() => setMobileConversationsOpen(true)}
        onNewClick={() => handleNewConversation()}
        newButtonLabel="New conversation"
        newButtonDisabled={providerLocked}
        onMenuClick={() => setMobileAppMenuOpen(true)}
      />
      <Box
        sx={{
          ...chatContentFrameSx,
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        }}
      >
        {transcriptSurface}
      </Box>
      <Box sx={chatContentFrameSx}>{composerSurface}</Box>
      <WorkspaceMobileConversationsOverlay
        open={mobileConversationsOpen}
        onClose={() => setMobileConversationsOpen(false)}
        list={conversationList}
        topOffsetPx={drawerTopOffsetPx}
      />
      <WorkspaceMobileAppMenuOverlay
        open={mobileAppMenuOpen}
        onClose={() => setMobileAppMenuOpen(false)}
      />
    </Box>
  );

  return (
    <Box
      ref={chatColumnRef}
      data-testid="chat-column"
      style={{ minWidth: 0, width: '100%' }}
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
      }}
    >
      {persistenceUnavailable && (
        <Alert
          severity="warning"
          data-testid="persistence-banner"
          action={
            <Button color="inherit" size="small" onClick={refreshPersistence}>
              Retry
            </Button>
          }
          sx={{ mb: 2 }}
        >
          Conversation history unavailable — messages won’t be stored until
          Mongo reconnects.
        </Alert>
      )}
      {isMobile ? mobileWorkspace : desktopWorkspace}
    </Box>
  );
}
