import { Alert, Box, Stack, Typography } from '@mui/material';
import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
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
  renderMetadataContent?: (message: ChatMessage) => ReactNode;
  sharedRenderLogConfig?: SharedTranscriptLogConfig;
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
      renderMetadataContent,
      sharedRenderLogConfig,
    },
    ref,
  ) {
    const transcriptContainerRef = useRef<HTMLDivElement | null>(null);
    const lastRenderStateRef = useRef<string | null>(null);
    const measurementReadyRef = useRef<string | null>(null);
    const missingRowLoggedRef = useRef(new Set<string>());
    const scrollModeRef = useRef<SharedTranscriptScrollMode>('pinned-bottom');
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

    const reconcileScrollPosition = useCallback(() => {
      const transcriptElement = transcriptContainerRef.current;
      if (!transcriptElement) {
        return;
      }

      const previousMetrics = scrollMetricsRef.current;
      if (
        !previousMetrics ||
        previousMetrics.conversationKey !== conversationKey
      ) {
        if (scrollModeRef.current === 'pinned-bottom') {
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
        syncScrollMetrics();
        return;
      }

      if (scrollModeRef.current === 'pinned-bottom') {
        transcriptElement.scrollTop = Math.max(
          0,
          transcriptElement.scrollHeight - transcriptElement.clientHeight,
        );
      } else if (deltaScrollHeight > 0) {
        transcriptElement.scrollTop = Math.max(
          0,
          previousMetrics.scrollTop + deltaScrollHeight,
        );
        sharedTranscriptLog(
          'info',
          'DEV-0000049:T08:shared_transcript_scroll_anchor_preserved',
          {
            surface,
            conversationId: conversationId ?? null,
            deltaScrollHeight,
          },
        );
      }

      syncScrollMetrics();
    }, [conversationId, conversationKey, surface, syncScrollMetrics]);

    const handleSharedTranscriptScroll = useCallback<
      UIEventHandler<HTMLDivElement>
    >(
      (event) => {
        const nextMode = isNearBottom(event.currentTarget)
          ? 'pinned-bottom'
          : 'scrolled-away';
        setScrollMode(nextMode);
        syncScrollMetrics();
        onScroll?.(event);
      },
      [isNearBottom, onScroll, setScrollMode, syncScrollMetrics],
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
          if (!(entry.target instanceof HTMLElement)) {
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
        });
        reconcileScrollPosition();
      });

      observer.observe(transcriptElement);
      transcriptElement
        .querySelectorAll<HTMLElement>('[data-transcript-row-id]')
        .forEach((row) => observer.observe(row));

      return () => observer.disconnect();
    }, [conversationId, messages, reconcileScrollPosition, surface]);

    useEffect(() => {
      scrollModeRef.current = 'pinned-bottom';
      scrollMetricsRef.current = null;
    }, [conversationKey]);

    useLayoutEffect(() => {
      reconcileScrollPosition();
    }, [
      reconcileScrollPosition,
      messages,
      citationsOpen,
      thinkOpen,
      toolOpen,
      toolErrorOpen,
      turnsLoading,
      turnsError,
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
        renderMetadataContent,
        renderToolExtraContent,
        resolveStreamStatus,
        thinkOpen,
        toolErrorOpen,
        toolOpen,
        userMarkdownTestId,
      ],
    );

    return (
      <Box
        ref={setContainerRef}
        onScroll={handleSharedTranscriptScroll}
        data-testid={transcriptTestId}
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
            transcriptContainerRef={transcriptContainerRef}
            renderMessageRow={renderMessageRow}
          />
        </Stack>
      </Box>
    );
  },
);

export default SharedTranscript;
