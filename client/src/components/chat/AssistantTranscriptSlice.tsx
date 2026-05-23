import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  ChatMessage,
  ChatSegment,
  ToolCall,
  ToolCitation,
} from '../../hooks/useChatStream';
import Markdown from '../Markdown';
import SharedTranscriptToolDetails from './SharedTranscriptToolDetails';
import {
  buildTimingLine,
  buildStepLine,
  buildUsageLine,
} from './chatTranscriptFormatting';
import { buildSharedTranscriptCopyText } from './sharedTranscriptCopyText';
import {
  buildTranscriptInfoRows,
  formatTranscriptResponseTime,
  formatTranscriptTimestamp,
  getTranscriptStatusKey,
  getTranscriptStatusLabel,
} from './transcriptSurfaceFormatting';
import { transcriptSurfaceTokens } from './transcriptSurfaceTokens';

type AssistantTranscriptSliceProps = {
  message: ChatMessage;
  activeToolsAvailable: boolean;
  citationsEnabled?: boolean;
  isStopping: boolean;
  visibleStreamStatus?: ChatMessage['streamStatus'];
  citationsOpen: Record<string, boolean>;
  thinkOpen: Record<string, boolean>;
  toolOpen: Record<string, boolean>;
  toolErrorOpen: Record<string, boolean>;
  onToggleCitation: (messageId: string) => void;
  onToggleThink: (messageId: string) => void;
  onToggleTool: (toggleKey: string, messageId: string) => void;
  onToggleToolError: (toggleKey: string, messageId: string) => void;
  renderToolExtraContent?: (
    tool: ToolCall,
    toggleKey: string,
    message: ChatMessage,
  ) => ReactNode;
  renderMetadataContent?: (message: ChatMessage) => ReactNode;
  log: (
    level: 'error' | 'warn' | 'info' | 'debug',
    message: string,
    context?: Record<string, unknown>,
  ) => void;
  markdownLogSource?: string;
};

