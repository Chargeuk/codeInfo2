import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { memo, useEffect, useMemo, useRef, type UIEventHandler } from 'react';
import type { ChatMessage, ToolCall } from '../../hooks/useChatStream';
import { createLogger } from '../../logging/logger';
import Markdown from '../Markdown';
import SharedTranscriptToolDetails from '../chat/SharedTranscriptToolDetails';
import {
  buildStepLine,
  buildTimingLine,
  buildUsageLine,
  formatBubbleTimestamp,
} from '../chat/chatTranscriptFormatting';

type LiveStoppedMarker = {
  conversationId: string;
  inflightId: string;
  turnId: string;
  runKind: 'instruction' | 'command';
} | null;

type AgentsTranscriptPaneProps = {
  conversationId?: string;
  transcriptRef?: React.Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  displayMessages: ChatMessage[];
  turnsLoading: boolean;
  turnsError: boolean;
  turnsErrorMessage?: string | null;
  thinkOpen: Record<string, boolean>;
  toolOpen: Record<string, boolean>;
  toolErrorOpen: Record<string, boolean>;
  activeToolsAvailable: boolean;
  latestAssistantMessageId: string | null;
  liveStoppedMarker: LiveStoppedMarker;
  isStopping: boolean;
  onToggleThink: (messageId: string) => void;
  onToggleTool: (toggleKey: string) => void;
  onToggleToolError: (toggleKey: string) => void;
};

const agentsTranscriptLog = createLogger('client');

