import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import {
  Alert,
  Box,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  type SxProps,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type UIEventHandler,
} from 'react';
import type { ChatMessage, ToolCall } from '../../hooks/useChatStream';
import { createLogger } from '../../logging/logger';
import SharedTranscriptMessageRow from './SharedTranscriptMessageRow';
import VirtualizedTranscript from './VirtualizedTranscript';

type SharedTranscriptLogConfig = {
  eventName: string;
  context: Record<string, unknown>;
};

type TranscriptScrollSnapshot = {
  scrollMode: SharedTranscriptScrollMode;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

type SharedTranscriptProps = {
  surface: 'chat' | 'agents' | 'flows';
  conversationId?: string | null;
  messages: ChatMessage[];
  activeToolsAvailable: boolean;
  turnsLoading?: boolean;
  turnsError?: boolean;
  turnsErrorMessage?: string | null;
  emptyMessage: string;
  emptyStateContent?: ReactNode;
  warningTestId?: string;
  transcriptTestId?: string;
  citationsEnabled?: boolean;
  isStopping?: boolean;
  citationsOpen: Record<string, boolean>;
  thinkOpen: Record<string, boolean>;
  toolOpen: Record<string, boolean>;
  toolErrorOpen: Record<string, boolean>;
  onToggleCitation: (messageId: string) => void;
  onToggleThink: (messageId: string) => void;
  onToggleTool: (toggleKey: string, messageId: string) => void;
  onToggleToolError: (toggleKey: string, messageId: string) => void;
  onScroll?: UIEventHandler<HTMLDivElement>;
  markdownLogSource?: string;
  userMarkdownTestId?: string;
  resolveStreamStatus?: (
    message: ChatMessage,
  ) => ChatMessage['streamStatus'] | null | undefined;
  renderToolExtraContent?: (
    tool: ToolCall,
    toggleKey: string,
    message: ChatMessage,
  ) => ReactNode;
  renderHeaderContent?: (message: ChatMessage) => ReactNode;
  renderMetadataContent?: (message: ChatMessage) => ReactNode;
  sharedRenderLogConfig?: SharedTranscriptLogConfig;
  contentSx?: SxProps<Theme>;
};

const sharedTranscriptLog = createLogger('client');
const SHARED_TRANSCRIPT_NEAR_BOTTOM_THRESHOLD_PX = 64;
type SharedTranscriptScrollMode = 'pinned-bottom' | 'scrolled-away';

const SharedTranscript = forwardRef<HTMLDivElement, SharedTranscriptProps>(
  function SharedTranscript(
    {
      surface,
      conversationId,
      messages,
      activeToolsAvailable,
      turnsLoading = false,
      turnsError = false,
      turnsErrorMessage,
      emptyMessage,
      emptyStateContent,
      warningTestId = 'turns-error',
      transcriptTestId = 'chat-transcript',
      citationsEnabled = true,
      isStopping = false,
      citationsOpen,
      thinkOpen,
      toolOpen,
      toolErrorOpen,
      onToggleCitation,
      onToggleThink,
      onToggleTool,
      onToggleToolError,
      onScroll,
      markdownLogSource,
      userMarkdownTestId,
      resolveStreamStatus,
      renderToolExtraContent,
      renderHeaderContent,
      renderMetadataContent,
      sharedRenderLogConfig,
      contentSx,
    },
    ref,
  ) {
    const transcriptContainerRef = useRef<HTMLDivElement | null>(null);
    const lastRenderStateRef = useRef<string | null>(null);
    const lastConversationKeyRef = useRef<string | null>(null);
    const measurementReadyRef = useRef<string | null>(null);
    const missingRowLoggedRef = useRef(new Set<string>());
    const scrollModeRef = useRef<SharedTranscriptScrollMode>('pinned-bottom');
    const pendingConversationRepinRef = useRef(false);
    const pendingRepinUserScrollIntentRef = useRef(false);
    const [pendingConversationRepin, setPendingConversationRepinState] =
      useState(false);
    const [scrollModeState, setScrollModeState] =
      useState<SharedTranscriptScrollMode>('pinned-bottom');
    const scrollMetricsRef = useRef<{
      conversationKey: string;
      scrollHeight: number;
      scrollTop: number;
    } | null>(null);
    const hasWarningState = turnsError;
    const hasEmptyState = messages.length === 0;
    const conversationKey = `${surface}:${conversationId ?? 'none'}`;
    const renderStateKey = useMemo(
      () =>
        JSON.stringify({
          surface,
          messageCount: messages.length,
          hasWarningState,
          hasEmptyState,
          sharedRenderLogContext: sharedRenderLogConfig?.context ?? null,
        }),
      [
        surface,
        messages.length,
        hasWarningState,
        hasEmptyState,
        sharedRenderLogConfig,
      ],
    );

    const setContainerRef = useCallback(
      (node: HTMLDivElement | null) => {
        transcriptContainerRef.current = node;
        if (typeof ref === 'function') {
          ref(node);
          return;
        }
        if (ref) {
          ref.current = node;
        }
      },
      [ref],
    );

    const isNearBottom = useCallback((element: HTMLDivElement) => {
      const distanceFromBottom =
        element.scrollHeight - element.clientHeight - element.scrollTop;
      return distanceFromBottom <= SHARED_TRANSCRIPT_NEAR_BOTTOM_THRESHOLD_PX;
    }, []);

    const setScrollMode = useCallback(
      (nextMode: SharedTranscriptScrollMode) => {
        if (scrollModeRef.current === nextMode) {
          return;
        }
        scrollModeRef.current = nextMode;
        setScrollModeState(nextMode);
        sharedTranscriptLog(
          'info',
          'DEV-0000049:T08:shared_transcript_scroll_mode_changed',
          {
            surface,
            conversationId: conversationId ?? null,
            mode: nextMode,
          },
        );
      },
      [conversationId, surface],
    );

    const syncScrollMetrics = useCallback(() => {
      const transcriptElement = transcriptContainerRef.current;
      if (!transcriptElement) {
        return;
      }
      scrollMetricsRef.current = {
        conversationKey,
        scrollHeight: transcriptElement.scrollHeight,
        scrollTop: transcriptElement.scrollTop,
      };
    }, [conversationKey]);

    const setPendingConversationRepin = useCallback(
      (nextPending: boolean) => {
        pendingConversationRepinRef.current = nextPending;
        setPendingConversationRepinState(nextPending);
        pendingRepinUserScrollIntentRef.current = false;
        if (nextPending) {
          setScrollMode('pinned-bottom');
        }
      },
      [setScrollMode],
    );

    const jumpToLatest = useCallback(() => {
      const transcriptElement = transcriptContainerRef.current;
      if (!transcriptElement) {
        return;
      }
      transcriptElement.scrollTop = Math.max(
        0,
        transcriptElement.scrollHeight - transcriptElement.clientHeight,
      );
      setPendingConversationRepin(false);
      setScrollMode('pinned-bottom');
      syncScrollMetrics();
    }, [setPendingConversationRepin, setScrollMode, syncScrollMetrics]);

    const getScrollSnapshot =
      useCallback((): TranscriptScrollSnapshot | null => {
        const transcriptElement = transcriptContainerRef.current;
        if (!transcriptElement) {
          return null;
        }
        return {
          scrollMode: scrollModeRef.current,
          scrollTop: transcriptElement.scrollTop,
          scrollHeight: transcriptElement.scrollHeight,
          clientHeight: transcriptElement.clientHeight,
        };
      }, []);

    const reconcileScrollPosition = useCallback(() => {
      const transcriptElement = transcriptContainerRef.current;
      if (!transcriptElement) {
        return;
      }
      const shouldRepinToBottom =
        scrollModeRef.current === 'pinned-bottom' ||
        pendingConversationRepinRef.current;

      const previousMetrics = scrollMetricsRef.current;
      if (
        !previousMetrics ||
        previousMetrics.conversationKey !== conversationKey
      ) {
        if (shouldRepinToBottom) {
          transcriptElement.scrollTop = Math.max(
            0,
            transcriptElement.scrollHeight - transcriptElement.clientHeight,
          );
        }
        syncScrollMetrics();
        return;
      }

      const deltaScrollHeight =
        transcriptElement.scrollHeight - previousMetrics.scrollHeight;
      if (deltaScrollHeight === 0) {
        if (shouldRepinToBottom && !isNearBottom(transcriptElement)) {
          transcriptElement.scrollTop = Math.max(
            0,
            transcriptElement.scrollHeight - transcriptElement.clientHeight,
          );
        }
        syncScrollMetrics();
        return;
      }

      if (shouldRepinToBottom) {
        transcriptElement.scrollTop = Math.max(
          0,
          transcriptElement.scrollHeight - transcriptElement.clientHeight,
        );
      }

      syncScrollMetrics();
    }, [conversationKey, isNearBottom, syncScrollMetrics]);

    const handleSharedTranscriptScroll = useCallback<
      UIEventHandler<HTMLDivElement>
    >(
      (event) => {
        const nearBottom = isNearBottom(event.currentTarget);
        if (pendingConversationRepinRef.current) {
          if (nearBottom) {
            setScrollMode('pinned-bottom');
            syncScrollMetrics();
            onScroll?.(event);
            return;
          }
          if (pendingRepinUserScrollIntentRef.current) {
            setPendingConversationRepin(false);
            setScrollMode('scrolled-away');
            syncScrollMetrics();
            onScroll?.(event);
            return;
          }
          setScrollMode('pinned-bottom');
          syncScrollMetrics();
          onScroll?.(event);
          return;
        }
        const nextMode = nearBottom ? 'pinned-bottom' : 'scrolled-away';
        setScrollMode(nextMode);
        syncScrollMetrics();
        onScroll?.(event);
      },
      [
        isNearBottom,
        onScroll,
        setPendingConversationRepin,
        setScrollMode,
        syncScrollMetrics,
      ],
    );

    useEffect(() => {
      if (!sharedRenderLogConfig) {
        return;
      }
      if (lastRenderStateRef.current === renderStateKey) {
        return;
      }
      lastRenderStateRef.current = renderStateKey;
      sharedTranscriptLog('info', sharedRenderLogConfig.eventName, {
        surface,
        messageCount: messages.length,
        hasWarningState,
        hasEmptyState,
        ...sharedRenderLogConfig.context,
      });
    }, [
      sharedRenderLogConfig,
      renderStateKey,
      surface,
      messages.length,
      hasWarningState,
      hasEmptyState,
    ]);

    useEffect(() => {
      missingRowLoggedRef.current.clear();
    }, [surface, conversationId]);

    useEffect(() => {
      const transcriptElement = transcriptContainerRef.current;
      if (!transcriptElement || typeof ResizeObserver === 'undefined') {
        return;
      }

      const measurementKey = `${surface}:${conversationId ?? 'none'}`;
      if (measurementReadyRef.current !== measurementKey) {
        measurementReadyRef.current = measurementKey;
        sharedTranscriptLog(
          'info',
          'DEV-0000049:T06:transcript_measurement_support_ready',
          {
            surface,
            conversationId: conversationId ?? null,
          },
        );
      }

      const observer = new ResizeObserver((entries) => {
        entries.forEach((entry) => {
          try {
            if (!(entry.target instanceof HTMLElement)) {
              return;
            }
            if (entry.target === transcriptElement) {
              reconcileScrollPosition();
              return;
            }
            const rowId = entry.target.dataset.transcriptRowId;
            if (!rowId || entry.target.isConnected) {
              return;
            }
            const missingRowKey = `${measurementKey}:${rowId}`;
            if (missingRowLoggedRef.current.has(missingRowKey)) {
              return;
            }
            missingRowLoggedRef.current.add(missingRowKey);
            sharedTranscriptLog(
              'info',
              'DEV-0000049:T06:transcript_measurement_missing_row_ignored',
              {
                surface,
                conversationId: conversationId ?? null,
                reason: 'missing-row-target',
              },
            );
          } catch (err) {
            sharedTranscriptLog(
              'warn',
              'DEV-0000049:T06:transcript_measurement_error',
              {
                surface,
                conversationId: conversationId ?? null,
                error: err instanceof Error ? err.message : String(err),
              },
            );
          }
        });
      });

      observer.observe(transcriptElement);
      transcriptElement
        .querySelectorAll<HTMLElement>('[data-transcript-row-id]')
        .forEach((row) => observer.observe(row));

      return () => observer.disconnect();
    }, [conversationId, messages, reconcileScrollPosition, surface]);

    useLayoutEffect(() => {
      const previousConversationKey = lastConversationKeyRef.current;
      lastConversationKeyRef.current = conversationKey;
      scrollModeRef.current = 'pinned-bottom';
      setScrollModeState('pinned-bottom');
      scrollMetricsRef.current = null;
      setPendingConversationRepin(
        conversationId != null &&
          previousConversationKey != null &&
          previousConversationKey !== conversationKey,
      );
    }, [conversationId, conversationKey, setPendingConversationRepin]);

    useLayoutEffect(() => {
      reconcileScrollPosition();
    }, [
      reconcileScrollPosition,
      messages,
      citationsOpen,
      thinkOpen,
      toolOpen,
      toolErrorOpen,
      turnsError,
      syncScrollMetrics,
    ]);

    const renderMessageRow = useCallback(
      (message: ChatMessage) => (
        <SharedTranscriptMessageRow
          key={message.id}
          message={message}
          activeToolsAvailable={activeToolsAvailable}
          citationsEnabled={citationsEnabled}
          isStopping={isStopping}
          citationsOpen={citationsOpen}
          thinkOpen={thinkOpen}
          toolOpen={toolOpen}
          toolErrorOpen={toolErrorOpen}
          onToggleCitation={onToggleCitation}
          onToggleThink={onToggleThink}
          onToggleTool={onToggleTool}
          onToggleToolError={onToggleToolError}
          visibleStreamStatus={
            resolveStreamStatus?.(message) ?? message.streamStatus
          }
          renderToolExtraContent={renderToolExtraContent}
          renderHeaderContent={renderHeaderContent}
          renderMetadataContent={renderMetadataContent}
          userMarkdownTestId={userMarkdownTestId}
          log={sharedTranscriptLog}
          markdownLogSource={markdownLogSource}
        />
      ),
      [
        activeToolsAvailable,
        citationsEnabled,
        citationsOpen,
        isStopping,
        markdownLogSource,
        onToggleCitation,
        onToggleThink,
        onToggleTool,
        onToggleToolError,
        renderHeaderContent,
        renderMetadataContent,
        renderToolExtraContent,
        resolveStreamStatus,
        thinkOpen,
        toolErrorOpen,
        toolOpen,
        userMarkdownTestId,
      ],
    );

    const measurementKeyByMessageId = useMemo(() => {
      return Object.fromEntries(
        messages.map((message) => {
          const toolToggleKeys =
            message.tools?.map((tool) => `${message.id}-${tool.id}`) ?? [];
          const openToolKeys = toolToggleKeys.filter((key) => toolOpen[key]);
          const openToolErrorKeys = toolToggleKeys.filter(
            (key) => toolErrorOpen[key],
          );
          const segmentSignature = (message.segments ?? [])
            .map((segment) => {
              return segment.kind === 'text'
                ? `text:${segment.id}:${segment.content.length}`
                : `tool:${segment.id}:${segment.tool.status}:${segment.tool.name ?? 'unknown'}`;
            })
            .join('|');

          return [
            message.id,
            JSON.stringify({
              contentLength: message.content?.length ?? 0,
              thinkLength: message.think?.length ?? 0,
              citationsCount: citationsEnabled
                ? (message.citations?.length ?? 0)
                : 0,
              warningsCount: message.warnings?.length ?? 0,
              streamStatus:
                resolveStreamStatus?.(message) ?? message.streamStatus ?? null,
              citationsOpen:
                citationsEnabled && Boolean(citationsOpen[message.id]),
              thinkOpen: Boolean(thinkOpen[message.id]),
              openToolKeys,
              openToolErrorKeys,
              segmentSignature,
            }),
          ];
        }),
      );
    }, [
      citationsEnabled,
      citationsOpen,
      messages,
      resolveStreamStatus,
      thinkOpen,
      toolErrorOpen,
      toolOpen,
    ]);

    return (
      <Box
        sx={{
          flex: 1,
          height: '100%',
          minHeight: 0,
          minWidth: 0,
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {scrollModeState === 'scrolled-away' ? (
          <Box
            sx={{
              position: 'absolute',
              right: { xs: 10, sm: 14 },
              bottom: { xs: 10, sm: 14 },
              zIndex: 2,
            }}
          >
            <Tooltip title="Jump to latest">
              <IconButton
                size="small"
                aria-label="Jump to latest"
                data-testid="transcript-jump-to-latest"
                onClick={jumpToLatest}
                sx={{
                  width: 36,
                  height: 36,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                  color: 'text.primary',
                  boxShadow: '0 6px 18px rgba(15, 23, 42, 0.18)',
                  '&:hover': {
                    bgcolor: 'action.hover',
                  },
                }}
              >
                <KeyboardArrowDownRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        ) : null}
        <Box
          ref={setContainerRef}
          onScroll={handleSharedTranscriptScroll}
          onPointerDownCapture={() => {
            if (pendingConversationRepinRef.current) {
              pendingRepinUserScrollIntentRef.current = true;
            }
          }}
          onTouchMoveCapture={() => {
            if (pendingConversationRepinRef.current) {
              pendingRepinUserScrollIntentRef.current = true;
            }
          }}
          onWheelCapture={() => {
            if (pendingConversationRepinRef.current) {
              pendingRepinUserScrollIntentRef.current = true;
            }
          }}
          data-testid={transcriptTestId}
          style={{
            flexGrow: 1,
            flexShrink: 1,
            flexBasis: '0%',
            minHeight: '0px',
            overflowY: 'auto',
            scrollbarGutter: 'stable',
            scrollbarWidth: 'thin',
          }}
          sx={{
            flex: 1,
            height: '100%',
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            minWidth: 0,
            scrollbarGutter: 'stable',
            scrollbarWidth: 'thin',
            scrollbarColor: (theme) =>
              `${theme.palette.action.disabled} transparent`,
            '&::-webkit-scrollbar': {
              width: 10,
              height: 10,
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: 'action.disabled',
              borderRadius: 999,
              border: '2px solid transparent',
              backgroundClip: 'content-box',
            },
            '&::-webkit-scrollbar-track': {
              backgroundColor: 'transparent',
            },
            ...contentSx,
          }}
        >
          <Stack spacing={1} sx={{ minHeight: 0, flex: 1, width: '100%' }}>
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
              <Alert severity="warning" data-testid={warningTestId}>
                {turnsErrorMessage ?? 'Failed to load conversation history.'}
              </Alert>
            )}
            {messages.length === 0 &&
              (emptyStateContent ?? (
                <Typography color="text.secondary">{emptyMessage}</Typography>
              ))}
            <VirtualizedTranscript
              surface={surface}
              conversationId={conversationId}
              messages={messages}
              turnsLoading={turnsLoading}
              transcriptContainerRef={transcriptContainerRef}
              renderMessageRow={renderMessageRow}
              measurementKeyByMessageId={measurementKeyByMessageId}
              getScrollSnapshot={getScrollSnapshot}
              pendingConversationRepin={pendingConversationRepin}
            />
          </Stack>
        </Box>
      </Box>
    );
  },
);

export default SharedTranscript;
