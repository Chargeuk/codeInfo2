import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import type { ChatMessage } from '../../hooks/useChatStream';
import { createLogger } from '../../logging/logger';

type VirtualizedTranscriptProps = {
  surface: 'chat' | 'agents' | 'flows';
  conversationId?: string | null;
  messages: ChatMessage[];
  transcriptContainerRef: MutableRefObject<HTMLDivElement | null>;
  renderMessageRow: (message: ChatMessage) => ReactNode;
};

const virtualizedTranscriptLog = createLogger('client');
const VIRTUALIZED_TRANSCRIPT_OVERSCAN = 6;
const VIRTUALIZED_TRANSCRIPT_ESTIMATE_SIZE_PX = 240;
const VIRTUALIZED_TRANSCRIPT_ROW_GAP_PX = 8;
const VIRTUALIZED_TRANSCRIPT_INITIAL_RECT = { width: 0, height: 400 };

export default function VirtualizedTranscript({
  surface,
  conversationId,
  messages,
  transcriptContainerRef,
  renderMessageRow,
}: VirtualizedTranscriptProps) {
  const lastWindowKeyRef = useRef<string | null>(null);
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => transcriptContainerRef.current,
    initialRect: VIRTUALIZED_TRANSCRIPT_INITIAL_RECT,
    observeElementRect: (_instance, cb) => {
      const element = transcriptContainerRef.current;
      if (!element) {
        cb(VIRTUALIZED_TRANSCRIPT_INITIAL_RECT);
        return;
      }

      const emitRect = () => {
        cb({
          width:
            element.clientWidth || VIRTUALIZED_TRANSCRIPT_INITIAL_RECT.width,
          height:
            element.clientHeight || VIRTUALIZED_TRANSCRIPT_INITIAL_RECT.height,
        });
      };

      emitRect();

      if (typeof ResizeObserver === 'undefined') {
        return;
      }

      const observer = new ResizeObserver(() => {
        emitRect();
      });
      observer.observe(element);
      return () => observer.disconnect();
    },
    estimateSize: () => VIRTUALIZED_TRANSCRIPT_ESTIMATE_SIZE_PX,
    overscan: VIRTUALIZED_TRANSCRIPT_OVERSCAN,
    getItemKey: (index) => messages[index]!.id,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const windowKey = useMemo(() => {
    if (virtualItems.length === 0 || messages.length === 0) {
      return null;
    }
    const startIndex = virtualItems[0]?.index ?? 0;
    const endIndex = virtualItems[virtualItems.length - 1]?.index ?? 0;
    return `${surface}:${conversationId ?? 'none'}:${startIndex}:${endIndex}:${messages.length}`;
  }, [conversationId, messages.length, surface, virtualItems]);

  useEffect(() => {
    if (!windowKey || lastWindowKeyRef.current === windowKey) {
      return;
    }
    lastWindowKeyRef.current = windowKey;
    const startIndex = virtualItems[0]?.index ?? 0;
    const endIndex = virtualItems[virtualItems.length - 1]?.index ?? 0;
    virtualizedTranscriptLog(
      'info',
      'DEV-0000049:T09:virtualized_transcript_window_changed',
      {
        surface,
        conversationId: conversationId ?? null,
        startIndex,
        endIndex,
        totalCount: messages.length,
      },
    );
  }, [conversationId, messages.length, surface, virtualItems, windowKey]);

  if (messages.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        position: 'relative',
        width: '100%',
      }}
    >
      {virtualItems.map((virtualRow) => {
        const message = messages[virtualRow.index];
        if (!message) {
          return null;
        }

        return (
          <div
            key={virtualRow.key}
            style={{
              left: 0,
              position: 'absolute',
              top: 0,
              transform: `translateY(${virtualRow.start}px)`,
              width: '100%',
            }}
          >
            <div
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                paddingBottom:
                  virtualRow.index === messages.length - 1
                    ? 0
                    : VIRTUALIZED_TRANSCRIPT_ROW_GAP_PX,
              }}
            >
              {renderMessageRow(message)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
