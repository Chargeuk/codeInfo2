import type { ChatMessage } from '../../hooks/useChatStream';

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const formatDecimal = (value: number) =>
  value.toFixed(2).replace(/\.?(0+)$/, '');

const isNonNegativeFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export const formatTranscriptTimestamp = (value?: string) => {
  const candidate = value ? new Date(value) : new Date();
  if (Number.isNaN(candidate.getTime())) {
    return dateTimeFormatter.format(new Date());
  }

  const diffMs = Date.now() - candidate.getTime();
  const absDiffMs = Math.abs(diffMs);
  if (absDiffMs >= 24 * 60 * 60 * 1000) {
    return dateTimeFormatter.format(candidate);
  }

  const formatRelative = (amount: number, suffix: string) =>
    diffMs >= 0 ? `${amount}${suffix} ago` : `in ${amount}${suffix}`;

  if (absDiffMs < 60_000) {
    return formatRelative(Math.max(1, Math.round(absDiffMs / 1000)), 's');
  }
  if (absDiffMs < 3_600_000) {
    return formatRelative(Math.max(1, Math.round(absDiffMs / 60_000)), 'm');
  }
  return formatRelative(Math.max(1, Math.round(absDiffMs / 3_600_000)), 'h');
};

export const formatTranscriptResponseTime = (timing: ChatMessage['timing']) => {
  if (!timing || !isNonNegativeFiniteNumber(timing.totalTimeSec)) {
    return null;
  }

  return `${formatDecimal(timing.totalTimeSec)}s`;
};

export const formatTranscriptTokenValue = (value?: number) => {
  if (!isNonNegativeFiniteNumber(value)) {
    return '—';
  }
  return value.toLocaleString();
};

export const getTranscriptStatusLabel = (
  status?: ChatMessage['streamStatus'],
) => {
  switch (status) {
    case 'complete':
      return 'Complete';
    case 'failed':
      return 'Failed';
    case 'stopped':
      return 'Stopped';
    default:
      return 'Working';
  }
};

export const getTranscriptStatusKey = (
  status?: ChatMessage['streamStatus'],
) => {
  switch (status) {
    case 'complete':
      return 'complete';
    case 'failed':
      return 'failed';
    case 'stopped':
      return 'stopped';
    default:
      return 'working';
  }
};

export const buildTranscriptInfoRows = (
  message: Pick<ChatMessage, 'provider' | 'model' | 'usage'>,
) => [
  { label: 'Provider', value: message.provider?.trim() || 'Unknown' },
  { label: 'Model', value: message.model?.trim() || 'Unknown' },
  {
    label: 'Tokens in',
    value: formatTranscriptTokenValue(message.usage?.inputTokens),
  },
  {
    label: 'Tokens out',
    value: formatTranscriptTokenValue(message.usage?.outputTokens),
  },
  {
    label: 'Cached',
    value: formatTranscriptTokenValue(message.usage?.cachedInputTokens),
  },
  {
    label: 'Total',
    value: formatTranscriptTokenValue(message.usage?.totalTokens),
  },
];
