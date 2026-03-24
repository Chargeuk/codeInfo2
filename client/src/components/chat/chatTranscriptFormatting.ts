import type { ChatMessage } from '../../hooks/useChatStream';

const bubbleTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const formatDecimal = (value: number) =>
  value.toFixed(2).replace(/\.?(0+)$/, '');

const isNonNegativeFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export const formatBubbleTimestamp = (value?: string) => {
  const candidate = value ? new Date(value) : new Date();
  if (Number.isNaN(candidate.getTime())) {
    return bubbleTimestampFormatter.format(new Date());
  }
  return bubbleTimestampFormatter.format(candidate);
};

export const buildUsageLine = (usage: ChatMessage['usage']) => {
  if (!usage) return null;
  const parts: string[] = [];
  if (isNonNegativeFiniteNumber(usage.inputTokens)) {
    parts.push(`in ${usage.inputTokens}`);
  }
  if (isNonNegativeFiniteNumber(usage.outputTokens)) {
    parts.push(`out ${usage.outputTokens}`);
  }
  if (isNonNegativeFiniteNumber(usage.totalTokens)) {
    parts.push(`total ${usage.totalTokens}`);
  }
  if (isNonNegativeFiniteNumber(usage.cachedInputTokens)) {
    parts.push(`cached ${usage.cachedInputTokens}`);
  }
  return parts.length > 0 ? `Tokens: ${parts.join(' · ')}` : null;
};

export const buildTimingLine = (timing: ChatMessage['timing']) => {
  if (!timing) return null;
  const parts: string[] = [];
  if (isNonNegativeFiniteNumber(timing.totalTimeSec)) {
    parts.push(`Time: ${formatDecimal(timing.totalTimeSec)}s`);
  }
  if (isNonNegativeFiniteNumber(timing.tokensPerSecond)) {
    parts.push(`Rate: ${formatDecimal(timing.tokensPerSecond)} tok/s`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
};

export const collectOmittedMetadataFields = (
  message: Pick<ChatMessage, 'role' | 'provider' | 'usage' | 'timing'>,
) => {
  if (message.role !== 'assistant' || message.provider !== 'copilot') {
    return [] as string[];
  }

  const omittedFields: string[] = [];

  if (message.usage) {
    if (!isNonNegativeFiniteNumber(message.usage.inputTokens)) {
      omittedFields.push('usage.inputTokens');
    }
    if (!isNonNegativeFiniteNumber(message.usage.outputTokens)) {
      omittedFields.push('usage.outputTokens');
    }
    if (!isNonNegativeFiniteNumber(message.usage.totalTokens)) {
      omittedFields.push('usage.totalTokens');
    }
    if (!isNonNegativeFiniteNumber(message.usage.cachedInputTokens)) {
      omittedFields.push('usage.cachedInputTokens');
    }
  }

  if (message.timing) {
    if (!isNonNegativeFiniteNumber(message.timing.totalTimeSec)) {
      omittedFields.push('timing.totalTimeSec');
    }
    if (!isNonNegativeFiniteNumber(message.timing.tokensPerSecond)) {
      omittedFields.push('timing.tokensPerSecond');
    }
  }

  return omittedFields;
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
