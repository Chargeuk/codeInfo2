import type { ChatMessage } from '../../hooks/useChatStream';

const bubbleTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const formatDecimal = (value: number) =>
  value.toFixed(2).replace(/\.?(0+)$/, '');

export const formatBubbleTimestamp = (value?: string) => {
  const candidate = value ? new Date(value) : new Date();
  if (Number.isNaN(candidate.getTime())) {
    return bubbleTimestampFormatter.format(new Date());
  }
  return bubbleTimestampFormatter.format(candidate);
};

export const buildUsageLine = (usage: ChatMessage['usage']) => {
  if (!usage) return null;
  const hasUsage =
    usage.inputTokens !== undefined ||
    usage.outputTokens !== undefined ||
    usage.totalTokens !== undefined ||
    usage.cachedInputTokens !== undefined;
  if (!hasUsage) return null;
  const cachedSuffix =
    usage.cachedInputTokens !== undefined
      ? ` (cached ${usage.cachedInputTokens})`
      : '';
  return (
    `Tokens: in ${usage.inputTokens ?? 0} · out ${usage.outputTokens ?? 0} · total ` +
    `${usage.totalTokens ?? 0}${cachedSuffix}`
  );
};

export const buildTimingLine = (timing: ChatMessage['timing']) => {
  if (!timing) return null;
  const hasTiming =
    timing.totalTimeSec !== undefined || timing.tokensPerSecond !== undefined;
  if (!hasTiming) return null;
  const parts: string[] = [];
  if (timing.totalTimeSec !== undefined) {
    parts.push(`Time: ${formatDecimal(timing.totalTimeSec)}s`);
  }
  if (timing.tokensPerSecond !== undefined) {
    parts.push(`Rate: ${formatDecimal(timing.tokensPerSecond)} tok/s`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
};

export const buildStepLine = (command: ChatMessage['command']) => {
  if (!command) return null;
  if (
    !Number.isFinite(command.stepIndex) ||
    !Number.isFinite(command.totalSteps)
  ) {
    return null;
  }
  return `Step ${command.stepIndex} of ${command.totalSteps}`;
};
