import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { Box, Button, Stack, Tooltip, Typography } from '@mui/material';
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ChatMessage, ChatSegment } from '../../hooks/useChatStream';
import Markdown from '../Markdown';
import { buildSharedTranscriptCopyText } from './sharedTranscriptCopyText';
import { formatTranscriptTimestamp } from './transcriptSurfaceFormatting';
import { transcriptSurfaceTokens } from './transcriptSurfaceTokens';

type UserTranscriptBubbleProps = {
  message: ChatMessage;
  userMarkdownTestId?: string;
  log: (
    level: 'error' | 'warn' | 'info' | 'debug',
    message: string,
    context?: Record<string, unknown>,
  ) => void;
  markdownLogSource?: string;
  renderMetadataContent?: (message: ChatMessage) => ReactNode;
};

const isTextSegment = (
  segment: ChatSegment,
): segment is Extract<ChatSegment, { kind: 'text' }> => segment.kind === 'text';

function UserTranscriptBubble({
  message,
  userMarkdownTestId = 'user-markdown',
  log,
  markdownLogSource = 'SharedTranscript',
}: UserTranscriptBubbleProps) {
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<{
    severity: 'success' | 'error';
    message: string;
  } | null>(null);
  const segments: ChatSegment[] = useMemo(
    () =>
      message.segments?.length
        ? message.segments.filter(isTextSegment)
        : [
            {
              id: `${message.id}-text`,
              kind: 'text',
              content: message.content ?? '',
            },
          ],
    [message.content, message.id, message.segments],
  );
  const visibleCopyText = useMemo(
    () =>
      buildSharedTranscriptCopyText({
        content: message.content,
        segments,
      }),
    [message.content, segments],
  );
  const completionLabel = useMemo(
    () => formatTranscriptTimestamp(message.createdAt),
    [message.createdAt],
  );
  const acknowledged = message.optimistic !== true;

  useEffect(() => {
    if (!copyFeedback) {
      return;
    }

    const timeoutMs = copyFeedback.severity === 'success' ? 1800 : 3200;
    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopyFeedback(null);
    }, timeoutMs);

    return () => {
      if (copyFeedbackTimerRef.current != null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
        copyFeedbackTimerRef.current = null;
      }
    };
  }, [copyFeedback]);

  const handleCopy = async () => {
    if (!visibleCopyText) {
      setCopyFeedback({
        severity: 'error',
        message: 'Nothing visible to copy.',
      });
      log('warn', 'shared_transcript_copy_empty', {
        messageId: message.id,
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(visibleCopyText);
      setCopyFeedback({
        severity: 'success',
        message: 'Copied visible message content.',
      });
      log('info', 'shared_transcript_copy_succeeded', {
        messageId: message.id,
        visibleContentLength: visibleCopyText.length,
      });
    } catch (error) {
      setCopyFeedback({
        severity: 'error',
        message: 'Copy failed. Please try again.',
      });
      log('warn', 'shared_transcript_copy_failed', {
        messageId: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <Stack
      alignItems="flex-end"
      data-testid="chat-bubble"
      data-role={message.role}
      data-kind={message.kind ?? 'normal'}
      sx={{ width: '100%' }}
    >
      <Box
        data-testid="user-transcript-bubble"
        sx={{
          width: '100%',
          maxWidth: { xs: '92%', sm: '78%' },
          ml: 'auto',
          bgcolor: transcriptSurfaceTokens.user.background,
          color: transcriptSurfaceTokens.user.text,
          borderRadius: 3,
          px: 2,
          py: 1.75,
          boxShadow: 0,
        }}
      >
        <Box sx={{ color: transcriptSurfaceTokens.user.text }}>
          <Stack spacing={1}>
            {segments.map((segment) => {
              const userContent = segment.content ?? ' ';
              log(
                'info',
                'DEV-0000035:T10:chat_user_markdown_render_evaluated',
                {
                  messageId: message.id,
                  segmentId: segment.id,
                  role: message.role,
                  source: markdownLogSource,
                  contentLength: userContent.length,
                  hasMermaidFence: /```mermaid/i.test(userContent),
                },
              );

              return (
                <Markdown
                  key={segment.id}
                  content={userContent}
                  data-testid={userMarkdownTestId}
                />
              );
            })}
          </Stack>
        </Box>

        <Stack
          direction="row"
          spacing={1}
          justifyContent="flex-end"
          alignItems="center"
          flexWrap="wrap"
          sx={{ pt: 1.25, color: transcriptSurfaceTokens.user.secondaryText }}
        >
          <Stack direction="row" spacing={0.75} alignItems="center">
            <DoneAllIcon
              fontSize="small"
              data-testid="user-ack-tick"
              sx={{
                color: acknowledged
                  ? transcriptSurfaceTokens.user.confirmedTick
                  : transcriptSurfaceTokens.user.secondaryText,
              }}
            />
          </Stack>
          <Typography
            variant="caption"
            sx={{ color: transcriptSurfaceTokens.user.secondaryText }}
            data-testid="bubble-completion-time"
          >
            {completionLabel}
          </Typography>
          <Tooltip title="Copy visible message content">
            <Button
              size="small"
              variant="text"
              onClick={handleCopy}
              data-testid="bubble-copy"
              aria-label="Copy visible message content"
              disabled={!visibleCopyText}
              startIcon={<ContentCopyOutlinedIcon fontSize="small" />}
              sx={{
                color: transcriptSurfaceTokens.user.text,
                textTransform: 'none',
                minWidth: 0,
                px: 0.5,
              }}
            >
              Copy
            </Button>
          </Tooltip>
        </Stack>

        {copyFeedback && (
          <Typography
            variant="caption"
            color={
              copyFeedback.severity === 'error'
                ? 'error.light'
                : 'success.light'
            }
            data-testid="bubble-copy-feedback"
            sx={{ display: 'block', mt: 0.25, textAlign: 'right' }}
          >
            {copyFeedback.message}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

export default memo(UserTranscriptBubble);