function renderResultAccordion(payload: unknown, accordionId: string) {
  return (
    <Accordion
      defaultExpanded={false}
      disableGutters
      data-testid="tool-result-accordion"
      id={`result-${accordionId}`}
      slotProps={{ transition: { unmountOnExit: true } }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon fontSize="small" />}
        aria-controls={`result-${accordionId}-content`}
      >
        <Typography variant="body2" fontWeight={600}>
          Result
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Box
          component="pre"
          sx={{
            bgcolor: 'grey.100',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            p: 1,
            overflowX: 'auto',
            fontSize: '0.8rem',
            lineHeight: 1.4,
          }}
        >
          {JSON.stringify(payload ?? {}, null, 2)}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

function renderToolContent(
  tool: ToolCall,
  toggleKey: string,
  isToolErrorOpen: boolean,
  onToggleToolError: (toggleKey: string) => void,
) {
  return (
    <SharedTranscriptToolDetails
      tool={tool}
      toggleKey={toggleKey}
      isToolErrorOpen={isToolErrorOpen}
      onToggleToolError={onToggleToolError}
      extraContent={renderResultAccordion(tool.payload, toggleKey)}
    />
  );
}

const AgentsTranscriptPane = memo(function AgentsTranscriptPane({
  conversationId,
  transcriptRef,
  onScroll,
  displayMessages,
  turnsLoading,
  turnsError,
  turnsErrorMessage,
  thinkOpen,
  toolOpen,
  toolErrorOpen,
  activeToolsAvailable,
  latestAssistantMessageId,
  liveStoppedMarker,
  isStopping,
  onToggleThink,
  onToggleTool,
  onToggleToolError,
}: AgentsTranscriptPaneProps) {
  const lastRenderStateRef = useRef<string | null>(null);
  const renderStateKey = useMemo(
    () =>
      JSON.stringify({
        conversationId: conversationId ?? null,
        messageIds: displayMessages.map((message) => message.id),
        streamStatuses: displayMessages.map((message) => message.streamStatus),
        turnsLoading,
        turnsError,
        turnsErrorMessage: turnsErrorMessage ?? null,
        latestAssistantMessageId,
        liveStoppedTurnId: liveStoppedMarker?.turnId ?? null,
      }),
    [
      conversationId,
      displayMessages,
      turnsLoading,
      turnsError,
      turnsErrorMessage,
      latestAssistantMessageId,
      liveStoppedMarker,
    ],
  );

  useEffect(() => {
    if (lastRenderStateRef.current === renderStateKey) {
      return;
    }
    lastRenderStateRef.current = renderStateKey;
    agentsTranscriptLog(
      'info',
      'DEV-0000049:T02:agents_transcript_pane_rendered',
      {
        conversationId: conversationId ?? null,
        messageCount: displayMessages.length,
      },
    );
  }, [conversationId, displayMessages.length, renderStateKey]);

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        flex: '1 1 0%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box
        ref={transcriptRef}
        onScroll={onScroll}
        data-testid="chat-transcript"
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
          {turnsLoading ? (
            <Typography
              color="text.secondary"
              variant="caption"
              sx={{ px: 0.5 }}
            >
              Loading history...
            </Typography>
          ) : null}
          {turnsError ? (
            <Alert severity="warning" data-testid="agent-turns-error">
              {turnsErrorMessage ?? 'Failed to load conversation history.'}
            </Alert>
          ) : null}
          {displayMessages.length === 0 ? (
            <Typography color="text.secondary">
              Transcript will appear here once you send an instruction.
            </Typography>
          ) : null}

          {displayMessages.map((message) => {
            const alignSelf =
              message.role === 'user' ? 'flex-end' : 'flex-start';
            const isErrorBubble = message.kind === 'error';
            const isStatusBubble = message.kind === 'status';
            const isUser = message.role === 'user';
            const showMetadata = !isErrorBubble && !isStatusBubble;
            const timestampLabel = showMetadata
              ? formatBubbleTimestamp(message.createdAt)
              : null;
            const usageLine =
              message.role === 'assistant'
                ? buildUsageLine(message.usage)
                : null;
            const timingLine =
              message.role === 'assistant'
                ? buildTimingLine(message.timing)
                : null;
            const stepLine =
              message.role === 'assistant'
                ? buildStepLine(message.command)
                : null;
            const metadataColor = isUser ? 'inherit' : 'text.secondary';
            const segments = message.segments?.length
              ? message.segments
              : ([
                  {
                    id: `${message.id}-text`,
                    kind: 'text' as const,
                    content: message.content ?? '',
                  },
                  ...(message.tools?.map((tool) => ({
                    id: `${message.id}-${tool.id}`,
                    kind: 'tool' as const,
                    tool,
                  })) ?? []),
                ] as const);

            return (
              <Stack
                key={message.id}
                alignItems={
                  alignSelf === 'flex-end' ? 'flex-end' : 'flex-start'
                }
              >
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
                      {showMetadata && timestampLabel ? (
                        <Stack spacing={0.25}>
                          <Typography
                            variant="caption"
                            color={metadataColor}
                            data-testid="bubble-timestamp"
                          >
                            {timestampLabel}
                          </Typography>
                          {usageLine ? (
                            <Typography
                              variant="caption"
                              color={metadataColor}
                              data-testid="bubble-tokens"
                            >
                              {usageLine}
                            </Typography>
                          ) : null}
                          {timingLine ? (
                            <Typography
                              variant="caption"
                              color={metadataColor}
                              data-testid="bubble-timing"
                            >
                              {timingLine}
                            </Typography>
                          ) : null}
                          {stepLine ? (
                            <Typography
                              variant="caption"
                              color={metadataColor}
                              data-testid="bubble-step"
                            >
                              {stepLine}
                            </Typography>
                          ) : null}
                        </Stack>
                      ) : null}

                      {message.role === 'assistant' && message.streamStatus
                        ? (() => {
                            const usesLiveStoppedMarker =
                              liveStoppedMarker !== null &&
                              liveStoppedMarker.conversationId ===
                                conversationId &&
                              latestAssistantMessageId === message.id &&
                              message.streamStatus === 'processing' &&
                              !isStopping;
                            const visibleStreamStatus = usesLiveStoppedMarker
                              ? 'stopped'
                              : message.streamStatus;

                            return (
                              <Chip
                                size="small"
                                variant="outlined"
                                color={
                                  visibleStreamStatus === 'complete'
                                    ? 'success'
                                    : visibleStreamStatus === 'failed'
                                      ? 'error'
                                      : visibleStreamStatus === 'stopped'
                                        ? 'warning'
                                        : isStopping
                                          ? 'warning'
                                          : 'default'
                                }
                                icon={
                                  visibleStreamStatus === 'complete' ? (
                                    <CheckCircleOutlineIcon fontSize="small" />
                                  ) : visibleStreamStatus === 'failed' ? (
                                    <ErrorOutlineIcon fontSize="small" />
                                  ) : visibleStreamStatus === 'stopped' ? (
                                    <HourglassTopIcon fontSize="small" />
                                  ) : (
                                    <CircularProgress
                                      size={14}
                                      color={isStopping ? 'warning' : 'inherit'}
                                    />
                                  )
                                }
                                label={
                                  visibleStreamStatus === 'complete'
                                    ? 'Complete'
                                    : visibleStreamStatus === 'failed'
                                      ? 'Failed'
                                      : visibleStreamStatus === 'stopped'
                                        ? 'Stopped'
                                        : isStopping
                                          ? 'Stopping'
                                          : 'Processing'
                                }
                                data-testid="status-chip"
                                sx={{ alignSelf: 'flex-start' }}
                              />
                            );
                          })()
                        : null}

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
                          return (
                            <Markdown
                              key={segment.id}
                              content={segment.content ?? ' '}
                              data-testid="agents-user-markdown"
                            />
                          );
                        }

                        const tool = segment.tool;
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
                              {renderToolContent(
                                tool,
                                toggleKey,
                                !!toolErrorOpen[toggleKey],
                                onToggleToolError,
                              )}
                            </Collapse>
                          </Box>
                        );
                      })}

                      {activeToolsAvailable &&
                      message.role === 'assistant' &&
                      (message.citations?.length ?? 0) > 0 ? (
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
                              {message.citations?.map((citation, idx) => {
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
                      ) : null}

                      {message.thinkStreaming || message.think ? (
                        <Box mt={1}>
                          <Stack direction="row" alignItems="center" gap={0.5}>
                            {message.thinkStreaming ? (
                              <CircularProgress
                                size={12}
                                color="inherit"
                                data-testid="think-spinner"
                              />
                            ) : null}
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
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
                      ) : null}
                    </Stack>
                  </Paper>
                </Box>
              </Stack>
            );
          })}
        </Stack>
      </Box>
    </Paper>
  );
});

export default AgentsTranscriptPane;
