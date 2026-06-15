import anthropicClaudeLogo from '@lobehub/icons-static-svg/icons/claude.svg';
import openAiCodexLogo from '@lobehub/icons-static-svg/icons/codex.svg';
import cohereLogo from '@lobehub/icons-static-svg/icons/cohere.svg';
import deepSeekLogo from '@lobehub/icons-static-svg/icons/deepseek.svg';
import geminiLogo from '@lobehub/icons-static-svg/icons/gemini.svg';
import gemmaLogo from '@lobehub/icons-static-svg/icons/gemma.svg';
import grokLogo from '@lobehub/icons-static-svg/icons/grok.svg';
import metaLogo from '@lobehub/icons-static-svg/icons/meta.svg';
import mistralLogo from '@lobehub/icons-static-svg/icons/mistral.svg';
import novaLogo from '@lobehub/icons-static-svg/icons/nova.svg';
import openAiLogo from '@lobehub/icons-static-svg/icons/openai.svg';
import qwenLogo from '@lobehub/icons-static-svg/icons/qwen.svg';
import DevicesOutlinedIcon from '@mui/icons-material/DevicesOutlined';
import { Box } from '@mui/material';
import type { ReactNode } from 'react';
import githubCopilotLogo from '../../assets/provider-logos/github-copilot.svg';
import lmStudioLogo from '../../assets/provider-logos/lmstudio.webp';

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
  | 'cohere'
  | 'copilot'
  | 'deepseek'
  | 'gemini'
  | 'gemma'
  | 'grok'
  | 'lmstudio'
  | 'meta'
  | 'mistral'
  | 'nova'
  | 'qwen'
  | 'runtime';

const buildPresentation = (
  key: ConversationPresentationKey,
): ConversationProviderPresentation => {
  switch (key) {
    case 'openai':
      return {
        label: 'OpenAI',
        icon: buildProviderLogoImage(openAiLogo, 'OpenAI logo'),
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
    case 'cohere':
      return {
        label: 'Cohere',
        icon: buildProviderLogoImage(cohereLogo, 'Cohere logo'),
      };
    case 'copilot':
      return {
        label: 'Copilot',
        icon: buildProviderLogoImage(githubCopilotLogo, 'GitHub Copilot logo'),
      };
    case 'deepseek':
      return {
        label: 'DeepSeek',
        icon: buildProviderLogoImage(deepSeekLogo, 'DeepSeek logo'),
      };
    case 'gemini':
      return {
        label: 'Gemini',
        icon: buildProviderLogoImage(geminiLogo, 'Gemini logo'),
      };
    case 'gemma':
      return {
        label: 'Gemma',
        icon: buildProviderLogoImage(gemmaLogo, 'Gemma logo'),
      };
    case 'grok':
      return {
        label: 'Grok',
        icon: buildProviderLogoImage(grokLogo, 'Grok logo'),
      };
    case 'lmstudio':
      return {
        label: 'LM Studio',
        icon: buildProviderLogoImage(lmStudioLogo, 'LM Studio logo'),
      };
    case 'meta':
      return {
        label: 'Meta',
        icon: buildProviderLogoImage(metaLogo, 'Meta logo'),
      };
    case 'mistral':
      return {
        label: 'Mistral',
        icon: buildProviderLogoImage(mistralLogo, 'Mistral logo'),
      };
    case 'nova':
      return {
        label: 'Nova',
        icon: buildProviderLogoImage(novaLogo, 'Nova logo'),
      };
    case 'qwen':
      return {
        label: 'Qwen',
        icon: buildProviderLogoImage(qwenLogo, 'Qwen logo'),
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

const MODEL_PRESENTATION_MATCHERS: Array<{
  key: ConversationPresentationKey;
  matches: (value: string) => boolean;
}> = [
  {
    key: 'codex',
    matches: (value) => /\bcodex\b/i.test(value),
  },
  {
    key: 'claude',
    matches: (value) => /(?:^|[\/\s_-])claude(?:$|[\/\s_-])/i.test(value),
  },
  {
    key: 'gemini',
    matches: (value) => /(?:^|[\/\s_-])gemini(?:$|[\/\s_-])/i.test(value),
  },
  {
    key: 'gemma',
    matches: (value) => /(?:^|[\/\s_-])gemma(?:$|[\/\s_-])/i.test(value),
  },
  {
    key: 'grok',
    matches: (value) =>
      /(?:^|[\/\s_-])grok(?:$|[\/\s_-])/i.test(value) ||
      /(?:^|[\/\s_-])xai(?:$|[\/\s_-])/i.test(value),
  },
  {
    key: 'deepseek',
    matches: (value) => /deepseek/i.test(value),
  },
  {
    key: 'qwen',
    matches: (value) => /(?:^|[\/\s_-])qwen(?:$|[\/\s_-])/i.test(value),
  },
  {
    key: 'cohere',
    matches: (value) =>
      /(?:^|[\/\s_-])cohere(?:$|[\/\s_-])/i.test(value) ||
      /(?:^|[\/\s_-])commanda?(?:$|[\/\s_-])/i.test(value) ||
      /(?:^|[\/\s_-])aya(?:$|[\/\s_-])/i.test(value),
  },
  {
    key: 'nova',
    matches: (value) =>
      /(?:^|[\/\s_-])nova(?:$|[\/\s_-])/i.test(value) ||
      /(?:^|[\/\s_-])amazon(?:$|[\/\s_-])/i.test(value) ||
      /(?:^|[\/\s_-])aws(?:$|[\/\s_-])/i.test(value),
  },
  {
    key: 'mistral',
    matches: (value) => /(?:^|[\/\s_-])mistral(?:$|[\/\s_-])/i.test(value),
  },
  {
    key: 'meta',
    matches: (value) =>
      /(?:^|[\/\s_-])meta(?:$|[\/\s_-])/i.test(value) ||
      /(?:^|[\/\s_-])llama(?:$|[\/\s_-])/i.test(value),
  },
  {
    key: 'openai',
    matches: (value) =>
      /(?:^|[\/\s_-])openai(?:$|[\/\s_-])/i.test(value) ||
      /(?:^|[\/\s_-])gpt(?:$|[\/\s_-])/i.test(value) ||
      /(?:^|[\/\s_-])o[134](?:$|[\/\s_-])/i.test(value),
  },
];

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
  for (const matcher of MODEL_PRESENTATION_MATCHERS) {
    if (matcher.matches(normalizedModel)) {
      return buildPresentation(matcher.key);
    }
  }

  return buildPresentation(resolveProviderPresentationKey(provider, model));
};
