import {
  Alert,
  Box,
  Container,
  Drawer,
  Stack,
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
  AgentPromptEntry,
  listAgentCommands,
  listAgentPrompts,
  listAgents,
  runAgentCommand,
  runAgentInstruction,
  AgentApiError,
} from '../api/agents';
import AgentsComposerPanel from '../components/agents/AgentsComposerPanel';
import AgentsTranscriptPane from '../components/agents/AgentsTranscriptPane';
import ConversationList from '../components/chat/ConversationList';
import {
  buildStepLine,
  buildTimingLine,
  buildUsageLine,
  formatBubbleTimestamp,
} from '../components/chat/chatTranscriptFormatting';
import useSharedTranscriptState from '../components/chat/useSharedTranscriptState';
import useChatModel from '../hooks/useChatModel';
import useChatStream, {
  type ChatMessage,
  type ToolCall,
} from '../hooks/useChatStream';
import useChatWs, {
  type ChatWsServerEvent,
  type ChatWsTranscriptEvent,
  isDev0000038MarkerGateEnabled,
} from '../hooks/useChatWs';
import useConversationTurns, {
  StoredTurn,
} from '../hooks/useConversationTurns';
import useConversations from '../hooks/useConversations';
import usePersistenceStatus from '../hooks/usePersistenceStatus';
import { createLogger } from '../logging/logger';

const buildCommandDisplayName = (name: string) => name.replace(/_/g, ' ');

const buildCommandLabel = (params: { name: string; sourceLabel?: string }) => {
  const displayName = buildCommandDisplayName(params.name);
  return params.sourceLabel
    ? `${displayName} - [${params.sourceLabel}]`
    : displayName;
};

const buildCommandKey = (params: { name: string; sourceId?: string }) =>
  `${params.name}::${params.sourceId ?? 'local'}`;

const EXECUTE_PROMPT_INSTRUCTION_TEMPLATE =
  'Please read the following markdown file. It is designed as a persona you MUST assume. You MUST follow all the instructions within the markdown file including providing the user with the option of selecting the next path to follow once the work of the markdown file is complete, and then loading that new file to continue. You must stay friendly and helpful at all times, ensuring you communicate with the user in an easy to follow way, providing examples to illustrate your point and guiding them through the more complex scenarios. Try to do as much of the heavy lifting as you can using the various mcp tools at your disposal. Here is the file: <full path of markdown file>';

