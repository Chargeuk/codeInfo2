import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Paper,
  Typography,
} from '@mui/material';
import { memo, useEffect, useMemo, useRef, type UIEventHandler } from 'react';
import type { ChatMessage, ToolCall } from '../../hooks/useChatStream';
import { createLogger } from '../../logging/logger';
import SharedTranscript from '../chat/SharedTranscript';

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
  citationsOpen: Record<string, boolean>;
  thinkOpen: Record<string, boolean>;
  toolOpen: Record<string, boolean>;
  toolErrorOpen: Record<string, boolean>;
  activeToolsAvailable: boolean;
  latestAssistantMessageId: string | null;
  liveStoppedMarker: LiveStoppedMarker;
  isStopping: boolean;
  onToggleCitation: (messageId: string) => void;
  onToggleThink: (messageId: string) => void;
  onToggleTool: (toggleKey: string, messageId: string) => void;
  onToggleToolError: (toggleKey: string, messageId: string) => void;
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

const AgentsTranscriptPane = memo(function AgentsTranscriptPane({
  conversationId,
  transcriptRef,
  onScroll,
  displayMessages,
  turnsLoading,
  turnsError,
  turnsErrorMessage,
  citationsOpen,
  thinkOpen,
  toolOpen,
  toolErrorOpen,
  activeToolsAvailable,
  latestAssistantMessageId,
  liveStoppedMarker,
  isStopping,
  onToggleCitation,
  onToggleThink,
  onToggleTool,
  onToggleToolError,
}: AgentsTranscriptPaneProps) {
  const lastRenderStateRef = useRef<string | null>(null);
  const liveStoppedMarkerVisible = useMemo(
    () =>
      liveStoppedMarker !== null &&
      liveStoppedMarker.conversationId === conversationId &&
      latestAssistantMessageId !== null &&
      displayMessages.some(
        (message) =>
          message.id === latestAssistantMessageId &&
          message.role === 'assistant' &&
          message.streamStatus === 'processing',
      ) &&
      !isStopping,
    [
      conversationId,
      displayMessages,
      isStopping,
      latestAssistantMessageId,
      liveStoppedMarker,
    ],
  );
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
        liveStoppedMarkerVisible,
      }),
    [
      conversationId,
      displayMessages,
      latestAssistantMessageId,
      liveStoppedMarkerVisible,
      turnsError,
      turnsErrorMessage,
      turnsLoading,
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
      <SharedTranscript
        ref={transcriptRef}
        surface="agents"
        conversationId={conversationId ?? null}
        messages={displayMessages}
        activeToolsAvailable={activeToolsAvailable}
        turnsLoading={turnsLoading}
        turnsError={turnsError}
        turnsErrorMessage={turnsErrorMessage}
        emptyMessage="Transcript will appear here once you send an instruction."
        warningTestId="agent-turns-error"
        transcriptTestId="chat-transcript"
        citationsEnabled
        isStopping={isStopping}
        citationsOpen={citationsOpen}
        thinkOpen={thinkOpen}
        toolOpen={toolOpen}
        toolErrorOpen={toolErrorOpen}
        onToggleCitation={onToggleCitation}
        onToggleThink={onToggleThink}
        onToggleTool={onToggleTool}
        onToggleToolError={onToggleToolError}
        onScroll={onScroll}
        markdownLogSource="AgentsPage"
        userMarkdownTestId="agents-user-markdown"
        resolveStreamStatus={(message) => {
          const usesLiveStoppedMarker =
            liveStoppedMarker !== null &&
            liveStoppedMarker.conversationId === conversationId &&
            latestAssistantMessageId === message.id &&
            message.streamStatus === 'processing' &&
            !isStopping;
          return usesLiveStoppedMarker ? 'stopped' : message.streamStatus;
        }}
        renderToolExtraContent={(tool: ToolCall, toggleKey: string) =>
          renderResultAccordion(tool.payload, toggleKey)
        }
        sharedRenderLogConfig={{
          eventName: 'DEV-0000049:T04:agents_shared_transcript_rendered',
          context: {
            hasTurnsError: turnsError,
            liveStoppedMarkerVisible,
          },
        }}
      />
    </Paper>
  );
});

export default AgentsTranscriptPane;
