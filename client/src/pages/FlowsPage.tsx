import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import TitleRoundedIcon from '@mui/icons-material/TitleRounded';
import {
  Alert,
  Box,
  Paper,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Snackbar,
  Stack,
  TextField,
  Typography,
  Tooltip,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  type ChangeEvent,
  type FormEventHandler,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  FlowApiError,
  type FlowDetails,
  type FlowSummary,
  getFlowDetails,
  listFlows,
  runFlow,
} from '../api/flows';
import Markdown from '../components/Markdown';
import ConversationList from '../components/chat/ConversationList';
import SharedTranscript from '../components/chat/SharedTranscript';
import SharedTranscriptSurface from '../components/chat/SharedTranscriptSurface';
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
import ComposerInfoPanel, {
  type ComposerInfoSection,
} from '../components/workspace/composer/ComposerInfoPanel';
import ComposerMobileDialog from '../components/workspace/composer/ComposerMobileDialog';
import ComposerSendButton from '../components/workspace/composer/ComposerSendButton';
import { getWorkingFolderName } from '../components/workspace/composer/composerFormatting';
import useChatStream, { ChatMessage, ToolCall } from '../hooks/useChatStream';
import useChatWs, { type ChatWsServerEvent } from '../hooks/useChatWs';
import useConversationTurns, {
  StoredTurn,
} from '../hooks/useConversationTurns';
import useConversations from '../hooks/useConversations';
import usePersistenceStatus from '../hooks/usePersistenceStatus';
import { createLogger } from '../logging/logger';
import buildStoredTurnHydrationKey from '../utils/buildStoredTurnHydrationKey';
import { copyTextToClipboard } from '../utils/copyTextToClipboard';
import { reconcileFlowDetailsCache } from './flowsPage.shared';

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