export default function AgentsPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const controlsLayoutMode = isMobile ? 'stacked' : 'row';
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

  const { providers, refreshProviders } = useChatModel();

  const [commands, setCommands] = useState<
    Array<{
      name: string;
      description: string;
      disabled: boolean;
      stepCount: number;
      sourceId?: string;
      sourceLabel?: string;
    }>
  >([]);
  const [commandsError, setCommandsError] = useState<string | null>(null);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [selectedCommandKey, setSelectedCommandKey] = useState('');
  const [startStep, setStartStep] = useState<number>(1);

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
    getConversationId,
  } = useChatStream(agentModelId, 'codex');
  const isStopping = status === 'stopping';
  const serverVisibleInflightIdRef = useRef<string | null>(null);
  const currentRunKindRef = useRef<'instruction' | 'command'>('instruction');
  const stoppingVisibleLoggedRef = useRef<string | null>(null);
  const stoppedVisibleLoggedRef = useRef(new Set<string>());
  const stoppedVisibleConversationRef = useRef<string | null>(null);
  const [liveStoppedMarker, setLiveStoppedMarker] = useState<{
    conversationId: string;
    inflightId: string;
    turnId: string;
    runKind: 'instruction' | 'command';
  } | null>(null);

  const displayMessages = useMemo<ChatMessage[]>(
    () => [...messages].reverse(),
    [messages],
  );
  const latestAssistantMessageId = useMemo(
    () =>
      displayMessages.find((message) => message.role === 'assistant')?.id ??
      null,
    [displayMessages],
  );

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

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [workingFolder, setWorkingFolder] = useState('');
  const [promptsLoading, setPromptsLoading] = useState(false);
  const [promptsError, setPromptsError] = useState<string | null>(null);
  const [promptEntries, setPromptEntries] = useState<AgentPromptEntry[]>([]);
  const [selectedPromptFullPath, setSelectedPromptFullPath] = useState('');
  const [committedWorkingFolder, setCommittedWorkingFolder] = useState('');
  const lastCommittedWorkingFolderRef = useRef('');
  const persistConversationWorkingFolderRef = useRef<
    | null
    | ((params: {
        conversationId: string;
        workingFolder: string | null;
        surface: 'agents';
      }) => Promise<unknown>)
  >(null);
  const selectedConversationIdRef = useRef<string | undefined>(undefined);
  const workingFolderDisabledRef = useRef(false);
  const promptsRequestSeqRef = useRef(0);
  const promptSelectorVisibilityLogRef = useRef('');
  const promptSelectionLogRef = useRef('');
  const workingFolderRestoreKeyRef = useRef<string | null>(null);
  const workingFolderLockKeyRef = useRef<string | null>(null);
  const [dirPickerOpen, setDirPickerOpen] = useState(false);
  const [input, setInput] = useState('');
  const lastSentRef = useRef('');
  const [agentInfoAnchorEl, setAgentInfoAnchorEl] =
    useState<HTMLElement | null>(null);
  const [commandInfoAnchorEl, setCommandInfoAnchorEl] =
    useState<HTMLElement | null>(null);
  const actionSlotMinWidth = 120;
  const [deviceAuthOpen, setDeviceAuthOpen] = useState(false);

  const [startPending, setStartPending] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const metadataLoggedRef = useRef(new Set<string>());
  const stepLoggedRef = useRef(new Set<string>());
  const toolDistanceLoggedRef = useRef(new Set<string>());

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
  const deviceAuthLog = useMemo(
    () => createLogger('codex-device-auth-agents'),
    [],
  );
  const codexProvider = useMemo(
    () => providers.find((entry) => entry.id === 'codex'),
    [providers],
  );
  const canShowDeviceAuth =
    Boolean(selectedAgentName) && Boolean(codexProvider?.available);
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
    surface: 'agents',
    conversationId: activeConversationId ?? null,
  });

  useEffect(() => {
    log('info', 'DEV-0000028[T1] agents transcript layout ready', {
      page: 'agents',
    });
  }, [log]);

  useEffect(() => {
    log('info', 'DEV-0000028[T3] agents controls layout mode', {
      mode: controlsLayoutMode,
    });
  }, [controlsLayoutMode, log]);

  useEffect(() => {
    log('info', 'DEV-0000028[T6] agents controls sizing applied', {
      page: 'agents',
    });
  }, [log]);

  const handleOpenDirPicker = () => {
    log('info', 'DEV-0000028[T5] agents folder picker opened', {
      source: 'agents',
    });
    setDirPickerOpen(true);
  };

  const invalidatePromptDiscoveryState = useCallback(
    (params: {
      reason:
        | 'committed_working_folder_changed'
        | 'committed_working_folder_cleared'
        | 'selected_agent_reset'
        | 'selected_agent_empty';
      clearCommittedWorkingFolder?: boolean;
    }) => {
      promptsRequestSeqRef.current += 1;
      setPromptsLoading(false);
      setPromptsError(null);
      setPromptEntries([]);
      setSelectedPromptFullPath('');
      if (params.clearCommittedWorkingFolder) {
        setCommittedWorkingFolder('');
        lastCommittedWorkingFolderRef.current = '';
      }
      console.info(
        `[agents.prompts.discovery.invalidate] reason=${params.reason} clearCommittedWorkingFolder=${params.clearCommittedWorkingFolder === true}`,
      );
    },
    [],
  );

  const commitWorkingFolder = useCallback(
    async (source: 'blur' | 'enter' | 'picker', nextValue?: string) => {
      const committed = (nextValue ?? workingFolder).trim();
      console.info(
        `[agents.prompts.discovery.commit] source=${source} workingFolder=${committed}`,
      );
      if (committed === lastCommittedWorkingFolderRef.current) {
        return;
      }
      invalidatePromptDiscoveryState({
        reason: committed
          ? 'committed_working_folder_changed'
          : 'committed_working_folder_cleared',
      });
      lastCommittedWorkingFolderRef.current = committed;
      setCommittedWorkingFolder(committed);
      if (
        !selectedConversationIdRef.current ||
        workingFolderDisabledRef.current
      ) {
        return;
      }
      try {
        await persistConversationWorkingFolderRef.current?.({
          conversationId: selectedConversationIdRef.current,
          workingFolder: committed || null,
          surface: 'agents',
        });
      } catch (error) {
        console.error('agent working-folder persistence failed', error);
      }
    },
    [invalidatePromptDiscoveryState, workingFolder],
  );

  const handlePickDir = (path: string) => {
    log('info', 'DEV-0000028[T5] agents folder picker picked', { path });
    setWorkingFolder(path);
    setDirPickerOpen(false);
    void commitWorkingFolder('picker', path);
  };

  const handleCloseDirPicker = () => {
    log('info', 'DEV-0000028[T5] agents folder picker cancelled');
    setDirPickerOpen(false);
  };

  const handleDeviceAuthOpen = () => {
    deviceAuthLog(
      'info',
      'DEV-0000031:T8:codex_device_auth_agents_button_click',
    );
    setDeviceAuthOpen(true);
  };

  const handleDeviceAuthClose = () => {
    setDeviceAuthOpen(false);
  };

  const handleDeviceAuthSuccess = () => {
    deviceAuthLog('info', 'DEV-0000031:T8:codex_device_auth_agents_success');
    void refreshProviders();
  };

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
  const committedWorkingFolderRef = useRef<string>(committedWorkingFolder);

  useEffect(() => {
    selectedAgentNameRef.current = selectedAgentName;
  }, [selectedAgentName]);

  useEffect(() => {
    committedWorkingFolderRef.current = committedWorkingFolder;
  }, [committedWorkingFolder]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedAgentName) {
      setCommands([]);
      setCommandsError(null);
      setCommandsLoading(false);
      setSelectedCommandKey('');
      setStartStep(1);
      return;
    }

    setCommandsLoading(true);
    setCommandsError(null);
    void listAgentCommands(selectedAgentName)
      .then((result) => {
        if (cancelled) return;
        const nextCommands = result.commands ?? [];
        setCommands(nextCommands);
        setSelectedCommandKey((prev) => {
          if (!prev) return '';
          const isStillValid = nextCommands.some(
            (cmd) => buildCommandKey(cmd) === prev && !cmd.disabled,
          );
          return isStillValid ? prev : '';
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setCommandsError((err as Error).message);
        setCommands([]);
        setSelectedCommandKey('');
        setStartStep(1);
      })
      .finally(() => {
        if (cancelled) return;
        setCommandsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAgentName]);

  useEffect(() => {
    if (!selectedAgentName) {
      invalidatePromptDiscoveryState({
        reason: 'selected_agent_empty',
        clearCommittedWorkingFolder: true,
      });
      return;
    }
    if (!committedWorkingFolder) {
      invalidatePromptDiscoveryState({
        reason: 'committed_working_folder_cleared',
      });
      return;
    }

    const requestId = promptsRequestSeqRef.current + 1;
    promptsRequestSeqRef.current = requestId;
    const requestContext = {
      agentName: selectedAgentName,
      committedWorkingFolder,
    };
    setPromptsLoading(true);
    setPromptsError(null);
    console.info(
      `[agents.prompts.discovery.request.start] requestId=${requestId} workingFolder=${committedWorkingFolder}`,
    );

    void listAgentPrompts({
      agentName: selectedAgentName,
      working_folder: committedWorkingFolder,
    })
      .then((result) => {
        const stillActive =
          requestId === promptsRequestSeqRef.current &&
          selectedAgentNameRef.current === requestContext.agentName &&
          committedWorkingFolderRef.current ===
            requestContext.committedWorkingFolder;
        if (!stillActive) {
          console.info(
            `[agents.prompts.discovery.request.stale_ignored] requestId=${requestId} workingFolder=${committedWorkingFolder}`,
          );
          return;
        }
        setPromptEntries(result.prompts ?? []);
        setPromptsError(null);
      })
      .catch((err) => {
        const stillActive =
          requestId === promptsRequestSeqRef.current &&
          selectedAgentNameRef.current === requestContext.agentName &&
          committedWorkingFolderRef.current ===
            requestContext.committedWorkingFolder;
        if (!stillActive) {
          console.info(
            `[agents.prompts.discovery.request.stale_ignored] requestId=${requestId} workingFolder=${committedWorkingFolder}`,
          );
          return;
        }
        setPromptEntries([]);
        setPromptsError((err as Error).message);
      })
      .finally(() => {
        const stillActive =
          requestId === promptsRequestSeqRef.current &&
          selectedAgentNameRef.current === requestContext.agentName &&
          committedWorkingFolderRef.current ===
            requestContext.committedWorkingFolder;
        if (!stillActive) {
          return;
        }
        setPromptsLoading(false);
      });
  }, [
    committedWorkingFolder,
    invalidatePromptDiscoveryState,
    selectedAgentName,
  ]);

  const commandOptions = useMemo(() => {
    const options = commands.map((cmd) => ({
      ...cmd,
      key: buildCommandKey(cmd),
      label: buildCommandLabel(cmd),
      displayName: buildCommandDisplayName(cmd.name),
    }));
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [commands]);

  const selectedCommand = useMemo(
    () => commandOptions.find((cmd) => cmd.key === selectedCommandKey),
    [commandOptions, selectedCommandKey],
  );
  const selectedCommandStepCount = selectedCommand?.stepCount ?? 0;

  const selectedCommandDescription = useMemo(() => {
    if (!selectedCommand) {
      return '';
    }
    if (selectedCommand.disabled) return 'Invalid command file.';
    const description = selectedCommand.description.trim();
    return description || 'No description provided.';
  }, [selectedCommand]);
  const commandInfoOpen = Boolean(commandInfoAnchorEl);
  const commandInfoId = commandInfoOpen ? 'command-info-popover' : undefined;
  const commandInfoDisabled = !selectedCommand;
  const hasPromptEntries = promptEntries.length > 0;
  const shouldShowPromptsError = Boolean(
    committedWorkingFolder && promptsError && !hasPromptEntries,
  );
  const shouldShowPromptsRow = hasPromptEntries || shouldShowPromptsError;
  const selectedPromptEntry = useMemo(
    () =>
      promptEntries.find(
        (entry) => entry.fullPath === selectedPromptFullPath,
      ) ?? null,
    [promptEntries, selectedPromptFullPath],
  );
  const executePromptEnabled =
    selectedPromptEntry !== null &&
    Boolean(selectedAgentName) &&
    !startPending &&
    !persistenceUnavailable;

  useEffect(() => {
    if (selectedCommand && startStep > selectedCommand.stepCount) {
      setStartStep(1);
    }
  }, [selectedCommand, startStep]);

  useEffect(() => {
    if (!selectedPromptFullPath) return;
    const stillValid = promptEntries.some(
      (entry) => entry.fullPath === selectedPromptFullPath,
    );
    if (!stillValid) {
      setSelectedPromptFullPath('');
    }
  }, [promptEntries, selectedPromptFullPath]);

  useEffect(() => {
    if (hasPromptEntries) {
      const marker = `visible:${promptEntries.length}:${committedWorkingFolder}`;
      if (promptSelectorVisibilityLogRef.current === marker) {
        return;
      }
      promptSelectorVisibilityLogRef.current = marker;
      console.info(
        `[agents.prompts.selector.visible] promptCount=${promptEntries.length} workingFolder=${committedWorkingFolder}`,
      );
      return;
    }
    if (!committedWorkingFolder) {
      const marker = 'hidden:empty_working_folder';
      if (promptSelectorVisibilityLogRef.current === marker) {
        return;
      }
      promptSelectorVisibilityLogRef.current = marker;
      console.info(
        '[agents.prompts.selector.hidden] reason=empty_working_folder',
      );
      return;
    }
    if (!promptsLoading && !promptsError) {
      const marker = 'hidden:discovery_zero_results';
      if (promptSelectorVisibilityLogRef.current === marker) {
        return;
      }
      promptSelectorVisibilityLogRef.current = marker;
      console.info(
        '[agents.prompts.selector.hidden] reason=discovery_zero_results',
      );
    }
  }, [
    committedWorkingFolder,
    hasPromptEntries,
    promptEntries.length,
    promptsError,
    promptsLoading,
  ]);

  useEffect(() => {
    const relativePath = selectedPromptEntry?.relativePath ?? 'none';
    if (promptSelectionLogRef.current === relativePath) {
      return;
    }
    promptSelectionLogRef.current = relativePath;
    console.info(
      `[agents.prompts.selection.changed] relativePath=${relativePath}`,
    );
  }, [selectedPromptEntry]);

  const handlePromptSelectionChange = (event: SelectChangeEvent<string>) => {
    setSelectedPromptFullPath(event.target.value);
  };
  useEffect(() => {
    console.info('[agents.commandDescription.inlineRemoved] rendered=false');
  }, []);
  useEffect(() => {
    console.info(
      `[agents.commandDescription.source] mode=popover commandName=${selectedCommand?.name ?? 'none'}`,
    );
  }, [selectedCommand?.name]);
  useEffect(() => {
    if (!selectedCommand) {
      setCommandInfoAnchorEl(null);
    }
  }, [selectedCommand]);

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
  } = useConversations({
    agentName: effectiveAgentName,
    flowName: '__none__',
  });

  const selectedConversation = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.conversationId === activeConversationId,
      ),
    [activeConversationId, conversations],
  );
  const selectedConversationId = selectedConversation?.conversationId;

  useEffect(() => {
    persistConversationWorkingFolderRef.current = updateWorkingFolder;
  }, [updateWorkingFolder]);

  const turnsConversationId = persistenceUnavailable
    ? undefined
    : (selectedConversationId ??
      (startPending ? undefined : activeConversationId));

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

          applyWsUpsert(event.conversation);

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

          if (transcriptEvent.type === 'inflight_snapshot') {
            serverVisibleInflightIdRef.current =
              transcriptEvent.inflight.inflightId;
            currentRunKindRef.current = transcriptEvent.inflight.command
              ? 'command'
              : 'instruction';
          }

          if (
            transcriptEvent.type === 'turn_final' &&
            serverVisibleInflightIdRef.current === transcriptEvent.inflightId
          ) {
            serverVisibleInflightIdRef.current = null;
          }
          if (transcriptEvent.type === 'turn_final') {
            if (transcriptEvent.status === 'stopped') {
              setLiveStoppedMarker({
                conversationId: transcriptEvent.conversationId,
                inflightId: transcriptEvent.inflightId,
                turnId: transcriptEvent.inflightId,
                runKind: currentRunKindRef.current,
              });
            } else if (
              transcriptEvent.conversationId === activeConversationId
            ) {
              setLiveStoppedMarker(null);
            }
          }

          handleWsEvent(transcriptEvent);
          return;
        }
        case 'cancel_ack': {
          if (event.conversationId === activeConversationId) {
            setLiveStoppedMarker(null);
          }
          handleWsEvent(event);
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
    if (!activeConversationId || isStopping) {
      return;
    }

    const inflightId =
      serverVisibleInflightIdRef.current ?? getInflightId() ?? undefined;
    console.info('[stop-debug][agents-ui] stop-clicked', {
      conversationId: activeConversationId,
      ...(inflightId ? { inflightId } : {}),
      runKind: currentRunKindRef.current,
    });
    if (isDev0000038MarkerGateEnabled()) {
      console.info(
        '[DEV-0000038][T2] STOP_CLICK conversationId=%s inflightId=%s',
        activeConversationId ?? 'none',
        inflightId ?? 'none',
      );
    }
    log('info', 'DEV-0000021[T6] agents.stop clicked', {
      conversationId: activeConversationId,
      inflightId,
      runKind: currentRunKindRef.current,
    });

    const requestId = cancelInflight(activeConversationId, inflightId);
    log('info', 'DEV-0000021[T6] agents.ws cancel_inflight sent', {
      conversationId: activeConversationId,
      inflightId,
      runKind: currentRunKindRef.current,
      requestId,
    });

    stop({ requestId, showStatusBubble: true });
    setInput(lastSentRef.current);
    inputRef.current?.focus();
  }, [
    activeConversationId,
    cancelInflight,
    getInflightId,
    isStopping,
    log,
    stop,
  ]);

  const makeClientConversationId = () =>
    crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);

  const executeInstructionRun = useCallback(
    async (params: { instruction: string; workingFolder?: string }) => {
      const nextConversationId =
        activeConversationId && activeConversationId.trim().length > 0
          ? activeConversationId
          : makeClientConversationId();
      const isNewConversation = nextConversationId !== activeConversationId;

      currentRunKindRef.current = 'instruction';
      serverVisibleInflightIdRef.current = null;
      setLiveStoppedMarker(null);
      stoppedVisibleConversationRef.current = null;
      setStartPending(true);

      if (isNewConversation) {
        setConversation(nextConversationId, { clearMessages: true });
        setActiveConversationId(nextConversationId);
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
          instruction: params.instruction,
          working_folder: params.workingFolder,
          conversationId: nextConversationId,
        });
        setActiveConversationId(result.conversationId);
        if (result.modelId) {
          setAgentModelId(result.modelId);
        }
        void refreshConversations();
        return { status: 'started' as const };
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
          return { status: 'error' as const, code: err.code };
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
        return {
          status: 'error' as const,
          code: err instanceof AgentApiError ? err.code : undefined,
        };
      } finally {
        setStartPending(false);
      }
    },
    [
      activeConversationId,
      agentModelId,
      getInflightId,
      hydrateHistory,
      log,
      messages,
      refreshConversations,
      selectedAgentName,
      setConversation,
      subscribeConversation,
      wsConnectionState,
    ],
  );

  const resetConversation = useCallback(() => {
    setStartPending(false);
    setRunError(null);
    invalidatePromptDiscoveryState({
      reason: 'selected_agent_reset',
      clearCommittedWorkingFolder: true,
    });
    resetTurns();
    setActiveConversationId(undefined);
    setConversation(makeClientConversationId(), { clearMessages: true });
    setAgentModelId('unknown');
    setWorkingFolder('');
    setInput('');
    lastSentRef.current = '';
    stoppedVisibleConversationRef.current = null;
    void refreshConversations();
  }, [
    invalidatePromptDiscoveryState,
    refreshConversations,
    resetTurns,
    setConversation,
  ]);

  const handleAgentChange = useCallback(
    (event: SelectChangeEvent<string>) => {
      const next = event.target.value;
      if (next === selectedAgentName) return;
      setSelectedAgentName(next);
      setSelectedCommandKey('');
      setStartStep(1);
      setAgentModelId('unknown');
      resetConversation();
    },
    [resetConversation, selectedAgentName],
  );

  const handleCommandChange = useCallback(
    (event: SelectChangeEvent<string>) => {
      setSelectedCommandKey(event.target.value);
      setStartStep(1);
    },
    [],
  );

  const handleStartStepChange = useCallback(
    (event: SelectChangeEvent<string>) => {
      const parsed = Number.parseInt(event.target.value, 10);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return;
      }
      setStartStep(parsed);
    },
    [],
  );

  const handleToggleTool = useCallback(
    (id: string, messageId: string) => {
      const nextOpen = !toolOpen[id];
      if (nextOpen) {
        const matchCount = toolMatchCountByKey.get(id) ?? 0;
        if (!toolDistanceLoggedRef.current.has(id)) {
          toolDistanceLoggedRef.current.add(id);
          log('info', 'DEV-0000025:T7:tool_details_distance_rendered', {
            page: 'agents',
            matchCount,
          });
        }
      }
      toggleTool(id, messageId);
    },
    [log, toggleTool, toolMatchCountByKey, toolOpen],
  );

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
    serverVisibleInflightIdRef.current = inflightSnapshot.inflightId;
    currentRunKindRef.current = inflightSnapshot.command
      ? 'command'
      : 'instruction';
    hydrateInflightSnapshot(activeConversationId, inflightSnapshot);
  }, [activeConversationId, hydrateInflightSnapshot, inflightSnapshot]);

  useEffect(() => {
    if (!activeConversationId) {
      stoppingVisibleLoggedRef.current = null;
      stoppedVisibleConversationRef.current = null;
      return;
    }
    const activeConversationKey = activeConversationId;
    if (status !== 'stopping') {
      stoppingVisibleLoggedRef.current = null;
      return;
    }
    if (stoppingVisibleLoggedRef.current === activeConversationKey) return;
    stoppingVisibleLoggedRef.current = activeConversationKey;
    console.info('[stop-debug][agents-ui] stopping-visible', {
      conversationId: activeConversationKey,
      runKind: currentRunKindRef.current,
    });
  }, [activeConversationId, status]);

  useEffect(() => {
    if (!activeConversationId) {
      stoppedVisibleConversationRef.current = null;
      return;
    }
    const activeConversationKey = activeConversationId;
    displayMessages.forEach((message) => {
      const stoppedVisibleLogKey = message.id;
      if (
        message.role !== 'assistant' ||
        message.streamStatus !== 'stopped' ||
        stoppedVisibleLoggedRef.current.has(stoppedVisibleLogKey) ||
        stoppedVisibleConversationRef.current === activeConversationKey
      ) {
        return;
      }
      stoppedVisibleLoggedRef.current.add(stoppedVisibleLogKey);
      stoppedVisibleConversationRef.current = activeConversationKey;
      console.info('[stop-debug][agents-ui] stopped-visible', {
        conversationId: activeConversationKey,
        turnId: stoppedVisibleLogKey,
        runKind: message.command ? 'command' : 'instruction',
      });
    });
  }, [activeConversationId, displayMessages]);

  const handleTranscriptScroll = useCallback(() => {}, []);

  const handleSelectConversation = (conversationId: string) => {
    if (conversationId === activeConversationId) return;
    if (isRunActive && activeConversationId) {
      if (isDev0000038MarkerGateEnabled()) {
        console.info(
          '[DEV-0000038][T3] AGENTS_CONVERSATION_SWITCH_ALLOWED from=%s to=%s',
          activeConversationId,
          conversationId,
        );
      }
    }
    resetTurns();
    setConversation(conversationId, { clearMessages: true });
    serverVisibleInflightIdRef.current = null;
    currentRunKindRef.current = 'instruction';
    setLiveStoppedMarker(null);
    stoppedVisibleConversationRef.current = null;
    const summary = conversations.find(
      (conversation) => conversation.conversationId === conversationId,
    );
    if (summary?.model) {
      setAgentModelId(summary.model);
    }
    setActiveConversationId(conversationId);
  };

  useEffect(() => {
    if (!selectedConversationId) {
      workingFolderRestoreKeyRef.current = null;
      return;
    }

    const restoredWorkingFolder = readWorkingFolder(selectedConversation) ?? '';
    setWorkingFolder((current) =>
      current === restoredWorkingFolder ? current : restoredWorkingFolder,
    );
    if (restoredWorkingFolder !== lastCommittedWorkingFolderRef.current) {
      if (restoredWorkingFolder) {
        lastCommittedWorkingFolderRef.current = restoredWorkingFolder;
        setCommittedWorkingFolder(restoredWorkingFolder);
      } else {
        invalidatePromptDiscoveryState({
          reason: 'committed_working_folder_cleared',
          clearCommittedWorkingFolder: true,
        });
      }
    }

    const restoreKey = `${selectedConversationId}:${restoredWorkingFolder}`;
    if (workingFolderRestoreKeyRef.current === restoreKey) return;
    workingFolderRestoreKeyRef.current = restoreKey;
    emitWorkingFolderPickerSync({
      surface: 'agents',
      conversationId: selectedConversationId,
      action: restoredWorkingFolder ? 'restore' : 'clear',
      pickerState: restoredWorkingFolder,
    });
  }, [
    emitWorkingFolderPickerSync,
    invalidatePromptDiscoveryState,
    readWorkingFolder,
    selectedConversation,
    selectedConversationId,
  ]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setRunError(null);
    const rawInstruction = input;
    const hasNonWhitespaceContent = rawInstruction.trim().length > 0;
    const blockedBySelection = !selectedAgentName;
    const blockedByPending = startPending;
    log('info', 'DEV-0000035:T11:agents_raw_send_evaluated', {
      source: 'agents_page',
      rawLength: rawInstruction.length,
      trimmedLength: rawInstruction.trim().length,
      hasNonWhitespaceContent,
      blockedBySelection,
      blockedByPending,
    });
    if (!hasNonWhitespaceContent || blockedBySelection || blockedByPending) {
      log('info', 'DEV-0000035:T11:agents_raw_send_result', {
        source: 'agents_page',
        sent: false,
        reason: !hasNonWhitespaceContent
          ? 'whitespace_only'
          : blockedBySelection
            ? 'missing_agent'
            : 'start_pending',
        rawLength: rawInstruction.length,
        trimmedLength: rawInstruction.trim().length,
      });
      return;
    }

    if (persistenceUnavailable || !wsTranscriptReady) {
      setRunError(
        'Realtime connection unavailable — Agents runs require WebSocket streaming.',
      );
      return;
    }

    lastSentRef.current = rawInstruction;
    setInput('');
    await executeInstructionRun({
      instruction: rawInstruction,
      workingFolder: workingFolder.trim() || undefined,
    });
  };

  const handleExecutePrompt = useCallback(async () => {
    setRunError(null);
    if (
      !selectedAgentName ||
      !selectedPromptEntry ||
      startPending ||
      persistenceUnavailable ||
      !wsTranscriptReady
    ) {
      return;
    }

    console.info(
      `[agents.prompts.execute.clicked] relativePath=${selectedPromptEntry.relativePath} fullPath=${selectedPromptEntry.fullPath}`,
    );
    const instruction = EXECUTE_PROMPT_INSTRUCTION_TEMPLATE.replace(
      '<full path of markdown file>',
      selectedPromptEntry.fullPath,
    );
    const instructionHasFullPath = instruction.includes(
      selectedPromptEntry.fullPath,
    );
    console.info(
      `[agents.prompts.execute.payload_built] instructionHasFullPath=${instructionHasFullPath ? 'true' : 'false'}`,
    );

    lastSentRef.current = instruction;
    const result = await executeInstructionRun({
      instruction,
      workingFolder: committedWorkingFolder || undefined,
    });
    console.info(
      `[agents.prompts.execute.result] status=${result.status} code=${result.status === 'error' ? (result.code ?? 'none') : 'none'}`,
    );
  }, [
    committedWorkingFolder,
    executeInstructionRun,
    persistenceUnavailable,
    selectedAgentName,
    selectedPromptEntry,
    startPending,
    wsTranscriptReady,
  ]);

  const handleExecuteCommand = useCallback(async () => {
    setRunError(null);
    if (
      !selectedAgentName ||
      !selectedCommand ||
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

    currentRunKindRef.current = 'command';
    serverVisibleInflightIdRef.current = null;
    setLiveStoppedMarker(null);
    stoppedVisibleConversationRef.current = null;
    setStartPending(true);

    try {
      if (isNewConversation) {
        setConversation(nextConversationId, { clearMessages: true });
        setActiveConversationId(nextConversationId);
        setAgentModelId('unknown');
      }

      log('info', 'DEV-0000021[T4] agents.ws subscribe_conversation', {
        conversationId: nextConversationId,
        inflightId: getInflightId(),
        modelId: agentModelId,
        wsConnectionState,
      });
      subscribeConversation(nextConversationId);

      log('info', 'DEV-0000034:T5:agents.command_run_payload', {
        commandName: selectedCommand.name,
        sourceId: selectedCommand.sourceId ?? 'local',
        startStep,
      });
      console.info('DEV_0000040_T05_AGENTS_UI_EXECUTE', {
        agentName: selectedAgentName,
        commandName: selectedCommand.name,
        sourceId: selectedCommand.sourceId ?? null,
        startStep,
      });
      const result = await runAgentCommand({
        agentName: selectedAgentName,
        commandName: selectedCommand.name,
        startStep,
        sourceId: selectedCommand.sourceId,
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
    selectedCommand,
    startStep,
    setConversation,
    startPending,
    subscribeConversation,
    wsConnectionState,
    wsTranscriptReady,
    workingFolder,
  ]);

  const selectedAgent = agents.find((a) => a.name === selectedAgentName);
  const hasVisibleStoppedRun =
    liveStoppedMarker !== null &&
    liveStoppedMarker.conversationId === activeConversationId &&
    !isStopping;
  const isRunActive =
    startPending ||
    ((isStreaming || status === 'sending') && !hasVisibleStoppedRun) ||
    isStopping;
  const controlsDisabled =
    agentsLoading || !!agentsError || !selectedAgentName || persistenceLoading;
  const submitDisabledForRun = isRunActive;
  const agentWorkingFolderLocked =
    isRunActive ||
    Boolean(inflightSnapshot?.inflightId) ||
    Boolean(serverVisibleInflightIdRef.current);
  const startStepDisabled =
    controlsDisabled ||
    submitDisabledForRun ||
    selectedAgent?.disabled ||
    commandsLoading ||
    !selectedCommand ||
    selectedCommand.disabled ||
    selectedCommandStepCount <= 1;
  const inputEditableDuringRun = true;
  const sidebarSelectableDuringRun = true;
  const isWorkingFolderDisabled =
    controlsDisabled ||
    agentWorkingFolderLocked ||
    !wsTranscriptReady ||
    Boolean(selectedAgent?.disabled);
  const isInstructionInputDisabled =
    !inputEditableDuringRun ||
    !wsTranscriptReady ||
    Boolean(selectedAgent?.disabled);
  const conversationListDisabled =
    !sidebarSelectableDuringRun || persistenceUnavailable;

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  useEffect(() => {
    workingFolderDisabledRef.current = isWorkingFolderDisabled;
  }, [isWorkingFolderDisabled]);

  useEffect(() => {
    if (!agentWorkingFolderLocked) {
      workingFolderLockKeyRef.current = null;
      return;
    }

    const conversationKey = activeConversationId ?? getConversationId();
    const lockKey = `${conversationKey}:${workingFolder.trim()}`;
    if (workingFolderLockKeyRef.current === lockKey) return;
    workingFolderLockKeyRef.current = lockKey;
    emitWorkingFolderPickerSync({
      surface: 'agents',
      conversationId: conversationKey,
      action: 'lock',
      pickerState: workingFolder.trim(),
    });
  }, [
    activeConversationId,
    agentWorkingFolderLocked,
    emitWorkingFolderPickerSync,
    getConversationId,
    workingFolder,
  ]);

  const hasFilters = true;
  const hasBulkActions = Boolean(bulkArchive || bulkRestore || bulkDelete);
  const hasRowActions = true;

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

  const agentDescription = selectedAgent?.description?.trim();
  const agentWarnings = selectedAgent?.warnings ?? [];
  const agentInfoOpen = Boolean(agentInfoAnchorEl);
  const agentInfoId = agentInfoOpen ? 'agent-info-popover' : undefined;
  const agentInfoDisabled = agentsLoading || !selectedAgentName;
  const showAgentInfoButton = !agentsError;
  const agentInfoEmpty = !agentDescription && agentWarnings.length === 0;
  const agentInfoEmptyMessage =
    'No description or warnings are available for this agent yet.';

  const showStop = isRunActive;
  useEffect(() => {
    log('info', 'DEV-0000028[T4] agents action slot state', {
      showStop,
      minWidth: actionSlotMinWidth,
    });
  }, [actionSlotMinWidth, log, showStop]);

  const handleComposerInputChange = useCallback(
    (nextValue: string) => {
      if (isRunActive && isDev0000038MarkerGateEnabled()) {
        console.info(
          '[DEV-0000038][T3] AGENTS_INPUT_EDITABLE_WHILE_ACTIVE runActive=true',
        );
      }
      setInput(nextValue);
    },
    [isRunActive],
  );

  const handleResetConversation = useCallback(() => {
    resetConversation();
    inputRef.current?.focus();
  }, [resetConversation]);

  const handleToggleDrawer = useCallback(() => {
    if (isMobile) {
      setMobileDrawerOpen((prev) => {
        const next = !prev;
        log('info', 'DEV-0000021[T8] agents.layout drawer toggle', {
          open: next,
        });
        return next;
      });
      return;
    }

    setDesktopDrawerOpen((prev) => !prev);
  }, [isMobile, log]);

  const handleAgentInfoOpen = (event: React.MouseEvent<HTMLElement>) => {
    if (agentInfoDisabled) return;
    setAgentInfoAnchorEl(event.currentTarget);
    log('info', 'DEV-0000028[T2] agent info popover opened', {
      agentName: selectedAgentName,
      hasDescription: Boolean(agentDescription),
      warningsCount: agentWarnings.length,
    });
  };
  const handleAgentInfoClose = () => {
    setAgentInfoAnchorEl(null);
  };
  const handleCommandInfoAttempt = () => {
    if (!commandInfoDisabled) return;
    console.info('[agents.commandInfo.blocked] reason=no_command_selected');
  };
  const handleCommandInfoOpen = (event: React.MouseEvent<HTMLElement>) => {
    if (commandInfoDisabled || !selectedCommand) {
      console.info('[agents.commandInfo.blocked] reason=no_command_selected');
      return;
    }
    setCommandInfoAnchorEl(event.currentTarget);
    console.info(
      `[agents.commandInfo.open] commandName=${selectedCommand.name}`,
    );
  };
  const handleCommandInfoClose = () => {
    setCommandInfoAnchorEl(null);
  };
  return (
    <Container
      maxWidth={false}
      data-testid="agents-page"
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
              <AgentsComposerPanel
                drawerOpen={drawerOpen}
                agentsLoading={agentsLoading}
                agentsError={agentsError}
                selectedAgentName={selectedAgentName}
                selectedCommandKey={selectedCommandKey}
                startStep={startStep}
                selectedCommandStepCount={selectedCommandStepCount}
                selectedCommandDescription={selectedCommandDescription}
                agentWarnings={agentWarnings}
                agentDescription={agentDescription}
                agentInfoDisabled={agentInfoDisabled}
                showAgentInfoButton={showAgentInfoButton}
                agentInfoEmpty={agentInfoEmpty}
                agentInfoEmptyMessage={agentInfoEmptyMessage}
                commandsError={commandsError}
                commandsLoading={commandsLoading}
                controlsDisabled={controlsDisabled}
                submitDisabledForRun={submitDisabledForRun}
                startStepDisabled={startStepDisabled}
                persistenceUnavailable={persistenceUnavailable}
                wsTranscriptReady={wsTranscriptReady}
                isWorkingFolderDisabled={isWorkingFolderDisabled}
                isInstructionInputDisabled={isInstructionInputDisabled}
                hasPromptEntries={hasPromptEntries}
                shouldShowPromptsError={shouldShowPromptsError}
                shouldShowPromptsRow={shouldShowPromptsRow}
                executePromptEnabled={executePromptEnabled}
                selectedPromptFullPath={selectedPromptFullPath}
                input={input}
                workingFolder={workingFolder}
                showStop={showStop}
                isStopping={isStopping}
                canShowDeviceAuth={canShowDeviceAuth}
                commandInfoDisabled={commandInfoDisabled}
                actionSlotMinWidth={actionSlotMinWidth}
                selectedAgentDisabled={Boolean(selectedAgent?.disabled)}
                agents={agents}
                commandOptions={commandOptions}
                promptEntries={promptEntries}
                onToggleDrawer={handleToggleDrawer}
                onSubmit={handleSubmit}
                onAgentChange={handleAgentChange}
                onCommandChange={handleCommandChange}
                onStartStepChange={handleStartStepChange}
                onResetConversation={handleResetConversation}
                onAgentInfoOpen={handleAgentInfoOpen}
                onAgentInfoClose={handleAgentInfoClose}
                onCommandInfoAttempt={handleCommandInfoAttempt}
                onCommandInfoOpen={handleCommandInfoOpen}
                onCommandInfoClose={handleCommandInfoClose}
                onExecuteCommand={handleExecuteCommand}
                onWorkingFolderChange={setWorkingFolder}
                onCommitWorkingFolder={commitWorkingFolder}
                onOpenDirPicker={handleOpenDirPicker}
                onPromptSelectionChange={handlePromptSelectionChange}
                onExecutePrompt={handleExecutePrompt}
                onInputChange={handleComposerInputChange}
                onStopClick={handleStopClick}
                onDeviceAuthOpen={handleDeviceAuthOpen}
                onDeviceAuthClose={handleDeviceAuthClose}
                onDeviceAuthSuccess={handleDeviceAuthSuccess}
                dirPickerOpen={dirPickerOpen}
                onCloseDirPicker={handleCloseDirPicker}
                onPickDir={handlePickDir}
                deviceAuthOpen={deviceAuthOpen}
                agentInfoId={agentInfoId}
                agentInfoOpen={agentInfoOpen}
                agentInfoAnchorEl={agentInfoAnchorEl}
                commandInfoId={commandInfoId}
                commandInfoOpen={commandInfoOpen}
                commandInfoAnchorEl={commandInfoAnchorEl}
                inputRef={inputRef}
                conversationId={activeConversationId}
                promptsError={promptsError}
              />
              <AgentsTranscriptPane
                conversationId={activeConversationId}
                transcriptRef={transcriptRef}
                onScroll={handleTranscriptScroll}
                displayMessages={displayMessages}
                turnsLoading={turnsLoading}
                turnsError={turnsError}
                turnsErrorMessage={turnsErrorMessage}
                citationsOpen={citationsOpen}
                thinkOpen={thinkOpen}
                toolOpen={toolOpen}
                toolErrorOpen={toolErrorOpen}
                activeToolsAvailable
                latestAssistantMessageId={latestAssistantMessageId}
                liveStoppedMarker={liveStoppedMarker}
                isStopping={isStopping}
                onToggleCitation={toggleCitation}
                onToggleThink={toggleThink}
                onToggleTool={handleToggleTool}
                onToggleToolError={toggleToolError}
              />
            </Stack>
          </Box>
        </Stack>
      </Stack>
    </Container>
  );
}
