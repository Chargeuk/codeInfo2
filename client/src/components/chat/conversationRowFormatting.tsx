import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import DevicesOutlinedIcon from '@mui/icons-material/DevicesOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import TerminalOutlinedIcon from '@mui/icons-material/TerminalOutlined';
import type { ReactNode } from 'react';

const conversationRelativeTimeFormatter = new Intl.RelativeTimeFormat(
  undefined,
  {
    numeric: 'auto',
  },
);

const conversationExactTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const cleanConversationText = (value?: string | null) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export type ConversationPreviewTextSource = {
  userText?: string | null;
  assistantSummary?: string | null;
  systemSummary?: string | null;
  fallback?: string;
};

export const buildConversationPreviewText = (
  params: ConversationPreviewTextSource,
) => {
  const userText = cleanConversationText(params.userText);
  if (userText) return userText;

  const assistantSummary = cleanConversationText(params.assistantSummary);
  if (assistantSummary) return assistantSummary;

  const systemSummary = cleanConversationText(params.systemSummary);
  if (systemSummary) return systemSummary;

  return cleanConversationText(params.fallback) ?? 'No preview available';
};

export const formatConversationRowTimestamp = (value?: string | null) => {
  const cleaned = cleanConversationText(value);
  if (!cleaned) return '—';

  const date = new Date(cleaned);
  if (Number.isNaN(date.getTime())) return '—';

  const diffMs = Date.now() - date.getTime();
  const absDiffMs = Math.abs(diffMs);
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;

  if (absDiffMs >= dayMs) {
    return conversationExactTimeFormatter.format(date);
  }

  if (absDiffMs < 60 * 1000) {
    return 'just now';
  }

  if (absDiffMs < hourMs) {
    const minutes = Math.max(1, Math.round(absDiffMs / (60 * 1000)));
    return conversationRelativeTimeFormatter.format(
      diffMs >= 0 ? -minutes : minutes,
      'minute',
    );
  }

  const hours = Math.max(1, Math.round(absDiffMs / hourMs));
  return conversationRelativeTimeFormatter.format(
    diffMs >= 0 ? -hours : hours,
    'hour',
  );
};

const normalizeProviderKey = (provider?: string | null) =>
  cleanConversationText(provider)?.toLowerCase() ?? '';

export type ConversationProviderPresentation = {
  label: string;
  icon: ReactNode;
};

export const getConversationProviderPresentation = (
  provider?: string | null,
  model?: string | null,
): ConversationProviderPresentation => {
  const normalizedProvider = normalizeProviderKey(provider);
  const normalizedModel = cleanConversationText(model)?.toLowerCase() ?? '';

  const key =
    normalizedProvider.includes('codex') || normalizedModel.includes('codex')
      ? 'codex'
      : normalizedProvider.includes('copilot') ||
          normalizedModel.includes('copilot')
        ? 'copilot'
        : normalizedProvider.includes('lmstudio') ||
            normalizedProvider.includes('lm studio') ||
            normalizedModel.includes('lmstudio') ||
            normalizedModel.includes('lm studio')
          ? 'lmstudio'
          : 'runtime';

  switch (key) {
    case 'codex':
      return {
        label: 'Codex',
        icon: <AutoAwesomeOutlinedIcon fontSize="small" />,
      };
    case 'copilot':
      return {
        label: 'Copilot',
        icon: <SmartToyOutlinedIcon fontSize="small" />,
      };
    case 'lmstudio':
      return {
        label: 'LM Studio',
        icon: <TerminalOutlinedIcon fontSize="small" />,
      };
    default:
      return {
        label: 'Runtime',
        icon: <DevicesOutlinedIcon fontSize="small" />,
      };
  }
};
