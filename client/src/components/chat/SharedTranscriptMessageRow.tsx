import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { memo } from 'react';
import type {
  ChatMessage,
  ToolCall,
  ToolCitation,
} from '../../hooks/useChatStream';
import Markdown from '../Markdown';
import SharedTranscriptToolDetails from './SharedTranscriptToolDetails';
import {
  buildStepLine,
  buildTimingLine,
  buildUsageLine,
  formatBubbleTimestamp,
} from './chatTranscriptFormatting';

type SharedTranscriptMessageRowProps = {
  message: ChatMessage;
  activeToolsAvailable: boolean;
  citationsEnabled?: boolean;
  isStopping: boolean;
  thinkOpen: Record<string, boolean>;
  toolOpen: Record<string, boolean>;
  toolErrorOpen: Record<string, boolean>;
  onToggleThink: (messageId: string) => void;
  onToggleTool: (toggleKey: string) => void;
  onToggleToolError: (toggleKey: string) => void;
  log: (
    level: 'error' | 'warn' | 'info' | 'debug',
    message: string,
    context?: Record<string, unknown>,
  ) => void;
  markdownLogSource?: string;
};

const accordionTransitionProps = { transition: { unmountOnExit: true } };

function SharedTranscriptMessageRow({
  message,
  activeToolsAvailable,
  citationsEnabled = true,
  isStopping,
  thinkOpen,
  toolOpen,
  toolErrorOpen,
  onToggleThink,
  onToggleTool,
  onToggleToolError,
  log,
  markdownLogSource = 'SharedTranscript',
}: SharedTranscriptMessageRowProps) {
  const alignSelf = message.role === 'user' ? 'flex-end' : 'flex-start';
  const isErrorBubble = message.kind === 'error';
  const isStatusBubble = message.kind === 'status';
  const isUser = message.role === 'user';
  const showMetadata = !isErrorBubble && !isStatusBubble;
  const timestampLabel = showMetadata
    ? formatBubbleTimestamp(message.createdAt)
    : null;
  const usageLine =
    message.role === 'assistant' ? buildUsageLine(message.usage) : null;
  const timingLine =
    message.role === 'assistant' ? buildTimingLine(message.timing) : null;
  const stepLine =
    message.role === 'assistant' ? buildStepLine(message.command) : null;
  const metadataColor = isUser ? 'inherit' : 'text.secondary';
  const hasCitations =
    citationsEnabled && activeToolsAvailable && !!message.citations?.length;
  const baseSegments = message.segments?.length
    ? message.segments
    : ([
        {
          id: `${message.id}-text`,
          kind: 'text' as const,
          content: message.content ?? '',
        },
        ...(activeToolsAvailable
          ? (message.tools?.map((tool) => ({
              id: `${message.id}-${tool.id}`,
              kind: 'tool' as const,
              tool,
            })) ?? [])
          : []),
      ] as const);
  const segments = activeToolsAvailable
    ? baseSegments
    : baseSegments.filter((segment) => segment.kind === 'text');

  return (
    <Stack alignItems={alignSelf === 'flex-end' ? 'flex-end' : 'flex-start'}>
      <Box
        sx={{
          maxWidth: { xs: '100%', sm: '80%' },
          alignSelf,
        }}
      >
        <Paper
          variant="outlined"
          data-testid="chat-bubble"
          data-role={message.role}
          data-kind={message.kind ?? 'normal'}
          sx={{
            p: 1.5,
            borderRadius: '14px',
            bgcolor: isErrorBubble
              ? 'error.light'
              : isStatusBubble
                ? 'info.light'
                : isUser
                  ? 'primary.main'
                  : 'background.paper',
            color: isErrorBubble
              ? 'error.contrastText'
              : isStatusBubble
                ? 'info.dark'
                : isUser
                  ? 'primary.contrastText'
                  : 'text.primary',
            borderColor: isErrorBubble
              ? 'error.main'
              : isStatusBubble
                ? 'info.main'
                : undefined,
          }}
        >
          <Stack spacing={1}>
            {showMetadata && timestampLabel && (
              <Stack spacing={0.25}>
                <Typography
                  variant="caption"
                  color={metadataColor}
                  data-testid="bubble-timestamp"
                >
                  {timestampLabel}
                </Typography>
                {usageLine && (
                  <Typography
                    variant="caption"
                    color={metadataColor}
                    data-testid="bubble-tokens"
                  >
                    {usageLine}
                  </Typography>
                )}
                {timingLine && (
                  <Typography
                    variant="caption"
                    color={metadataColor}
                    data-testid="bubble-timing"
                  >
                    {timingLine}
                  </Typography>
                )}
                {stepLine && (
                  <Typography
                    variant="caption"
                    color={metadataColor}
                    data-testid="bubble-step"
                  >
                    {stepLine}
                  </Typography>
                )}
              </Stack>
            )}
            {message.role === 'assistant' && message.streamStatus && (
              <Chip
                size="small"
                variant="outlined"
                color={
                  message.streamStatus === 'complete'
                    ? 'success'
                    : message.streamStatus === 'failed'
                      ? 'error'
                      : message.streamStatus === 'stopped'
                        ? 'warning'
                        : isStopping
                          ? 'warning'
                          : 'default'
                }
                icon={
                  message.streamStatus === 'complete' ? (
                    <CheckCircleOutlineIcon fontSize="small" />
                  ) : message.streamStatus === 'failed' ? (
                    <ErrorOutlineIcon fontSize="small" />
                  ) : message.streamStatus === 'stopped' ? (
                    <HourglassTopIcon fontSize="small" />
                  ) : (
                    <CircularProgress
                      size={14}
                      color={isStopping ? 'warning' : 'inherit'}
                    />
                  )
                }
                label={
                  message.streamStatus === 'complete'
                    ? 'Complete'
                    : message.streamStatus === 'failed'
                      ? 'Failed'
                      : message.streamStatus === 'stopped'
                        ? 'Stopped'
                        : isStopping
                          ? 'Stopping'
                          : 'Processing'
                }
                data-testid="status-chip"
                sx={{ alignSelf: 'flex-start' }}
              />
            )}
            {message.role === 'assistant' &&
              message.warnings &&
              message.warnings.length > 0 && (
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
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
              )}
            {segments.map((segment) => {
              if (segment.kind === 'text') {
                if (message.role === 'assistant') {
                  return (
                    <Markdown
                      key={segment.id}
                      content={segment.content ?? ''}
                      data-testid="assistant-markdown"
                    />
                  );
                }

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
                    data-testid="user-markdown"
                  />
                );
              }

              const tool = segment.tool as ToolCall;
              const isRequesting = tool.status === 'requesting';
              const isError = tool.status === 'error';
              const toggleKey = `${message.id}-${tool.id}`;
              const isOpen = !!toolOpen[toggleKey];
              const statusLabel =
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
                      color="text.primary"
                      sx={{ flex: 1 }}
                      data-testid="tool-name"
                    >
                      {(tool.name ?? 'Tool') + ' · ' + statusLabel}
                    </Typography>
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => onToggleTool(toggleKey)}
                      disabled={isRequesting}
                      data-testid="tool-toggle"
                      aria-expanded={isOpen}
                      aria-controls={`tool-${toggleKey}-details`}
                      sx={{
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
                      onToggleToolError={onToggleToolError}
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
                <Typography variant="body2" color="text.secondary">
                  Thinking…
                </Typography>
              </Stack>
            )}
          </Stack>
          {hasCitations && (
            <Accordion
              disableGutters
              elevation={0}
              defaultExpanded={false}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                bgcolor: 'grey.50',
                mt: 1,
              }}
              data-testid="citations-accordion"
              slotProps={accordionTransitionProps}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreIcon fontSize="small" />}
                aria-controls="citations-panel"
                id="citations-summary"
                data-testid="citations-toggle"
              >
                <Typography variant="body2" fontWeight={600}>
                  Citations ({message.citations?.length ?? 0})
                </Typography>
              </AccordionSummary>
              <AccordionDetails id="citations-panel">
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
              </AccordionDetails>
            </Accordion>
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
                <Typography variant="caption" color="text.secondary">
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
                <Box mt={0.5} color="text.secondary">
                  <Markdown
                    content={message.think ?? ''}
                    data-testid="think-content"
                  />
                </Box>
              </Collapse>
            </Box>
          )}
        </Paper>
      </Box>
    </Stack>
  );
}

export default memo(SharedTranscriptMessageRow);
