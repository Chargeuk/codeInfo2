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