function AssistantTranscriptSlice({
  message,
  activeToolsAvailable,
  citationsEnabled = true,
  visibleStreamStatus,
  citationsOpen,
  thinkOpen,
  toolOpen,
  toolErrorOpen,
  onToggleCitation,
  onToggleThink,
  onToggleTool,
  onToggleToolError,
  renderToolExtraContent,
  renderMetadataContent,
  log,
}: AssistantTranscriptSliceProps) {
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const [infoAnchorEl, setInfoAnchorEl] = useState<HTMLButtonElement | null>(
    null,
  );
  const [copyFeedback, setCopyFeedback] = useState<{
    severity: 'success' | 'error';
    message: string;
  } | null>(null);
  const segments: ChatSegment[] = useMemo(() => {
    const baseSegments: ChatSegment[] = message.segments?.length
      ? [...message.segments]
      : [
          {
            id: `${message.id}-text`,
            kind: 'text',
            content: message.content ?? '',
          },
          ...(activeToolsAvailable
            ? (message.tools?.map(
                (tool): ChatSegment => ({
                  id: `${message.id}-${tool.id}`,
                  kind: 'tool',
                  tool,
                }),
              ) ?? [])
            : []),
        ];
    return activeToolsAvailable
      ? baseSegments
      : baseSegments.filter((segment) => segment.kind === 'text');
  }, [activeToolsAvailable, message]);
  const infoRows = useMemo(() => buildTranscriptInfoRows(message), [message]);
  const usageSummary = useMemo(
    () => buildUsageLine(message.usage),
    [message.usage],
  );
  const timingSummary = useMemo(
    () => buildTimingLine(message.timing),
    [message.timing],
  );
  const stepSummary = useMemo(
    () => buildStepLine(message.command),
    [message.command],
  );
  const responseTimeLabel = useMemo(
    () => formatTranscriptResponseTime(message.timing),
    [message.timing],
  );
  const completionLabel = useMemo(
    () => formatTranscriptTimestamp(message.createdAt),
    [message.createdAt],
  );
  const status = visibleStreamStatus ?? message.streamStatus;
  const statusLabel = getTranscriptStatusLabel(status);
  const statusKey = getTranscriptStatusKey(status);
  const visibleCopyText = useMemo(
    () =>
      buildSharedTranscriptCopyText({
        content: message.content,
        segments,
      }),
    [message.content, segments],
  );
  const hasCitations =
    citationsEnabled && activeToolsAvailable && !!message.citations?.length;
  const metadataContent = renderMetadataContent?.(message) ?? null;
  const metadataPopoverOpen = Boolean(infoAnchorEl);

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
      alignItems="stretch"
      data-testid="chat-bubble"
      data-role={message.role}
      data-kind={message.kind ?? 'normal'}
      sx={{ width: '100%' }}
    >
      <Box
        data-testid="assistant-transcript-slice"
        sx={{
          width: '100%',
          bgcolor: transcriptSurfaceTokens.assistant.background,
          color: transcriptSurfaceTokens.assistant.text,
          borderRadius: 0,
          px: { xs: 1.75, sm: 2.5 },
          py: { xs: 1.5, sm: 2 },
        }}
      >
        <Box
          sx={{
            color: transcriptSurfaceTokens.assistant.text,
            fontSize: { xs: '0.95rem', sm: '1rem' },
            lineHeight: 1.55,
          }}
        >
          <Stack spacing={1}>
            {segments.map((segment) => {
              if (segment.kind === 'text') {
                return (
                  <Markdown
                    key={segment.id}
                    content={segment.content ?? ''}
                    data-testid="assistant-markdown"
                  />
                );
              }

              const tool = segment.tool as ToolCall;
              const isRequesting = tool.status === 'requesting';
              const isError = tool.status === 'error';
              const toggleKey = `${message.id}-${tool.id}`;
              const isOpen = !!toolOpen[toggleKey];
              const statusLabelForTool =
                tool.status === 'error'
                  ? 'Failed'
                  : tool.status === 'done'
                    ? 'Success'
                    : 'Running';

              return (
                <Box key={segment.id} data-testid="tool-row">
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{ mb: isRequesting ? 0 : 0.25 }}
                    data-testid="tool-call-summary"
                  >
                    {isRequesting ? (
                      <HourglassTopIcon
                        fontSize="small"
                        color="action"
                        data-testid="tool-spinner"
                      />
                    ) : isError ? (
                      <ErrorOutlineIcon
                        fontSize="small"
                        color="error"
                        aria-label="Tool failed"
                      />
                    ) : (
                      <CheckCircleOutlineIcon
                        fontSize="small"
                        color="success"
                        aria-label="Tool succeeded"
                      />
                    )}
                    <Typography
                      variant="caption"
                      color="inherit"
                      sx={{ flex: 1 }}
                      data-testid="tool-name"
                    >
                      {(tool.name ?? 'Tool') + ' · ' + statusLabelForTool}
                    </Typography>
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => onToggleTool(toggleKey, message.id)}
                      disabled={isRequesting}
                      data-testid="tool-toggle"
                      aria-expanded={isOpen}
                      aria-controls={`tool-${toggleKey}-details`}
                      sx={{
                        color: transcriptSurfaceTokens.assistant.action,
                        textTransform: 'none',
                        minWidth: 0,
                        p: 0,
                      }}
                    >
                      {isOpen ? 'Hide details' : 'Show details'}
                    </Button>
                  </Stack>
                  <Collapse
                    in={isOpen}
                    timeout="auto"
                    unmountOnExit
                    id={`tool-${toggleKey}-details`}
                  >
                    <SharedTranscriptToolDetails
                      tool={tool}
                      toggleKey={toggleKey}
                      isToolErrorOpen={!!toolErrorOpen[toggleKey]}
                      onToggleToolError={(id) =>
                        onToggleToolError(id, message.id)
                      }
                      extraContent={renderToolExtraContent?.(
                        tool,
                        toggleKey,
                        message,
                      )}
                    />
                  </Collapse>
                </Box>
              );
            })}
            {message.role === 'assistant' && message.thinking && (
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                data-testid="thinking-placeholder"
              >
                <CircularProgress size={16} />
                <Typography variant="body2" color="inherit">
                  Thinking…
                </Typography>
              </Stack>
            )}
            {hasCitations && (
              <>
                <Button
                  size="small"
                  variant="text"
                  onClick={() => onToggleCitation(message.id)}
                  data-testid="citations-toggle"
                  aria-expanded={!!citationsOpen[message.id]}
                  aria-controls={`citations-panel-${message.id}`}
                  sx={{
                    color: transcriptSurfaceTokens.assistant.action,
                    textTransform: 'none',
                    minWidth: 0,
                    p: 0,
                    justifyContent: 'flex-start',
                    width: 'fit-content',
                  }}
                >
                  Citations ({message.citations?.length ?? 0})
                </Button>
                <Collapse
                  in={!!citationsOpen[message.id]}
                  timeout="auto"
                  unmountOnExit
                >
                  <Stack spacing={1} data-testid="citations">
                    {message.citations?.map((citation: ToolCitation, idx) => {
                      const pathLabel = `${citation.repo}/${citation.relPath}`;
                      const hostSuffix = citation.hostPath
                        ? ` (${citation.hostPath})`
                        : '';
                      return (
                        <Box
                          key={`${citation.chunkId ?? idx}-${citation.relPath}`}
                          sx={{
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            p: 1,
                            bgcolor: 'background.paper',
                          }}
                        >
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            title={citation.hostPath ?? pathLabel}
                            sx={{
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: '100%',
                            }}
                            data-testid="citation-path"
                          >
                            {pathLabel}
                            {hostSuffix}
                          </Typography>
                          <Typography
                            variant="body2"
                            color="text.primary"
                            style={{
                              overflowWrap: 'anywhere',
                              wordBreak: 'break-word',
                            }}
                            sx={{
                              whiteSpace: 'pre-wrap',
                              overflowWrap: 'anywhere',
                              wordBreak: 'break-word',
                            }}
                            data-testid="citation-chunk"
                          >
                            {citation.chunk}
                          </Typography>
                        </Box>
                      );
                    })}
                  </Stack>
                </Collapse>
              </>
            )}
            {(message.thinkStreaming || message.think) && (
              <Box mt={1}>
                <Stack direction="row" alignItems="center" gap={0.5}>
                  {message.thinkStreaming && (
                    <CircularProgress
                      size={12}
                      color="inherit"
                      data-testid="think-spinner"
                    />
                  )}
                  <Typography variant="caption" color="inherit">
                    Thought process
                  </Typography>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => onToggleThink(message.id)}
                    data-testid="think-toggle"
                    aria-label="Toggle thought process"
                    aria-expanded={!!thinkOpen[message.id]}
                    sx={{
                      color: transcriptSurfaceTokens.assistant.action,
                      textTransform: 'none',
                      minWidth: 0,
                      p: 0,
                    }}
                  >
                    {thinkOpen[message.id] ? 'Hide' : 'Show'}
                  </Button>
                </Stack>
                <Collapse
                  in={!!thinkOpen[message.id]}
                  timeout="auto"
                  unmountOnExit
                >
                  <Box mt={0.5} color="inherit">
                    <Markdown
                      content={message.think ?? ''}
                      data-testid="think-content"
                    />
                  </Box>
                </Collapse>
              </Box>
            )}
          </Stack>

          <Stack
            direction="row"
            spacing={1}
            justifyContent="space-between"
            alignItems="center"
            flexWrap="nowrap"
            sx={{
              gap: { xs: 0.75, sm: 1.25 },
              pt: { xs: 0.875, sm: 1.5 },
              color: transcriptSurfaceTokens.assistant.secondaryText,
            }}
            data-testid="assistant-transcript-footer"
          >
            <Stack
              direction="row"
              spacing={{ xs: 0.5, sm: 1 }}
              alignItems="center"
              flexWrap="nowrap"
              sx={{ minWidth: 0, flex: 1 }}
            >
              <Tooltip title="Show message details">
                <Button
                  size="small"
                  variant="text"
                  onClick={(event) =>
                    setInfoAnchorEl((current) =>
                      current ? null : event.currentTarget,
                    )
                  }
                  data-testid="bubble-info"
                  aria-haspopup="dialog"
                  aria-expanded={metadataPopoverOpen}
                  aria-controls={
                    metadataPopoverOpen
                      ? `bubble-info-popover-${message.id}`
                      : undefined
                  }
                  startIcon={<InfoOutlinedIcon fontSize="small" />}
                  sx={{
                    color: transcriptSurfaceTokens.assistant.action,
                    textTransform: 'none',
                    minWidth: 0,
                    px: { xs: 0.25, sm: 0.5 },
                    py: 0,
                    minHeight: { xs: 24, sm: 30 },
                    fontSize: { xs: '0.68rem', sm: '0.75rem' },
                    '& .MuiButton-startIcon': {
                      mr: { xs: 0, sm: 0.5 },
                    },
                  }}
                >
                  <Box
                    component="span"
                    data-testid="bubble-info-label"
                    sx={{ display: { xs: 'none', sm: 'inline' } }}
                  >
                    Info
                  </Box>
                </Button>
              </Tooltip>
              {responseTimeLabel && (
                <Typography
                  variant="caption"
                  data-testid="bubble-response-time"
                  sx={{
                    color: transcriptSurfaceTokens.assistant.secondaryText,
                    fontSize: { xs: '0.66rem', sm: '0.75rem' },
                    lineHeight: 1.15,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {responseTimeLabel}
                </Typography>
              )}
              <Chip
                size="small"
                variant="filled"
                label={statusLabel}
                icon={
                  statusKey === 'complete' ? (
                    <CheckCircleOutlineIcon fontSize="small" />
                  ) : statusKey === 'failed' ? (
                    <ErrorOutlineIcon fontSize="small" />
                  ) : statusKey === 'stopped' ? (
                    <HourglassTopIcon fontSize="small" />
                  ) : (
                    <CircularProgress size={14} color="inherit" />
                  )
                }
                data-testid="status-chip"
                sx={{
                  bgcolor:
                    transcriptSurfaceTokens.statusChip[statusKey].background,
                  color: transcriptSurfaceTokens.statusChip[statusKey].text,
                  fontWeight: 500,
                  border: 0,
                  height: { xs: 22, sm: 24 },
                  '& .MuiChip-label': {
                    px: { xs: 0.75, sm: 1 },
                    fontSize: { xs: '0.66rem', sm: '0.75rem' },
                  },
                  '& .MuiChip-icon': {
                    color: transcriptSurfaceTokens.statusChip[statusKey].text,
                    ml: { xs: 0.5, sm: 0.75 },
                    mr: { xs: -0.25, sm: 0 },
                    '&.MuiCircularProgress-root': {
                      width: { xs: 12, sm: 14 },
                      height: { xs: 12, sm: 14 },
                    },
                  },
                }}
              />
            </Stack>
            <Stack
              direction="row"
              spacing={{ xs: 0.5, sm: 1 }}
              alignItems="center"
              justifyContent="flex-end"
              flexWrap="nowrap"
              sx={{ minWidth: 0 }}
            >
              <Typography
                variant="caption"
                sx={{
                  color: transcriptSurfaceTokens.assistant.secondaryText,
                  fontSize: { xs: '0.66rem', sm: '0.75rem' },
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
                    color: transcriptSurfaceTokens.assistant.action,
                    textTransform: 'none',
                    minWidth: 0,
                    px: { xs: 0.25, sm: 0.5 },
                    py: 0,
                    minHeight: { xs: 24, sm: 30 },
                    fontSize: { xs: '0.68rem', sm: '0.75rem' },
                    '& .MuiButton-startIcon': {
                      mr: { xs: 0, sm: 0.5 },
                    },
                  }}
                >
                  <Box
                    component="span"
                    data-testid="bubble-copy-label"
                    sx={{ display: { xs: 'none', sm: 'inline' } }}
                  >
                    Copy
                  </Box>
                </Button>
              </Tooltip>
            </Stack>
          </Stack>
          {copyFeedback && (
            <Typography
              variant="caption"
              color={
                copyFeedback.severity === 'error'
                  ? 'error.main'
                  : 'success.main'
              }
              data-testid="bubble-copy-feedback"
              sx={{ display: 'block', mt: 0.25, textAlign: 'right' }}
            >
              {copyFeedback.message}
            </Typography>
          )}
        </Box>
        <Popover
          id={`bubble-info-popover-${message.id}`}
          open={metadataPopoverOpen}
          anchorEl={infoAnchorEl}
          onClose={() => setInfoAnchorEl(null)}
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'left',
          }}
          transformOrigin={{
            vertical: 'top',
            horizontal: 'left',
          }}
          slotProps={{
            paper: {
              sx: {
                mt: 1,
                p: 1.5,
                maxWidth: 420,
                overflow: 'visible',
                position: 'relative',
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  top: -7,
                  left: 14,
                  width: 14,
                  height: 14,
                  bgcolor: 'background.paper',
                  borderLeft: '1px solid',
                  borderTop: '1px solid',
                  borderColor: 'divider',
                  transform: 'rotate(45deg)',
                },
              },
            },
          }}
        >
          <Stack spacing={1} data-testid="bubble-info-popover">
            <Stack spacing={0.25}>
              <Typography
                variant="caption"
                color="text.secondary"
                data-testid="bubble-info-time"
              >
                Time: {completionLabel}
              </Typography>
              {infoRows.map((entry) => (
                <Typography
                  key={entry.label}
                  variant="caption"
                  color="text.secondary"
                  data-testid={`bubble-info-${entry.label
                    .toLowerCase()
                    .replace(/\s+/g, '-')}`}
                >
                  {entry.label}: {entry.value}
                </Typography>
              ))}
            </Stack>
            {(usageSummary || timingSummary) && (
              <Stack spacing={0.25}>
                {usageSummary && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    data-testid="bubble-info-usage"
                  >
                    Usage: {usageSummary}
                  </Typography>
                )}
                {timingSummary && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    data-testid="bubble-info-timing"
                  >
                    Timing: {timingSummary}
                  </Typography>
                )}
              </Stack>
            )}
            {stepSummary && (
              <Typography
                variant="caption"
                color="text.secondary"
                data-testid="bubble-info-step"
              >
                Step: {stepSummary}
              </Typography>
            )}
            {message.warnings && message.warnings.length > 0 && (
              <Stack spacing={0.5}>
                <Typography variant="caption" color="text.secondary">
                  Warnings
                </Typography>
                <Stack direction="row" spacing={0.5} flexWrap="wrap">
                  {message.warnings.map((warning) => (
                    <Chip
                      key={`${message.id}-warning-${warning}`}
                      size="small"
                      variant="outlined"
                      color="warning"
                      icon={<WarningAmberIcon fontSize="small" />}
                      label={warning}
                      data-testid="warning-chip"
                      sx={{ alignSelf: 'flex-start' }}
                    />
                  ))}
                </Stack>
              </Stack>
            )}
            {metadataContent && <Box>{metadataContent}</Box>}
          </Stack>
        </Popover>
      </Box>
    </Stack>
  );
}

export default memo(AssistantTranscriptSlice);
