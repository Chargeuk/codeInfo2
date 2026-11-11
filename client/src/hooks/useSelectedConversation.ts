import { useEffect, useState } from 'react';
import {
  getConversationSummary,
  type ConversationApiSummary,
} from '../api/conversations';

type Resolution = {
  conversationId?: string | null;
  summary?: ConversationApiSummary;
  isLoading: boolean;
  error?: string;
};

// The sidebar remains the source of fresh loaded summaries. An omitted selected
// item survives sidebar pagination/filtering, and each sidebar refresh also
// refreshes that fallback. This state belongs only to the current selection.
export default function useSelectedConversation({
  conversationId,
  conversations,
  enabled = true,
}: {
  conversationId?: string | null;
  conversations: readonly ConversationApiSummary[];
  enabled?: boolean;
}) {
  const loaded = conversations.find(
    (item) => item.conversationId === conversationId,
  );
  const [resolution, setResolution] = useState<Resolution>({
    isLoading: false,
  });

  useEffect(() => {
    if (!conversationId || !enabled) return;
    if (loaded) {
      setResolution({ conversationId, summary: loaded, isLoading: false });
      return;
    }
    let superseded = false;
    setResolution((previous) => ({
      conversationId,
      summary:
        previous.conversationId === conversationId
          ? previous.summary
          : undefined,
      isLoading: true,
    }));
    void getConversationSummary(conversationId).then(
      (summary) => {
        if (superseded) return;
        setResolution({
          conversationId,
          summary,
          isLoading: false,
          error: summary ? undefined : 'Conversation not found.',
        });
      },
      (error: Error) => {
        if (superseded) return;
        setResolution((previous) => ({
          ...previous,
          isLoading: false,
          error: error.message,
        }));
      },
    );
    return () => {
      superseded = true;
    };
  }, [conversationId, conversations, enabled, loaded]);

  const current = resolution.conversationId === conversationId;
  return {
    summary: loaded ?? (current ? resolution.summary : undefined),
    isLoading: Boolean(
      enabled &&
        conversationId &&
        !loaded &&
        (!current || resolution.isLoading),
    ),
    error:
      enabled && conversationId && !loaded && current
        ? resolution.error
        : undefined,
  };
}
