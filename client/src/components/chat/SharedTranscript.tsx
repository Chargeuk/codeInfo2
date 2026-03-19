import { Alert, Box, Stack, Typography } from '@mui/material';
import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type UIEventHandler,
} from 'react';
import type { ChatMessage, ToolCall } from '../../hooks/useChatStream';
import { createLogger } from '../../logging/logger';
import SharedTranscriptMessageRow from './SharedTranscriptMessageRow';

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
  thinkOpen: Record<string, boolean>;
  toolOpen: Record<string, boolean>;
  toolErrorOpen: Record<string, boolean>;
  onToggleThink: (messageId: string) => void;
  onToggleTool: (toggleKey: string) => void;
  onToggleToolError: (toggleKey: string) => void;
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
      thinkOpen,
      toolOpen,
      toolErrorOpen,
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
    const lastRenderStateRef = useRef<string | null>(null);
    const measurementReadyRef = useRef<string | null>(null);
    const missingRowLoggedRef = useRef(new Set<string>());
    const hasWarningState = turnsError;
    const hasEmptyState = messages.length === 0;
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
      const transcriptElement = ref && 'current' in ref ? ref.current : null;
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
      });

      observer.observe(transcriptElement);
      transcriptElement
        .querySelectorAll<HTMLElement>('[data-transcript-row-id]')
        .forEach((row) => observer.observe(row));

      return () => observer.disconnect();
    }, [conversationId, messages, ref, surface]);

    return (
      <Box
        ref={ref}
        onScroll={onScroll}
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
          {messages.map((message) => (
            <SharedTranscriptMessageRow
              key={message.id}
              message={message}
              activeToolsAvailable={activeToolsAvailable}
              citationsEnabled={citationsEnabled}
              isStopping={isStopping}
              thinkOpen={thinkOpen}
              toolOpen={toolOpen}
              toolErrorOpen={toolErrorOpen}
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
          ))}
        </Stack>
      </Box>
    );
  },
);

export default SharedTranscript;