const buildFlowStepHeaderLine = (command: ChatMessage['command']) => {
  if (
    !command ||
    command.name !== 'flow' ||
    !Number.isFinite(command.stepIndex) ||
    !Number.isFinite(command.totalSteps)
  ) {
    return null;
  }

  const label =
    typeof command.label === 'string' && command.label.trim().length > 0
      ? command.label.trim()
      : 'Flow step';
  return `${label} · ${command.stepIndex} of ${command.totalSteps}`;
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

const waitForNextPaint = () =>
  new Promise<void>((resolve) => {
    if (
      typeof window === 'undefined' ||
      typeof window.requestAnimationFrame !== 'function'
    ) {
      setTimeout(resolve, 0);
      return;
    }
    window.requestAnimationFrame(() => resolve());
  });

export default function FlowsPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  // Some headless/browser test environments report media queries inconsistently.
  // Use window.innerWidth as a fallback to determine the effective mobile
  // rendering surface so Playwright viewport sizing is respected.
  const breakpointSm =
    (theme.breakpoints as { values?: { sm?: number } })?.values?.sm ?? 600;
  const effectiveIsMobile =
    typeof window !== 'undefined'
      ? isMobile || window.innerWidth <= breakpointSm
      : isMobile;

  const drawerWidth = 320;
  const [mobileConversationsOpen, setMobileConversationsOpen] = useState(false);
  const [mobileAppMenuOpen, setMobileAppMenuOpen] = useState(false);
  const [desktopDrawerOpen, setDesktopDrawerOpen] = useState<boolean>(() =>
    effectiveIsMobile ? false : true,
  );
  const conversationPaneOpen = effectiveIsMobile
    ? mobileConversationsOpen
    : desktopDrawerOpen;

  useEffect(() => {
    if (!effectiveIsMobile || typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('codeinfo-mobile-conversations-overlay-change', {
        detail: { open: mobileConversationsOpen },
      }),
    );
  }, [effectiveIsMobile, mobileConversationsOpen]);

  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [flowDetailsByKey, setFlowDetailsByKey] = useState<
    Record<string, FlowDetails | undefined>
  >({});
  const [flowDetailsError, setFlowDetailsError] = useState<string | null>(null);
  const [flowsLoading, setFlowsLoading] = useState(true);
  const [flowsError, setFlowsError] = useState<string | null>(null);
  const [selectedFlowKey, setSelectedFlowKey] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [suppressAutoSelect, setSuppressAutoSelect] = useState(false);
  const [flowInfoAnchorEl, setFlowInfoAnchorEl] = useState<HTMLElement | null>(
    null,
  );
  const [selectedFlowAnchorEl, setSelectedFlowAnchorEl] =
    useState<HTMLElement | null>(null);
  const [titleAnchorEl, setTitleAnchorEl] = useState<HTMLElement | null>(null);
  const [titleCopyFeedback, setTitleCopyFeedback] = useState<{
    severity: 'success' | 'error';
    message: string;
  } | null>(null);

  const [workingFolder, setWorkingFolder] = useState('');
  const selectedConversationIdRef = useRef<string | undefined>(undefined);
  const workingFolderDisabledRef = useRef(false);
  const workingFolderRestoreKeyRef = useRef<string | null>(null);
  const workingFolderLockKeyRef = useRef<string | null>(null);
  const [dirPickerOpen, setDirPickerOpen] = useState(false);
  const [startPending, setStartPending] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runErrorCode, setRunErrorCode] = useState<string | null>(null);
  const [launchWarnings, setLaunchWarnings] = useState<string[]>([]);
  const [launchConversationId, setLaunchConversationId] = useState<
    string | null
  >(null);
  const freshRunReplayGuardRef = useRef(false);
  const freshRunRetryOwnershipIdRef = useRef<string | null>(null);
  const [flowModelId, setFlowModelId] = useState('unknown');
  const [flowProviderId, setFlowProviderId] = useState('unknown');

  const log = useMemo(() => createLogger('client-flows'), []);
  const assistantTranscriptVisibleRef = useRef(false);
  const acceptedLaunchConversationIdRef = useRef<string | null>(null);
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
  const selectedFlowDetails = selectedFlowKey
    ? flowDetailsByKey[selectedFlowKey]
    : undefined;
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
  } = useChatStream(flowModelId, flowProviderId);

  const displayMessages = messages;
  const hasFlowMetaLine = useMemo(
    () =>
      displayMessages.some(
        (message) =>
          message.role === 'assistant' &&
          buildFlowMetaLine(message.command) !== null,
      ),
    [displayMessages],
  );

  const flowDescription = (
    selectedFlowDetails?.description ?? selectedFlow?.description
  )?.trim();
  const flowWarnings = Array.from(
    new Set([
      ...(selectedFlowDetails?.warnings.map((warning) => warning.message) ??
        []),
      ...(selectedFlow?.warnings ?? []),
      ...(selectedFlowDetails?.disabledReason
        ? [selectedFlowDetails.disabledReason.message]
        : []),
      ...(selectedFlow?.disabled && selectedFlow?.error
        ? [selectedFlow.error]
        : []),
    ]),
  );
  const flowInfoOpen = Boolean(flowInfoAnchorEl);
  const flowInfoDisabled = !!flowsError || !selectedFlowName;
  const flowInfoEmpty =
    !flowDescription && flowWarnings.length === 0 && !flowDetailsError;
  const flowInfoEmptyMessage =
    flowDetailsError ??
    'No description or warnings are available for this flow yet.';
  const selectedFlowDisabled = Boolean(
    selectedFlowDetails?.disabled ?? selectedFlow?.disabled,
  );
  const selectedFlowLabel = selectedFlow?.label ?? 'Select flow';
  const workingFolderName = useMemo(
    () => getWorkingFolderName(workingFolder) || 'Select folder',
    [workingFolder],
  );
  const flowTitleDisabled = flowsLoading || !!flowsError || !selectedFlowName;

  const loadSelectedFlowDetails = useCallback(async () => {
    if (!selectedFlow) return undefined;

    const cached = flowDetailsByKey[selectedFlow.key];
    if (cached) return cached;

    setFlowDetailsError(null);
    const result = await getFlowDetails({
      flowName: selectedFlow.name,
      sourceId: selectedFlow.sourceId,
    });
    setFlowDetailsByKey((prev) => ({
      ...prev,
      [selectedFlow.key]: result.flow,
    }));
    return result.flow;
  }, [flowDetailsByKey, selectedFlow]);

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
  const selectedConversationTitle =
    selectedConversation?.title?.trim() && selectedConversation.title.trim()
      ? selectedConversation.title.trim()
      : '';
  const defaultTitleLabel = selectedConversationTitle || selectedFlowName;
  const titleLabel =
    customTitle.trim().length > 0
      ? customTitle.trim()
      : defaultTitleLabel !== 'Select flow'
        ? defaultTitleLabel
        : 'Set title';
  const titleLockedToConversation = Boolean(activeConversationId);

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

  const flowWorkingFolderLocked =
    startPending ||
    isStreaming ||
    status === 'sending' ||
    status === 'stopping' ||
    Boolean(inflightSnapshot?.inflightId) ||
    Boolean(serverVisibleInflightIdRef.current);
  const isWorkingFolderDisabled =
    persistenceUnavailable ||
    flowsLoading ||
    !!flowsError ||
    flowWorkingFolderLocked;

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

  const qaLogSentRef = useRef(false);

  useEffect(() => {
    if (isMobile) {
      setMobileConversationsOpen(false);
      setMobileAppMenuOpen(false);
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
        persistenceUnavailable ||
        !selectedConversationIdRef.current ||
        workingFolderDisabledRef.current
      ) {
        return;
      }
      try {
        const result = await updateWorkingFolder({
          conversationId: selectedConversationIdRef.current,
          workingFolder: trimmedWorkingFolder || null,
          surface: 'flows',
        });
        const persistedWorkingFolder =
          result.flags && typeof result.flags.workingFolder === 'string'
            ? result.flags.workingFolder.trim()
            : trimmedWorkingFolder;
        if (persistedWorkingFolder !== trimmedWorkingFolder) {
          setWorkingFolder(persistedWorkingFolder);
        }
      } catch (error) {
        console.error('flow working-folder persistence failed', error);
      }
    },
    [persistenceUnavailable, updateWorkingFolder, workingFolder],
  );

  const handleOpenDirPicker = () => {
    if (workingFolderDisabledRef.current) return;
    setDirPickerOpen(true);
  };

  const handlePickDir = (path: string) => {
    if (workingFolderDisabledRef.current) {
      setDirPickerOpen(false);
      return;
    }
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

  const handleClearDirPicker = () => {
    setDirPickerOpen(false);
    if (workingFolderDisabledRef.current) {
      return;
    }
    setWorkingFolder('');
    void persistWorkingFolder('');
  };

  const loadFlows = useCallback(async () => {
    setFlowsLoading(true);
    setFlowsError(null);
    let nextSelectedKey: string | undefined;
    try {
      const result = await listFlows();
      setFlows(result.flows);
      setFlowDetailsByKey((prev) =>
        reconcileFlowDetailsCache(prev, result.flows),
      );
      const flowKeys = result.flows.map((flow) => buildFlowKey(flow));
      if (!selectedFlowKey || !flowKeys.includes(selectedFlowKey)) {
        const firstAvailable = result.flows.find((flow) => !flow.disabled);
        if (firstAvailable) {
          nextSelectedKey = buildFlowKey(firstAvailable);
        } else if (result.flows.length > 0) {
          nextSelectedKey = buildFlowKey(result.flows[0]);
        } else {
          nextSelectedKey = '';
        }
      }
    } catch (err) {
      setFlowsError((err as Error).message ?? 'Failed to load flows.');
      setFlows([]);
    } finally {
      setFlowsLoading(false);
      if (
        typeof nextSelectedKey !== 'undefined' &&
        nextSelectedKey !== selectedFlowKey
      ) {
        setSelectedFlowKey(nextSelectedKey);
      }
    }
  }, [selectedFlowKey]);

  useEffect(() => {
    void loadFlows();
  }, [loadFlows]);

  useEffect(() => {
    if (!flowInfoOpen || !selectedFlow) return;

    let cancelled = false;
    void loadSelectedFlowDetails()
      .then((result) => {
        if (cancelled || !result) return;
      })
      .catch((error) => {
        if (cancelled) return;
        setFlowDetailsError(
          (error as Error).message ?? 'Failed to load flow details.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [flowInfoOpen, loadSelectedFlowDetails, selectedFlow]);

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
    const isAcceptedLaunchSelection =
      Boolean(acceptedLaunchConversationIdRef.current) &&
      acceptedLaunchConversationIdRef.current === activeConversationId;
    const shouldPreserveHiddenConversation =
      hasVisibleAssistantTranscript ||
      hasProcessingTranscript ||
      isStreaming ||
      startPending ||
      turnsLoading ||
      isAcceptedLaunchSelection ||
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
          isAcceptedLaunchSelection,
          isStreaming,
          status,
          turnsLoading,
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
        isAcceptedLaunchSelection,
        isStreaming,
        status,
        turnsLoading,
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
    turnsLoading,
  ]);

  useEffect(() => {
    if (
      launchConversationId &&
      selectedConversation?.conversationId !== launchConversationId
    ) {
      return;
    }
    if (!selectedConversation?.provider) return;
    if (selectedConversation.provider !== flowProviderId) {
      setFlowProviderId(selectedConversation.provider);
    }
  }, [
    flowProviderId,
    launchConversationId,
    selectedConversation?.conversationId,
    selectedConversation?.provider,
  ]);

  useEffect(() => {
    if (
      launchConversationId &&
      selectedConversation?.conversationId !== launchConversationId
    ) {
      return;
    }
    if (!selectedConversation?.model) return;
    if (selectedConversation.model !== flowModelId) {
      setFlowModelId(selectedConversation.model);
    }
  }, [
    flowModelId,
    launchConversationId,
    selectedConversation?.conversationId,
    selectedConversation?.model,
  ]);

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
            model: turn.model,
            tools: mapToolCalls(turn.toolCalls ?? null),
            streamStatus:
              turn.status === 'failed'
                ? 'failed'
                : turn.status === 'warning'
                  ? 'warning'
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
    const key = buildStoredTurnHydrationKey(activeConversationId, turns);
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
    setRunErrorCode(null);
    setLaunchWarnings([]);
    setLaunchConversationId(null);
    freshRunRetryOwnershipIdRef.current = null;
    resetTurns();
    setActiveConversationId(undefined);
    setConversation(reset(), { clearMessages: true });
    setFlowModelId('unknown');
    setFlowProviderId('unknown');
    setWorkingFolder('');
    setCustomTitle('');
    acceptedLaunchConversationIdRef.current = null;
    serverVisibleInflightIdRef.current = null;
    stoppingVisibleLoggedRef.current = null;
  }, [reset, resetTurns, setConversation]);

  const handleNewFlowReset = useCallback(() => {
    setSuppressAutoSelect(true);
    resetConversation();
    setFlowInfoAnchorEl(null);
    setSelectedFlowAnchorEl(null);
    setTitleAnchorEl(null);
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
  }, [
    log,
    resetConversation,
    selectedFlowName,
    setSuppressAutoSelect,
    setFlowInfoAnchorEl,
    setSelectedFlowAnchorEl,
    setTitleAnchorEl,
  ]);

  const handleFlowSelect = useCallback(
    (next: string) => {
      if (next === selectedFlowKey) return;
      const nextFlow = flowOptions.find((flow) => flow.key === next);
      if (nextFlow?.disabled) return;
      setSelectedFlowKey(next);
      setSuppressAutoSelect(false);
      resetConversation();
      setFlowInfoAnchorEl(null);
      setSelectedFlowAnchorEl(null);
      setTitleAnchorEl(null);
    },
    [
      flowOptions,
      resetConversation,
      selectedFlowKey,
      setSuppressAutoSelect,
      setFlowInfoAnchorEl,
      setSelectedFlowAnchorEl,
      setTitleAnchorEl,
    ],
  );

  const handleFlowChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      handleFlowSelect(event.target.value);
    },
    [handleFlowSelect],
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

  const handleSelectedFlowOpen = (event: MouseEvent<HTMLElement>) => {
    if (flowsLoading || !!flowsError || flowOptions.length === 0) return;
    setSelectedFlowAnchorEl(event.currentTarget);
  };

  const handleSelectedFlowClose = () => {
    setSelectedFlowAnchorEl(null);
  };

  const copyFlowTitle = useCallback(async () => {
    if (!titleLabel.trim() || titleLabel === 'Set title') {
      setTitleCopyFeedback({
        severity: 'error',
        message: 'No flow title is available to copy yet.',
      });
      return;
    }
    try {
      await copyTextToClipboard(titleLabel);
      setTitleCopyFeedback({
        severity: 'success',
        message: 'Flow title copied.',
      });
    } catch {
      setTitleCopyFeedback({
        severity: 'error',
        message: 'Unable to copy the flow title.',
      });
    }
  }, [titleLabel]);

  const handleTitleOpen = (event: MouseEvent<HTMLElement>) => {
    if (titleLockedToConversation) {
      void copyFlowTitle();
      return;
    }
    if (titleDisabled) return;
    if (!customTitle.trim() && defaultTitleLabel !== 'Select flow') {
      setCustomTitle(defaultTitleLabel);
    }
    setTitleAnchorEl(event.currentTarget);
  };

  const handleTitleClose = () => {
    setTitleAnchorEl(null);
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
    freshRunRetryOwnershipIdRef.current = null;
    acceptedLaunchConversationIdRef.current = null;
    serverVisibleInflightIdRef.current = null;
    stoppingVisibleLoggedRef.current = null;
    const summary = flowConversations.find(
      (conversation) => conversation.conversationId === conversationId,
    );
    setRunError(null);
    setRunErrorCode(null);
    setLaunchWarnings([]);
    setLaunchConversationId(conversationId);
    setFlowProviderId(summary?.provider ?? 'unknown');
    if (summary?.model) {
      setFlowModelId(summary.model);
    }
    setActiveConversationId(conversationId);
    if (isMobile) {
      setMobileConversationsOpen(false);
    }
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
    async (mode: 'run' | 'resume', launchClickDetail = 1) => {
      if (!selectedFlowName) return;
      const shouldGuardFreshRun = mode === 'run';
      if (mode === 'resume') {
        freshRunRetryOwnershipIdRef.current = null;
      }
      const releaseFreshRunReplayGuard = () => {
        if (!shouldGuardFreshRun) {
          return;
        }
        freshRunReplayGuardRef.current = false;
      };
      if (shouldGuardFreshRun && launchClickDetail > 1) {
        return;
      }
      if (shouldGuardFreshRun && freshRunReplayGuardRef.current) {
        return;
      }
      setRunError(null);
      setRunErrorCode(null);
      setLaunchWarnings([]);
      if (shouldGuardFreshRun) {
        freshRunReplayGuardRef.current = true;
      }

      let details = selectedFlowDetails;
      if (!details) {
        try {
          details = await loadSelectedFlowDetails();
        } catch (error) {
          // If the server indicates the details service is explicitly unavailable,
          // surface that error and block the run. For other transient or generic
          // failures, allow a conservative fallback (proceed without details)
          // when the summary still indicates the flow is enabled.
          if (
            error instanceof FlowApiError &&
            error.code === 'DETAILS_UNAVAILABLE'
          ) {
            setRunError(
              (error as Error).message ?? 'Failed to load flow details.',
            );
            releaseFreshRunReplayGuard();
            return;
          }

          const malformedDetailsPayload =
            error instanceof Error &&
            error.message === 'Invalid flow details response';
          if (!malformedDetailsPayload && selectedFlow?.disabled !== true) {
            details = undefined;
          } else {
            setRunError(
              (error as Error).message ?? 'Failed to load flow details.',
            );
            releaseFreshRunReplayGuard();
            return;
          }
        }
      }

      const guardDisabled = Boolean(
        details?.disabled ?? selectedFlow?.disabled,
      );
      const guardDisabledReason =
        details?.disabledReason?.message ??
        (selectedFlow?.disabled ? selectedFlow.error : undefined);
      if (guardDisabled) {
        setRunError(guardDisabledReason ?? 'This flow is currently disabled.');
        releaseFreshRunReplayGuard();
        return;
      }
      if (persistenceUnavailable || !wsTranscriptReady) {
        setRunError(
          'Realtime connection unavailable — Flow runs require WebSocket streaming.',
        );
        releaseFreshRunReplayGuard();
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
      acceptedLaunchConversationIdRef.current = null;
      setFlowModelId('unknown');
      setFlowProviderId('unknown');
      const retryOwnershipId =
        mode === 'run'
          ? (freshRunRetryOwnershipIdRef.current ??
            (freshRunRetryOwnershipIdRef.current = makeClientConversationId()))
          : undefined;

      const nextConversationId =
        mode === 'run'
          ? makeClientConversationId()
          : activeConversationId && activeConversationId.trim().length > 0
            ? activeConversationId
            : makeClientConversationId();
      const isNewConversation = mode === 'run';
      const trimmedCustomTitle = customTitle.trim();
      const customTitleDisabledForSelection = Boolean(resumeStepPath);
      const shouldIncludeCustomTitle =
        mode === 'run' &&
        isNewConversation &&
        !customTitleDisabledForSelection &&
        trimmedCustomTitle.length > 0;

      if (isNewConversation) {
        setLaunchConversationId(nextConversationId);
        resetTurns();
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
          retryOwnershipId,
          customTitle: shouldIncludeCustomTitle
            ? trimmedCustomTitle
            : undefined,
          isNewConversation,
          mode,
          working_folder: workingFolder.trim() || undefined,
          resumeStepPath: mode === 'resume' ? resumeStepPath : undefined,
        });
        setActiveConversationId(result.conversationId);
        setLaunchConversationId(result.conversationId);
        acceptedLaunchConversationIdRef.current = result.conversationId;
        if (shouldGuardFreshRun) {
          freshRunRetryOwnershipIdRef.current = null;
        }
        setRunErrorCode(null);
        setLaunchWarnings(result.warnings ?? []);
        if (result.providerId) {
          setFlowProviderId(result.providerId);
        }
        if (result.modelId) {
          setFlowModelId(result.modelId);
        }
        console.info('[flows-ui] refreshConversations (before)', {
          selectedFlowName,
        });
        try {
          await refreshConversations();
          console.info('[flows-ui] refreshConversations (after)');
          if (shouldGuardFreshRun) {
            // Allow the UI to paint and then refresh once more to ensure the
            // latest server-side run appears in conversation lists in environments
            // where async routing or rapid replays can cause timing races.
            await waitForNextPaint();
            await refreshConversations();
          }
        } catch (refreshError) {
          log('warn', 'flows.ui.accepted_launch_refresh_failed', {
            conversationId: result.conversationId,
            message:
              refreshError instanceof Error
                ? refreshError.message
                : String(refreshError),
          });
        }
      } catch (err) {
        if (
          err instanceof FlowApiError &&
          err.status === 409 &&
          err.code === 'RUN_IN_PROGRESS'
        ) {
          freshRunRetryOwnershipIdRef.current = null;
          const errorMessage: ChatMessage = {
            id: makeClientConversationId(),
            role: 'assistant',
            content:
              'This flow conversation already has a run in progress in another tab/window. Please wait for it to finish or press Stop in the other tab.',
            kind: 'error',
            streamStatus: 'failed',
            createdAt: new Date().toISOString(),
          };
          const errorHistory = isNewConversation
            ? [errorMessage]
            : [...messages, errorMessage];
          hydrateHistory(nextConversationId, errorHistory, 'replace');
          setRunError(errorMessage.content);
          setRunErrorCode(err.code ?? null);
          return;
        }
        const message = (err as Error).message || 'Failed to run flow.';
        acceptedLaunchConversationIdRef.current = null;

        // Show the run error at the top-level run error banner. Avoid duplicating
        // the message in both the chat transcript and the banner to prevent
        // multiple matching elements in tests and confusing UI duplication.
        setRunError(message);
        setRunErrorCode(
          err instanceof FlowApiError ? (err.code ?? null) : null,
        );
        if (err instanceof FlowApiError) {
          freshRunRetryOwnershipIdRef.current = null;
        }
      } finally {
        releaseFreshRunReplayGuard();
        setStartPending(false);
      }
    },
    [
      activeConversationId,
      customTitle,
      hydrateHistory,
      log,
      loadSelectedFlowDetails,
      messages,
      persistenceUnavailable,
      refreshConversations,
      resetTurns,
      resumeStepPath,
      selectedFlow,
      selectedFlowDetails,
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
    surface: 'flows',
    conversationId: selectedConversation?.conversationId ?? null,
  });
  const retainedAssistantVisible = useMemo(
    () =>
      displayMessages.some((message) => isVisibleAssistantMessage(message)) &&
      (isSending ||
        isStopping ||
        Boolean(inflightSnapshot?.inflightId) ||
        Boolean(serverVisibleInflightIdRef.current)),
    [displayMessages, inflightSnapshot?.inflightId, isSending, isStopping],
  );
  const showStop = isSending || isStopping;
  const mainRunDisabled =
    !selectedFlowName ||
    flowsLoading ||
    !!flowsError ||
    selectedFlowDisabled ||
    startPending ||
    persistenceUnavailable ||
    !wsTranscriptReady;
  const mainActionDisabled = showStop ? isStopping : mainRunDisabled;
  const mainInputDisabled =
    flowsLoading ||
    !!flowsError ||
    persistenceUnavailable ||
    !wsTranscriptReady ||
    showStop;
  const titleDisabled = flowTitleDisabled || showStop;
  const titleTriggerDisabled =
    (titleLockedToConversation && titleLabel === 'Set title') ||
    flowTitleDisabled;
  const titleProxyInputDisabled =
    flowTitleDisabled || showStop || Boolean(resumeStepPath);
  const selectedFlowTriggerDisabled =
    flowsLoading || !!flowsError || flowOptions.length === 0;

  const handleMainSubmit = useCallback<FormEventHandler<HTMLFormElement>>(
    (event) => {
      event.preventDefault();
      if (showStop || mainRunDisabled) return;
      const mode: 'run' | 'resume' = resumeStepPath ? 'resume' : 'run';
      void startFlowRun(mode);
    },
    [mainRunDisabled, resumeStepPath, showStop, startFlowRun],
  );

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversation?.conversationId;
  }, [selectedConversation?.conversationId]);

  useEffect(() => {
    workingFolderDisabledRef.current = isWorkingFolderDisabled;
  }, [isWorkingFolderDisabled]);

  useEffect(() => {
    if (!isWorkingFolderDisabled || !dirPickerOpen) {
      return;
    }
    setDirPickerOpen(false);
  }, [dirPickerOpen, isWorkingFolderDisabled]);

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

  const conversationList = (
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
      onNewConversation={handleNewFlowReset}
      newActionLabel="New flow"
    />
  );

  const transcriptSurface = (
    <SharedTranscriptSurface>
      <SharedTranscript
        surface="flows"
        conversationId={selectedConversation?.conversationId ?? null}
        messages={displayMessages}
        activeToolsAvailable={false}
        turnsLoading={turnsLoading}
        turnsError={turnsError}
        turnsErrorMessage={turnsErrorMessage}
        emptyMessage="Transcript will appear here once a flow run starts."
        emptyStateContent={
          flowsLoading && flows.length === 0 ? (
            <Typography color="text.secondary">Loading flows...</Typography>
          ) : !flowsLoading && flows.length === 0 ? (
            <Typography color="text.secondary">
              No flows found. Add a flow JSON file under `flows/` to get
              started.
            </Typography>
          ) : undefined
        }
        warningTestId="flows-turns-error"
        transcriptTestId="flows-transcript"
        citationsEnabled={false}
        isStopping={isStopping}
        citationsOpen={citationsOpen}
        thinkOpen={thinkOpen}
        toolOpen={toolOpen}
        toolErrorOpen={toolErrorOpen}
        onToggleCitation={toggleCitation}
        onToggleThink={toggleThink}
        onToggleTool={toggleTool}
        onToggleToolError={toggleToolError}
        renderHeaderContent={(message) => {
          if (message.role !== 'assistant') {
            return null;
          }
          const headerLine = buildFlowStepHeaderLine(message.command);
          if (!headerLine) {
            return null;
          }
          return (
            <Typography
              variant="caption"
              color="text.secondary"
              data-testid="bubble-flow-step-header"
              sx={{
                display: 'block',
                fontWeight: 600,
                letterSpacing: '0.01em',
                lineHeight: 1.35,
              }}
            >
              {headerLine}
            </Typography>
          );
        }}
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
              color={message.role === 'user' ? 'inherit' : 'text.secondary'}
              data-testid="bubble-flow-meta"
            >
              {flowLine}
            </Typography>
          );
        }}
        sharedRenderLogConfig={{
          eventName: 'DEV-0000049:T05:flows_shared_transcript_rendered',
          context: {
            hasTurnsError: turnsError,
            retainedAssistantVisible,
            hasFlowMetaLine,
            citationsVisible: false,
          },
        }}
      />
    </SharedTranscriptSurface>
  );

  const flowInfoSections = useMemo<ComposerInfoSection[]>(
    () => [
      {
        key: 'selection',
        title: 'Current selections',
        eyebrow: 'What the next flow launch will use',
        summaryChipLabel: resumeStepPath ? 'Resume ready' : 'Run ready',
        entries: [
          {
            key: 'flow',
            label: 'Flow',
            value: selectedFlowLabel,
            icon: <PlayArrowRoundedIcon fontSize="small" />,
          },
          {
            key: 'title',
            label: 'Title',
            value: titleLabel,
            icon: <TitleRoundedIcon fontSize="small" />,
          },
          {
            key: 'working-path',
            label: 'Working path',
            value: workingFolderName,
            icon: <FolderOutlinedIcon fontSize="small" />,
          },
        ],
      },
      {
        key: 'runtime',
        title: 'Launch context',
        eyebrow: 'Runtime identity for the selected flow',
        tone: 'default',
        entries: [
          {
            key: 'provider',
            label: 'Provider',
            value: flowProviderId,
            icon: <InfoOutlinedIcon fontSize="small" />,
          },
          {
            key: 'model',
            label: 'Model',
            value: flowModelId,
            icon: <InfoOutlinedIcon fontSize="small" />,
          },
          {
            key: 'runtime',
            label: 'Runtime',
            value:
              selectedFlow?.sourceLabel?.trim() ||
              selectedFlow?.sourceId?.trim() ||
              'Local',
            icon: <PlayArrowRoundedIcon fontSize="small" />,
          },
          ...(resumeStepPath
            ? [
                {
                  key: 'resume-step',
                  label: 'Resume step',
                  value: resumeStepPath.join(' / '),
                  icon: <TitleRoundedIcon fontSize="small" />,
                },
              ]
            : []),
        ],
      },
    ],
    [
      flowModelId,
      flowProviderId,
      resumeStepPath,
      selectedFlow,
      selectedFlowLabel,
      titleLabel,
      workingFolderName,
    ],
  );

  const flowSelectorContent = (
    <Stack spacing={1.25} data-testid="flow-selector-content">
      {flowsError ? <Alert severity="error">{flowsError}</Alert> : null}
      <Typography variant="body2" color="text.secondary">
        Choose the flow to launch.
      </Typography>
      <List disablePadding dense role="listbox" aria-label="Flow options">
        {flowOptions.length === 0 ? (
          <ListItemButton disabled>
            <ListItemText
              primary="No flows available"
              secondary="Add a flow JSON file under `flows/` to get started."
            />
          </ListItemButton>
        ) : null}
        {flowOptions.map((flow) => (
          <ListItemButton
            key={flow.key}
            component="div"
            role="option"
            data-testid={`flow-option-${flow.key}`}
            selected={flow.key === selectedFlowKey}
            aria-selected={flow.key === selectedFlowKey}
            disabled={flow.disabled}
            onClick={() => {
              handleFlowSelect(flow.key);
              handleSelectedFlowClose();
            }}
          >
            <ListItemIcon sx={{ minWidth: 36, color: 'text.secondary' }}>
              <PlayArrowRoundedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary={flow.name}
              secondary={
                flow.sourceLabel?.trim() || flow.sourceId?.trim() || 'Local'
              }
            />
          </ListItemButton>
        ))}
      </List>
    </Stack>
  );

  const titleEditorContent = (
    <Stack spacing={2} data-testid="flow-title-content">
      <TextField
        fullWidth
        size="small"
        label="Custom title"
        placeholder="Optional name for this run"
        value={customTitle}
        onChange={(event) => setCustomTitle(event.target.value)}
        onBlur={handleCustomTitleBlur}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          event.stopPropagation();
          (event.currentTarget as HTMLInputElement).blur();
        }}
        disabled={flowTitleDisabled}
        inputProps={{
          'data-testid': 'flow-title-input',
          'aria-label': 'Custom title',
          name: 'custom_title',
        }}
      />
      <Typography variant="caption" color="text.secondary">
        Optional title for this launch.
      </Typography>
      <Stack direction="row" spacing={1} justifyContent="space-between">
        <Button
          type="button"
          variant="text"
          size="small"
          onClick={() => setCustomTitle('')}
          disabled={flowTitleDisabled}
        >
          Clear
        </Button>
        <Button
          type="button"
          variant="text"
          size="small"
          onClick={handleTitleClose}
          sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
        >
          Close
        </Button>
      </Stack>
    </Stack>
  );

  const infoFooterContent = (
    <>
      {flowWarnings.length > 0 ? (
        <Stack spacing={0.5} data-testid="flow-warnings">
          <Typography variant="subtitle2" color="warning.main">
            Warnings
          </Typography>
          {flowWarnings.map((warning) => (
            <Typography key={warning} variant="body2" color="warning.main">
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
    </>
  );

  const infoContent = (
    <ComposerInfoPanel
      heroTitle="Current flow launch context"
      heroDescription="These values describe exactly what the next flow run or resume will use."
      heroIcon={<InfoOutlinedIcon fontSize="small" />}
      sections={flowInfoSections}
      footerContent={infoFooterContent}
      data-testid="flow-info-content"
    />
  );

  const mainInputRow = (
    <CommonComposerMainInputRow>
      <Box
        data-testid="flow-launch-summary"
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: { xs: 36, sm: 48 },
          px: { xs: 1, sm: 1.5 },
          py: { xs: 0.75, sm: 1 },
          borderRadius: { xs: 2.5, sm: 3 },
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.default',
          opacity: mainInputDisabled ? 0.72 : 1,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Typography
          variant="body2"
          fontWeight={600}
          data-testid="flow-launch-title"
          sx={{
            minWidth: 0,
            width: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {selectedFlowName ? titleLabel : 'Choose a flow to start a run.'}
        </Typography>
      </Box>
      <ComposerSendButton
        showStop={showStop}
        isStopping={isStopping}
        disabled={mainActionDisabled}
        onClick={showStop ? handleStopClick : undefined}
        data-testid={showStop ? 'flow-stop' : 'flow-run'}
      />
    </CommonComposerMainInputRow>
  );

  const footerRow = (
    <CommonComposerFooter>
      <Tooltip title="Flow info">
        <span>
          <ComposerFooterButton
            icon={<InfoOutlinedIcon fontSize="small" />}
            label="Info"
            iconOnly
            ariaLabel="Composer info"
            selected={Boolean(flowInfoAnchorEl)}
            onClick={handleFlowInfoOpen}
            data-testid="flow-info"
            disabled={flowInfoDisabled}
          />
        </span>
      </Tooltip>
      <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
        <Tooltip title="New flow">
          <span>
            <ComposerFooterButton
              icon={<EditOutlinedIcon fontSize="small" />}
              label="New"
              iconOnly
              ariaLabel="Reset flow draft"
              onClick={handleNewFlowReset}
              data-testid="flow-new-conversation-trigger"
              disabled={!selectedFlowName || flowsLoading}
            />
          </span>
        </Tooltip>
      </Box>
      <ComposerFooterButton
        icon={<FolderOutlinedIcon fontSize="small" />}
        label="Working path"
        value={workingFolderName}
        selected={dirPickerOpen}
        onClick={handleOpenDirPicker}
        data-testid="flow-working-folder-trigger"
        disabled={isWorkingFolderDisabled}
        ariaHaspopup="dialog"
        ariaExpanded={dirPickerOpen}
      />
      <ComposerFooterButton
        icon={<PlayArrowRoundedIcon fontSize="small" />}
        label="Flow"
        value={selectedFlowLabel}
        selected={Boolean(selectedFlowAnchorEl)}
        onClick={handleSelectedFlowOpen}
        data-testid="flow-select-trigger"
        disabled={selectedFlowTriggerDisabled}
        ariaHaspopup="listbox"
        ariaExpanded={Boolean(selectedFlowAnchorEl)}
        role="combobox"
      />
      <ComposerFooterButton
        icon={<TitleRoundedIcon fontSize="small" />}
        label="Title"
        value={titleLabel}
        selected={Boolean(titleAnchorEl)}
        onClick={handleTitleOpen}
        data-testid="flow-title-trigger"
        disabled={titleTriggerDisabled}
        ariaLabel={
          titleLockedToConversation ? 'Copy flow title' : 'Edit flow title'
        }
        ariaHaspopup={titleLockedToConversation ? undefined : 'dialog'}
        ariaExpanded={Boolean(titleAnchorEl)}
      />
    </CommonComposerFooter>
  );

  const composerSurface = (
    <>
      {process.env.NODE_ENV === 'test' ? (
        <Box
          sx={{
            position: 'absolute',
            left: -9999,
            top: 0,
            width: 1,
            height: 1,
            overflow: 'hidden',
            opacity: 0,
          }}
        >
          <select
            data-testid="flow-select"
            value={selectedFlowKey}
            onChange={handleFlowChange}
            disabled={selectedFlowTriggerDisabled}
          >
            {flowOptions.map((flow) => (
              <option key={flow.key} value={flow.key} disabled={flow.disabled}>
                {flow.label}
              </option>
            ))}
          </select>
          <input
            data-testid="flow-working-folder"
            value={workingFolder}
            disabled={isWorkingFolderDisabled}
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
          />
          <input
            data-testid="flow-custom-title"
            value={customTitle}
            disabled={titleProxyInputDisabled}
            onChange={(event) => setCustomTitle(event.target.value)}
            onBlur={handleCustomTitleBlur}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              event.stopPropagation();
              (event.currentTarget as HTMLInputElement).blur();
            }}
          />
          <Button
            type="button"
            onClick={handleNewFlowReset}
            disabled={!selectedFlowName || flowsLoading}
            data-testid="flow-new"
          >
            New Flow
          </Button>
          <Button
            type="button"
            onClick={() => void startFlowRun('resume')}
            disabled={
              !selectedFlowName ||
              flowsLoading ||
              selectedFlowDisabled ||
              startPending ||
              showStop ||
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
            onClick={handleOpenDirPicker}
            disabled={isWorkingFolderDisabled}
            data-testid="flow-working-folder-picker"
          >
            Choose folder…
          </Button>
        </Box>
      ) : null}

      <CommonComposerShell
        data-testid="chat-controls"
        onSubmit={handleMainSubmit}
        mainInputRow={mainInputRow}
        footerRow={footerRow}
      />

      <ComposerDesktopPopover
        open={!effectiveIsMobile && Boolean(flowInfoAnchorEl)}
        anchorEl={flowInfoAnchorEl}
        onClose={handleFlowInfoClose}
        width={420}
        data-testid="flow-info-popover"
      >
        {infoContent}
      </ComposerDesktopPopover>
      <ComposerMobileDialog
        open={effectiveIsMobile && Boolean(flowInfoAnchorEl)}
        onClose={handleFlowInfoClose}
        data-testid="flow-info-dialog"
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography variant="h6">Info</Typography>
            <IconButton onClick={handleFlowInfoClose} aria-label="Close">
              ×
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>{infoContent}</DialogContent>
        <DialogActions>
          <Button onClick={handleFlowInfoClose}>Close</Button>
        </DialogActions>
      </ComposerMobileDialog>

      <ComposerDesktopPopover
        open={!effectiveIsMobile && Boolean(selectedFlowAnchorEl)}
        anchorEl={selectedFlowAnchorEl}
        onClose={handleSelectedFlowClose}
        width={420}
        data-testid="flow-select-popover"
      >
        {flowSelectorContent}
      </ComposerDesktopPopover>
      <ComposerMobileDialog
        open={effectiveIsMobile && Boolean(selectedFlowAnchorEl)}
        onClose={handleSelectedFlowClose}
        data-testid="flow-select-dialog"
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography variant="h6">Flow</Typography>
            <IconButton onClick={handleSelectedFlowClose} aria-label="Close">
              ×
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>{flowSelectorContent}</DialogContent>
        <DialogActions>
          <Button onClick={handleSelectedFlowClose}>Close</Button>
        </DialogActions>
      </ComposerMobileDialog>

      <ComposerDesktopPopover
        open={!effectiveIsMobile && Boolean(titleAnchorEl)}
        anchorEl={titleAnchorEl}
        onClose={handleTitleClose}
        width={420}
        data-testid="flow-title-popover"
      >
        {titleEditorContent}
      </ComposerDesktopPopover>
      <ComposerMobileDialog
        open={effectiveIsMobile && Boolean(titleAnchorEl)}
        onClose={handleTitleClose}
        data-testid="flow-title-dialog"
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography variant="h6">Title</Typography>
            <IconButton onClick={handleTitleClose} aria-label="Close">
              ×
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>{titleEditorContent}</DialogContent>
        <DialogActions>
          <Button onClick={handleTitleClose}>Close</Button>
        </DialogActions>
      </ComposerMobileDialog>

      <DirectoryPickerDialog
        open={dirPickerOpen}
        path={workingFolder}
        onClose={handleCloseDirPicker}
        onPick={handlePickDir}
        onClear={handleClearDirPicker}
      />
      <Snackbar
        open={Boolean(titleCopyFeedback)}
        autoHideDuration={2400}
        onClose={() => setTitleCopyFeedback(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setTitleCopyFeedback(null)}
          severity={titleCopyFeedback?.severity ?? 'success'}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {titleCopyFeedback?.message ?? ''}
        </Alert>
      </Snackbar>
    </>
  );

  const desktopWorkspace = (
    <WorkspaceDesktopShell
      conversationPane={conversationList}
      transcript={transcriptSurface}
      composer={composerSurface}
      conversationPaneOpen={conversationPaneOpen}
      conversationPaneWidth={drawerWidth}
      isMobile={effectiveIsMobile}
      onToggleConversationPane={() => {
        setDesktopDrawerOpen((prev) => !prev);
      }}
    />
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
        title="Flows"
        showConversationsButton
        onConversationsClick={() => setMobileConversationsOpen(true)}
        onNewClick={handleNewFlowReset}
        newButtonLabel="New flow"
        onMenuClick={() => setMobileAppMenuOpen(true)}
      />
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {transcriptSurface}
      </Box>
      {composerSurface}
      <WorkspaceMobileConversationsOverlay
        open={mobileConversationsOpen}
        onClose={() => setMobileConversationsOpen(false)}
        list={conversationList}
      />
      <WorkspaceMobileAppMenuOverlay
        open={mobileAppMenuOpen}
        onClose={() => setMobileAppMenuOpen(false)}
      />
    </Box>
  );

  return (
    <Box
      data-testid="flows-page"
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        width: '100%',
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
          <Alert
            severity="error"
            data-testid="flows-run-error"
            data-error-code={runErrorCode ?? ''}
          >
            {runError}
          </Alert>
        )}
        {launchWarnings.length > 0 && (
          <Alert severity="warning" data-testid="flows-launch-warnings">
            {launchWarnings.join(' ')}
          </Alert>
        )}

        {effectiveIsMobile ? mobileWorkspace : desktopWorkspace}
      </Stack>
    </Box>
  );
}
