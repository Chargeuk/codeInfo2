import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { Box, Button, Stack, Tooltip, Typography } from '@mui/material';
import {
  useCallback,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ChatMessage, ChatSegment } from '../../hooks/useChatStream';
import { copyTextToClipboard } from '../../utils/copyTextToClipboard';
import Markdown from '../Markdown';
import { buildSharedTranscriptCopyText } from './sharedTranscriptCopyText';
import { formatTranscriptTimestamp } from './transcriptSurfaceFormatting';
import { transcriptSurfaceTokens } from './transcriptSurfaceTokens';
import { useRelativeTimeTick } from './useRelativeTimeTick';

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
  const bubbleSurfaceRef = useRef<HTMLDivElement | null>(null);
  const textContentRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<{
    severity: 'success' | 'error';
    message: string;
  } | null>(null);
  const [footerLayoutMode, setFooterLayoutMode] = useState<
    'stacked' | 'inline'
  >('stacked');
  const segments = useMemo<Extract<ChatSegment, { kind: 'text' }>[]>(
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
  const relativeTimeNowMs = useRelativeTimeTick();
  const completionLabel = useMemo(
    () =>
      formatTranscriptTimestamp(message.createdAt, {
        compact: footerLayoutMode === 'inline',
        nowMs: relativeTimeNowMs,
      }),
    [footerLayoutMode, message.createdAt, relativeTimeNowMs],
  );
  const acknowledged = message.optimistic !== true;
  const layoutContentKey = useMemo(
    () =>
      JSON.stringify({
        id: message.id,
        content: message.content ?? '',
        segments: segments.map((segment) => ({
          id: segment.id,
          content: segment.content ?? '',
        })),
      }),
    [message.content, message.id, segments],
  );

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

  const measureFooterLayout = useCallback(() => {
    const bubbleSurface = bubbleSurfaceRef.current;
    const textContent = textContentRef.current;
    const footer = footerRef.current;
    if (!bubbleSurface || !textContent || !footer) {
      return;
    }

    const contentStyle = window.getComputedStyle(textContent);
    const bubbleStyle = window.getComputedStyle(bubbleSurface);
    const fontSize = Number.parseFloat(contentStyle.fontSize) || 16;
    const parsedLineHeight = Number.parseFloat(contentStyle.lineHeight);
    const lineHeight = Number.isFinite(parsedLineHeight)
      ? parsedLineHeight
      : fontSize * 1.5;
    const singleLineThreshold = lineHeight * 1.5;
    const textHeight = textContent.getBoundingClientRect().height;
    const bubbleRect = bubbleSurface.getBoundingClientRect();
    const parentWidth =
      bubbleSurface.parentElement?.getBoundingClientRect().width ??
      bubbleRect.width;
    const paddingLeft = Number.parseFloat(bubbleStyle.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(bubbleStyle.paddingRight) || 0;
    const rawMaxWidth = bubbleStyle.maxWidth.trim();
    const computedMaxWidth =
      rawMaxWidth.endsWith('%') || rawMaxWidth === 'none'
        ? Number.NaN
        : Number.parseFloat(rawMaxWidth);
    const configuredMaxWidth =
      parentWidth * (window.innerWidth < 600 ? 0.92 : 0.78);
    const maxAllowedWidth = Number.isFinite(computedMaxWidth)
      ? computedMaxWidth
      : configuredMaxWidth;
    const maxInlineContentWidth = maxAllowedWidth - paddingLeft - paddingRight;
    const inlineGapPx = window.innerWidth < 600 ? 6 : 8;
    const textWidth = textContent.scrollWidth;
    const footerWidth = footer.scrollWidth;
    const shouldInline =
      textHeight <= singleLineThreshold &&
      textWidth + inlineGapPx + footerWidth <= maxInlineContentWidth + 1;

    setFooterLayoutMode((current) =>
      current === (shouldInline ? 'inline' : 'stacked')
        ? current
        : shouldInline
          ? 'inline'
          : 'stacked',
    );
  }, []);

  useLayoutEffect(() => {
    measureFooterLayout();
  }, [layoutContentKey, measureFooterLayout]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      measureFooterLayout();
    });

    if (bubbleSurfaceRef.current) {
      observer.observe(bubbleSurfaceRef.current);
    }
    if (textContentRef.current) {
      observer.observe(textContentRef.current);
    }
    if (footerRef.current) {
      observer.observe(footerRef.current);
    }

    return () => observer.disconnect();
  }, [measureFooterLayout]);

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
      await copyTextToClipboard(visibleCopyText);
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

  const textContent = (
    <Box
      ref={textContentRef}
      data-testid="user-transcript-content"
      sx={{
        minWidth: 0,
        flex: footerLayoutMode === 'inline' ? '1 1 auto' : '0 1 auto',
        '& > :first-of-type': { mt: 0 },
        '& > :last-child': { mb: 0 },
      }}
    >
      <Box
        sx={{
          color: transcriptSurfaceTokens.user.text,
          fontSize: { xs: '0.92rem', sm: '1rem' },
          lineHeight: 1.5,
        }}
      >
        <Stack spacing={1}>
          {segments.map((segment) => {
            const userContent = segment.content ?? ' ';
            log('info', 'DEV-0000035:T10:chat_user_markdown_render_evaluated', {
              messageId: message.id,
              segmentId: segment.id,
              role: message.role,
              source: markdownLogSource,
              contentLength: userContent.length,
              hasMermaidFence: /```mermaid/i.test(userContent),
            });

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
    </Box>
  );

  const footerContent = (
    <Stack
      ref={footerRef}
      direction="row"
      spacing={{ xs: 0.5, sm: 1 }}
      justifyContent="flex-end"
      alignItems="center"
      flexWrap="nowrap"
      sx={{
        pt: footerLayoutMode === 'inline' ? 0 : { xs: 0.75, sm: 1.25 },
        pl: footerLayoutMode === 'inline' ? { xs: 1, sm: 1.25 } : 0,
        color: transcriptSurfaceTokens.user.secondaryText,
        flexShrink: 0,
        alignSelf: footerLayoutMode === 'inline' ? 'flex-end' : 'stretch',
      }}
      data-testid="user-transcript-footer"
    >
      <Stack direction="row" spacing={0.75} alignItems="center">
        <DoneAllIcon
          fontSize="small"
          data-testid="user-ack-tick"
          sx={{
            color: acknowledged
              ? transcriptSurfaceTokens.user.confirmedTick
              : transcriptSurfaceTokens.user.secondaryText,
            fontSize: { xs: 14, sm: 16 },
          }}
        />
      </Stack>
      <Typography
        variant="caption"
        sx={{
          color: transcriptSurfaceTokens.user.secondaryText,
          fontSize: { xs: '0.62rem', sm: '0.7rem' },
          lineHeight: 1.15,
          whiteSpace: 'nowrap',
        }}
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
            px: { xs: 0.125, sm: 0.375 },
            py: 0,
            minHeight: { xs: 22, sm: 26 },
            fontSize: { xs: '0.64rem', sm: '0.72rem' },
            '& .MuiButton-startIcon': {
              mr: { xs: 0, sm: 0.375 },
            },
          }}
        >
          <Box
            component="span"
            data-testid="user-bubble-copy-label"
            sx={{ display: { xs: 'none', sm: 'inline' } }}
          >
            Copy
          </Box>
        </Button>
      </Tooltip>
    </Stack>
  );

  return (
    <Stack
      alignItems="flex-end"
      data-testid="chat-bubble"
      data-role={message.role}
      data-kind={message.kind ?? 'normal'}
      sx={{ width: '100%' }}
    >
      <Box
        ref={bubbleSurfaceRef}
        data-testid="user-transcript-bubble"
        data-footer-layout={footerLayoutMode}
        sx={{
          width: 'fit-content',
          maxWidth: { xs: '92%', sm: '78%' },
          ml: 'auto',
          bgcolor: transcriptSurfaceTokens.user.background,
          color: transcriptSurfaceTokens.user.text,
          borderRadius: 3,
          px: { xs: 1.5, sm: 1.75 },
          py: { xs: 0.875, sm: 1.125 },
          boxShadow: 0,
        }}
      >
        {footerLayoutMode === 'inline' ? (
          <Stack
            direction="row"
            alignItems="flex-end"
            justifyContent="space-between"
            spacing={{ xs: 0.5, sm: 0.75 }}
            sx={{ minWidth: 0 }}
          >
            {textContent}
            {footerContent}
          </Stack>
        ) : (
          <>
            {textContent}
            {footerContent}
          </>
        )}

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
