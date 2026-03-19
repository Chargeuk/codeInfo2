import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useEffect,
  useLayoutEffect,
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
  measurementKeyByMessageId: Record<string, string>;
  getScrollSnapshot: () => {
    scrollMode: 'pinned-bottom' | 'scrolled-away';
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  } | null;
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
  measurementKeyByMessageId,
  getScrollSnapshot,
}: VirtualizedTranscriptProps) {
  const lastWindowKeyRef = useRef<string | null>(null);
  const rowElementsRef = useRef(new Map<string, HTMLDivElement>());
  const rowHeightsRef = useRef(new Map<string, number>());
  const rowMeasurementKeysRef = useRef(new Map<string, string>());
  const pendingRowGrowthRef = useRef(
    new Map<
      string,
      {
        beforeSnapshot: ReturnType<typeof getScrollSnapshot>;
        cause: string;
      }
    >(),
  );
  const growthSettleTimersRef = useRef(new Map<string, number>());
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
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

  useEffect(() => {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (_item, delta) => {
      if (delta === 0) {
        return false;
      }
      const snapshot = getScrollSnapshot();
      if (snapshot?.scrollMode !== 'scrolled-away') {
        return false;
      }
      return _item.start < snapshot.scrollTop;
    };

    return () => {
      virtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
    };
  }, [getScrollSnapshot, virtualizer]);

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

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const element =
          entry.target instanceof HTMLDivElement ? entry.target : null;
        const messageId = element?.dataset.virtualizedMessageId;
        if (!element || !messageId) {
          return;
        }

        const nextHeight = entry.contentRect.height;
        const previousHeight = rowHeightsRef.current.get(messageId);
        rowHeightsRef.current.set(messageId, nextHeight);

        const pending = pendingRowGrowthRef.current.get(messageId);
        if (
          previousHeight == null ||
          Math.abs(nextHeight - previousHeight) < 1
        ) {
          return;
        }

        const beforeSnapshot = pending?.beforeSnapshot ?? getScrollSnapshot();
        const deltaHeight = nextHeight - previousHeight;
        virtualizer.measureElement(element);
        virtualizedTranscriptLog(
          'info',
          'DEV-0000049:T10:virtualized_row_remeasured',
          {
            surface,
            conversationId: conversationId ?? null,
            messageId,
            cause: pending?.cause ?? 'content-or-toggle-change',
          },
        );

        const existingTimer = growthSettleTimersRef.current.get(messageId);
        if (existingTimer) {
          window.clearTimeout(existingTimer);
        }

        const timerId = window.setTimeout(() => {
          const afterSnapshot = getScrollSnapshot();
          const rowIndex = Number(element.dataset.index ?? NaN);
          const measuredRowStart = Number(
            element.dataset.virtualizedStart ?? NaN,
          );
          const rowStart =
            Number.isFinite(measuredRowStart) &&
            (measuredRowStart > 0 || rowIndex === 0)
              ? measuredRowStart
              : Number.isFinite(rowIndex)
                ? rowIndex * VIRTUALIZED_TRANSCRIPT_ESTIMATE_SIZE_PX
                : NaN;
          const shouldPreserveAnchor =
            beforeSnapshot?.scrollMode === 'scrolled-away' &&
            deltaHeight > 0 &&
            Number.isFinite(rowStart) &&
            rowStart < beforeSnapshot.scrollTop;
          const shouldPreservePinnedBottom =
            beforeSnapshot?.scrollMode === 'pinned-bottom' && deltaHeight > 0;
          const expectedScrollTop =
            !beforeSnapshot
              ? null
              : shouldPreserveAnchor || shouldPreservePinnedBottom
                ? beforeSnapshot.scrollTop + deltaHeight
                : beforeSnapshot.scrollTop;
          if (
            beforeSnapshot &&
            afterSnapshot &&
            (shouldPreserveAnchor || shouldPreservePinnedBottom)
          ) {
            const scrollElement = transcriptContainerRef.current;
            if (scrollElement) {
              scrollElement.scrollTop = expectedScrollTop ?? scrollElement.scrollTop;
            }
          }
          const settledSnapshot = getScrollSnapshot();
          const anchorPreserved =
            expectedScrollTop == null || !settledSnapshot
              ? true
              : settledSnapshot.scrollTop === expectedScrollTop;
          virtualizedTranscriptLog(
            'info',
            'DEV-0000049:T10:virtualized_row_growth_settled',
            {
              surface,
              conversationId: conversationId ?? null,
              messageId,
              anchorPreserved,
            },
          );
          pendingRowGrowthRef.current.delete(messageId);
          growthSettleTimersRef.current.delete(messageId);
        }, 0);

        growthSettleTimersRef.current.set(messageId, timerId);
      });
    });

    resizeObserverRef.current = observer;
    rowElementsRef.current.forEach((element) => observer.observe(element));
    const growthSettleTimers = growthSettleTimersRef.current;

    return () => {
      growthSettleTimers.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      growthSettleTimers.clear();
      observer.disconnect();
      resizeObserverRef.current = null;
    };
  }, [
    conversationId,
    getScrollSnapshot,
    surface,
    transcriptContainerRef,
    virtualizer,
  ]);

  useLayoutEffect(() => {
    messages.forEach((message) => {
      const element = rowElementsRef.current.get(message.id);
      const nextMeasurementKey = measurementKeyByMessageId[message.id] ?? '';
      const previousMeasurementKey = rowMeasurementKeysRef.current.get(
        message.id,
      );

      if (previousMeasurementKey == null) {
        rowMeasurementKeysRef.current.set(message.id, nextMeasurementKey);
        if (element) {
          rowHeightsRef.current.set(
            message.id,
            element.getBoundingClientRect().height,
          );
        }
        return;
      }

      if (previousMeasurementKey === nextMeasurementKey || !element) {
        rowMeasurementKeysRef.current.set(message.id, nextMeasurementKey);
        return;
      }

      rowMeasurementKeysRef.current.set(message.id, nextMeasurementKey);
      pendingRowGrowthRef.current.set(message.id, {
        beforeSnapshot: getScrollSnapshot(),
        cause: 'content-or-toggle-change',
      });
      virtualizer.measureElement(element);
    });
  }, [getScrollSnapshot, measurementKeyByMessageId, messages, virtualizer]);

  useEffect(() => {
    const visibleMessageIds = new Set(messages.map((message) => message.id));
    Array.from(rowElementsRef.current.keys()).forEach((messageId) => {
      if (!visibleMessageIds.has(messageId)) {
        rowElementsRef.current.delete(messageId);
      }
    });
  }, [messages]);

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
              data-virtualized-message-id={message.id}
              data-virtualized-start={virtualRow.start}
              ref={(node) => {
                const observer = resizeObserverRef.current;
                const previous = rowElementsRef.current.get(message.id);
                if (previous && previous !== node && observer) {
                  observer.unobserve(previous);
                }

                if (!node) {
                  rowElementsRef.current.delete(message.id);
                  return;
                }

                rowElementsRef.current.set(message.id, node);
                rowHeightsRef.current.set(
                  message.id,
                  node.getBoundingClientRect().height,
                );
                virtualizer.measureElement(node);
                observer?.observe(node);
              }}
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
