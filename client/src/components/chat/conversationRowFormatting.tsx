import DevicesOutlinedIcon from '@mui/icons-material/DevicesOutlined';
import { Box } from '@mui/material';
import type { ReactNode } from 'react';
import anthropicClaudeLogo from '../../assets/provider-logos/anthropic-claude.svg';
import githubCopilotLogo from '../../assets/provider-logos/github-copilot.svg';
import lmStudioLogo from '../../assets/provider-logos/lmstudio.webp';
import openAiCodexLogo from '../../assets/provider-logos/openai-codex.svg';

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

export const formatConversationRowTimestamp = (
  value?: string | null,
  nowMs = Date.now(),
) => {
  const cleaned = cleanConversationText(value);
  if (!cleaned) return '—';

  const date = new Date(cleaned);
  if (Number.isNaN(date.getTime())) return '—';

  const diffMs = nowMs - date.getTime();
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

const buildProviderLogoImage = (src: string, alt: string) => (
  <Box
    component="img"
    src={src}
    alt={alt}
    sx={{
      width: 18,
      height: 18,
      objectFit: 'contain',
      display: 'block',
    }}
  />
);

type ConversationPresentationKey =
  | 'openai'
  | 'claude'
  | 'codex'
  | 'copilot'
  | 'lmstudio'
  | 'runtime';

const buildPresentation = (
  key: ConversationPresentationKey,
): ConversationProviderPresentation => {
  switch (key) {
    case 'openai':
      return {
        label: 'OpenAI',
        icon: buildProviderLogoImage(openAiCodexLogo, 'OpenAI logo'),
      };
    case 'claude':
      return {
        label: 'Claude',
        icon: buildProviderLogoImage(anthropicClaudeLogo, 'Claude logo'),
      };
    case 'codex':
      return {
        label: 'Codex',
        icon: buildProviderLogoImage(openAiCodexLogo, 'OpenAI Codex logo'),
      };
    case 'copilot':
      return {
        label: 'Copilot',
        icon: buildProviderLogoImage(githubCopilotLogo, 'GitHub Copilot logo'),
      };
    case 'lmstudio':
      return {
        label: 'LM Studio',
        icon: buildProviderLogoImage(lmStudioLogo, 'LM Studio logo'),
      };
    default:
      return {
        label: 'Runtime',
        icon: <DevicesOutlinedIcon fontSize="small" />,
      };
  }
};

const resolveProviderPresentationKey = (
  provider?: string | null,
  model?: string | null,
): ConversationPresentationKey => {
  const normalizedProvider = normalizeProviderKey(provider);
  const normalizedModel = cleanConversationText(model)?.toLowerCase() ?? '';

  if (
    normalizedProvider.includes('codex') ||
    normalizedModel.includes('codex')
  ) {
    return 'codex';
  }
  if (
    normalizedProvider.includes('copilot') ||
    normalizedModel.includes('copilot')
  ) {
    return 'copilot';
  }
  if (
    normalizedProvider.includes('lmstudio') ||
    normalizedProvider.includes('lm studio') ||
    normalizedModel.includes('lmstudio') ||
    normalizedModel.includes('lm studio')
  ) {
    return 'lmstudio';
  }

  return 'runtime';
};

export const getConversationProviderPresentation = (
  provider?: string | null,
  model?: string | null,
): ConversationProviderPresentation => {
  return buildPresentation(resolveProviderPresentationKey(provider, model));
};

export const getConversationModelPresentation = (
  provider?: string | null,
  model?: string | null,
): ConversationProviderPresentation => {
  const normalizedModel = cleanConversationText(model)?.toLowerCase() ?? '';
  if (normalizedModel.startsWith('gpt')) {
    return buildPresentation('openai');
  }
  if (normalizedModel.startsWith('claude')) {
    return buildPresentation('claude');
  }

  return buildPresentation(resolveProviderPresentationKey(provider, model));
};
