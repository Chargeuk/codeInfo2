import { useCallback, useEffect, useMemo, useState } from 'react';
import { createLogger } from '../../logging/logger';

type SharedTranscriptSurface = 'chat' | 'agents' | 'flows';
type SharedTranscriptStateKey = 'citation' | 'think' | 'tool' | 'tool-error';

type UseSharedTranscriptStateParams = {
  surface: SharedTranscriptSurface;
  conversationId?: string | null;
};

type SharedTranscriptState = {
  citationsOpen: Record<string, boolean>;
  thinkOpen: Record<string, boolean>;
  toolOpen: Record<string, boolean>;
  toolErrorOpen: Record<string, boolean>;
  toggleCitation: (messageId: string) => void;
  toggleThink: (messageId: string) => void;
  toggleTool: (toggleKey: string, messageId: string) => void;
  toggleToolError: (toggleKey: string, messageId: string) => void;
};

const log = createLogger('client');

export default function useSharedTranscriptState({
  surface,
  conversationId,
}: UseSharedTranscriptStateParams): SharedTranscriptState {
  const [citationsOpen, setCitationsOpen] = useState<Record<string, boolean>>(
    {},
  );
  const [thinkOpen, setThinkOpen] = useState<Record<string, boolean>>({});
  const [toolOpen, setToolOpen] = useState<Record<string, boolean>>({});
  const [toolErrorOpen, setToolErrorOpen] = useState<Record<string, boolean>>(
    {},
  );

  useEffect(() => {
    setCitationsOpen({});
    setThinkOpen({});
    setToolOpen({});
    setToolErrorOpen({});
  }, [conversationId, surface]);

  const logStateChange = useCallback(
    (messageId: string, stateKey: SharedTranscriptStateKey, open: boolean) => {
      log('info', 'DEV-0000049:T07:shared_transcript_state_changed', {
        surface,
        conversationId: conversationId ?? null,
        messageId,
        stateKey,
        open,
      });
    },
    [conversationId, surface],
  );

  const toggleCitation = useCallback(
    (messageId: string) => {
      setCitationsOpen((current) => {
        const open = !current[messageId];
        logStateChange(messageId, 'citation', open);
        return { ...current, [messageId]: open };
      });
    },
    [logStateChange],
  );

  const toggleThink = useCallback(
    (messageId: string) => {
      setThinkOpen((current) => {
        const open = !current[messageId];
        logStateChange(messageId, 'think', open);
        return { ...current, [messageId]: open };
      });
    },
    [logStateChange],
  );

  const toggleTool = useCallback(
    (toggleKey: string, messageId: string) => {
      setToolOpen((current) => {
        const open = !current[toggleKey];
        logStateChange(messageId, 'tool', open);
        return { ...current, [toggleKey]: open };
      });
    },
    [logStateChange],
  );

  const toggleToolError = useCallback(
    (toggleKey: string, messageId: string) => {
      setToolErrorOpen((current) => {
        const open = !current[toggleKey];
        logStateChange(messageId, 'tool-error', open);
        return { ...current, [toggleKey]: open };
      });
    },
    [logStateChange],
  );

  return useMemo(
    () => ({
      citationsOpen,
      thinkOpen,
      toolOpen,
      toolErrorOpen,
      toggleCitation,
      toggleThink,
      toggleTool,
      toggleToolError,
    }),
    [
      citationsOpen,
      thinkOpen,
      toggleCitation,
      toggleThink,
      toggleTool,
      toggleToolError,
      toolErrorOpen,
      toolOpen,
    ],
  );
}
