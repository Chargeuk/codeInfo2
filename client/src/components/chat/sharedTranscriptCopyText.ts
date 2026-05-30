import type { ChatMessage, ChatSegment } from '../../hooks/useChatStream';

type CopySource = Pick<ChatMessage, 'content' | 'segments'>;

const isTextSegment = (
  segment: ChatSegment,
): segment is Extract<ChatSegment, { kind: 'text' }> => segment.kind === 'text';

export const buildSharedTranscriptCopyText = ({
  content,
  segments,
}: CopySource) => {
  const visibleTextSegments =
    segments?.filter(isTextSegment).map((segment) => segment.content ?? '') ??
    [];

  const textFromSegments = visibleTextSegments
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join('\n\n');

  const visibleText =
    textFromSegments.length > 0 ? textFromSegments : (content ?? '');

  return visibleText.trim();
};
