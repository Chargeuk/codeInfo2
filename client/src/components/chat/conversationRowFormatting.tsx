import ai21Logo from '@lobehub/icons-static-svg/icons/ai21.svg';
import arceeLogo from '@lobehub/icons-static-svg/icons/arcee.svg';
import bytedanceLogo from '@lobehub/icons-static-svg/icons/bytedance.svg';
import anthropicClaudeLogo from '@lobehub/icons-static-svg/icons/claude.svg';
import openAiCodexLogo from '@lobehub/icons-static-svg/icons/codex.svg';
import cohereLogo from '@lobehub/icons-static-svg/icons/cohere.svg';
import deepSeekLogo from '@lobehub/icons-static-svg/icons/deepseek.svg';
import essentialAiLogo from '@lobehub/icons-static-svg/icons/essentialai.svg';
import geminiLogo from '@lobehub/icons-static-svg/icons/gemini.svg';
import gemmaLogo from '@lobehub/icons-static-svg/icons/gemma.svg';
import glmLogo from '@lobehub/icons-static-svg/icons/glmv.svg';
import grokLogo from '@lobehub/icons-static-svg/icons/grok.svg';
import ibmLogo from '@lobehub/icons-static-svg/icons/ibm.svg';
import inceptionLogo from '@lobehub/icons-static-svg/icons/inception.svg';
import kimiLogo from '@lobehub/icons-static-svg/icons/kimi.svg';
import kwaiPilotLogo from '@lobehub/icons-static-svg/icons/kwaipilot.svg';
import metaLogo from '@lobehub/icons-static-svg/icons/meta.svg';
import miniMaxLogo from '@lobehub/icons-static-svg/icons/minimax.svg';
import mistralLogo from '@lobehub/icons-static-svg/icons/mistral.svg';
import novaLogo from '@lobehub/icons-static-svg/icons/nova.svg';
import nvidiaLogo from '@lobehub/icons-static-svg/icons/nvidia.svg';
import openAiLogo from '@lobehub/icons-static-svg/icons/openai.svg';
import openRouterLogo from '@lobehub/icons-static-svg/icons/openrouter.svg';
import qwenLogo from '@lobehub/icons-static-svg/icons/qwen.svg';
import relaceLogo from '@lobehub/icons-static-svg/icons/relace.svg';
import stepfunLogo from '@lobehub/icons-static-svg/icons/stepfun.svg';
import tencentLogo from '@lobehub/icons-static-svg/icons/tencent.svg';
import upstageLogo from '@lobehub/icons-static-svg/icons/upstage.svg';
import xiaomiMiMoLogo from '@lobehub/icons-static-svg/icons/xiaomimimo.svg';
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
  | 'ai21'
  | 'arcee'
  | 'bytedance'
  | 'openai'
  | 'claude'
  | 'codex'
  | 'cohere'
  | 'copilot'
  | 'deepseek'
  | 'essentialai'
  | 'gemini'
  | 'gemma'
  | 'glm'
  | 'grok'
  | 'ibm'
  | 'inception'
  | 'kimi'
  | 'kwaipilot'
  | 'lmstudio'
  | 'meta'
  | 'minimax'
  | 'mistral'
  | 'nvidia'
  | 'nova'
  | 'openrouter'
  | 'qwen'
  | 'relace'
  | 'stepfun'
  | 'tencent'
  | 'upstage'
  | 'mimo'
  | 'runtime';

const buildPresentation = (
  key: ConversationPresentationKey,
): ConversationProviderPresentation => {
  switch (key) {
    case 'ai21':
      return {
        label: 'AI21',
        icon: buildProviderLogoImage(ai21Logo, 'AI21 logo'),
      };
    case 'arcee':
      return {
        label: 'Arcee',
        icon: buildProviderLogoImage(arceeLogo, 'Arcee logo'),
      };
    case 'bytedance':
      return {
        label: 'ByteDance',
        icon: buildProviderLogoImage(bytedanceLogo, 'ByteDance logo'),
      };
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
    case 'essentialai':
      return {
        label: 'Essential AI',
        icon: buildProviderLogoImage(essentialAiLogo, 'Essential AI logo'),
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
    case 'glm':
      return {
        label: 'GLM',
        icon: buildProviderLogoImage(glmLogo, 'GLM logo'),
      };
    case 'grok':
      return {
        label: 'Grok',
        icon: buildProviderLogoImage(grokLogo, 'Grok logo'),
      };
    case 'ibm':
      return {
        label: 'IBM Granite',
        icon: buildProviderLogoImage(ibmLogo, 'IBM logo'),
      };
    case 'inception':
      return {
        label: 'Inception',
        icon: buildProviderLogoImage(inceptionLogo, 'Inception logo'),
      };
    case 'kimi':
      return {
        label: 'Kimi',
        icon: buildProviderLogoImage(kimiLogo, 'Kimi logo'),
      };
    case 'kwaipilot':
      return {
        label: 'KwaiPilot',
        icon: buildProviderLogoImage(kwaiPilotLogo, 'KwaiPilot logo'),
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
    case 'minimax':
      return {
        label: 'MiniMax',
        icon: buildProviderLogoImage(miniMaxLogo, 'MiniMax logo'),
      };
    case 'mistral':
      return {
        label: 'Mistral',
        icon: buildProviderLogoImage(mistralLogo, 'Mistral logo'),
      };
    case 'nvidia':
      return {
        label: 'Nvidia',
        icon: buildProviderLogoImage(nvidiaLogo, 'Nvidia logo'),
      };
    case 'nova':
      return {
        label: 'Nova',
        icon: buildProviderLogoImage(novaLogo, 'Nova logo'),
      };
    case 'openrouter':
      return {
        label: 'OpenRouter',
        icon: buildProviderLogoImage(openRouterLogo, 'OpenRouter logo'),
      };
    case 'qwen':
      return {
        label: 'Qwen',
        icon: buildProviderLogoImage(qwenLogo, 'Qwen logo'),
      };
    case 'relace':
      return {
        label: 'Relace',
        icon: buildProviderLogoImage(relaceLogo, 'Relace logo'),
      };
    case 'stepfun':
      return {
        label: 'Stepfun',
        icon: buildProviderLogoImage(stepfunLogo, 'Stepfun logo'),
      };
    case 'tencent':
      return {
        label: 'Tencent',
        icon: buildProviderLogoImage(tencentLogo, 'Tencent logo'),
      };
    case 'upstage':
      return {
        label: 'Upstage',
        icon: buildProviderLogoImage(upstageLogo, 'Upstage logo'),
      };
    case 'mimo':
      return {
        label: 'MiMo',
        icon: buildProviderLogoImage(xiaomiMiMoLogo, 'MiMo logo'),
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

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasModelToken = (value: string, ...tokens: string[]) =>
  tokens.some((token) =>
    new RegExp(
      `(?:^|[~/\\s:_-])${escapeRegExp(token)}(?:$|[~/\\s:_-])`,
      'i',
    ).test(value),
  );

const extractModelVendorSegment = (value: string) => {
  const normalized = value.replace(/^~/, '');
  const slashIndex = normalized.indexOf('/');
  if (slashIndex <= 0) {
    return '';
  }
  return normalized.slice(0, slashIndex).toLowerCase();
};

const FALLBACK_VENDOR_LABELS: Record<string, string> = {
  ai21: 'AI21',
  'arcee-ai': 'Arcee',
  'bytedance-seed': 'ByteDance',
  essentialai: 'Essential AI',
  'ibm-granite': 'IBM Granite',
  inception: 'Inception',
  inclusionai: 'Inclusion AI',
  kwaipilot: 'KwaiPilot',
  minimax: 'MiniMax',
  moonshotai: 'Kimi',
  'nex-agi': 'Nex',
  nvidia: 'Nvidia',
  openrouter: 'OpenRouter',
  poolside: 'Poolside',
  'prime-intellect': 'Prime Intellect',
  rekaai: 'Reka',
  relace: 'Relace',
  sao10k: 'Sao10K',
  stepfun: 'Stepfun',
  tencent: 'Tencent',
  thedrummer: 'TheDrummer',
  upstage: 'Upstage',
  xiaomi: 'MiMo',
  'z-ai': 'GLM',
};

const resolveFallbackVendorLabel = (value: string) =>
  FALLBACK_VENDOR_LABELS[extractModelVendorSegment(value)] ?? undefined;

const MODEL_PRESENTATION_MATCHERS: Array<{
  key: ConversationPresentationKey;
  matches: (value: string) => boolean;
}> = [
  {
    key: 'ai21',
    matches: (value) => hasModelToken(value, 'ai21'),
  },
  {
    key: 'arcee',
    matches: (value) => hasModelToken(value, 'arcee', 'arcee-ai'),
  },
  {
    key: 'bytedance',
    matches: (value) => hasModelToken(value, 'bytedance', 'bytedance-seed'),
  },
  {
    key: 'codex',
    matches: (value) => hasModelToken(value, 'codex'),
  },
  {
    key: 'claude',
    matches: (value) => hasModelToken(value, 'claude'),
  },
  {
    key: 'essentialai',
    matches: (value) => hasModelToken(value, 'essentialai'),
  },
  {
    key: 'gemini',
    matches: (value) => hasModelToken(value, 'gemini'),
  },
  {
    key: 'gemma',
    matches: (value) => hasModelToken(value, 'gemma'),
  },
  {
    key: 'glm',
    matches: (value) => hasModelToken(value, 'glm', 'glmv', 'zhipu', 'z-ai'),
  },
  {
    key: 'grok',
    matches: (value) =>
      hasModelToken(value, 'grok', 'x-ai') || /\bxai\b/i.test(value),
  },
  {
    key: 'deepseek',
    matches: (value) => hasModelToken(value, 'deepseek'),
  },
  {
    key: 'ibm',
    matches: (value) => hasModelToken(value, 'ibm', 'ibm-granite', 'granite'),
  },
  {
    key: 'inception',
    matches: (value) => hasModelToken(value, 'inception'),
  },
  {
    key: 'kimi',
    matches: (value) => hasModelToken(value, 'moonshot', 'moonshotai', 'kimi'),
  },
  {
    key: 'kwaipilot',
    matches: (value) => hasModelToken(value, 'kwaipilot', 'kat-coder'),
  },
  {
    key: 'minimax',
    matches: (value) => hasModelToken(value, 'minimax'),
  },
  {
    key: 'nvidia',
    matches: (value) => hasModelToken(value, 'nvidia', 'nemotron'),
  },
  {
    key: 'openrouter',
    matches: (value) => hasModelToken(value, 'openrouter'),
  },
  {
    key: 'qwen',
    matches: (value) => hasModelToken(value, 'qwen'),
  },
  {
    key: 'relace',
    matches: (value) => hasModelToken(value, 'relace'),
  },
  {
    key: 'cohere',
    matches: (value) =>
      hasModelToken(value, 'cohere', 'command', 'commanda', 'aya'),
  },
  {
    key: 'stepfun',
    matches: (value) => hasModelToken(value, 'stepfun'),
  },
  {
    key: 'tencent',
    matches: (value) => hasModelToken(value, 'tencent', 'hunyuan', 'hy3'),
  },
  {
    key: 'upstage',
    matches: (value) => hasModelToken(value, 'upstage'),
  },
  {
    key: 'mimo',
    matches: (value) => hasModelToken(value, 'xiaomi', 'mimo'),
  },
  {
    key: 'nova',
    matches: (value) => hasModelToken(value, 'nova', 'amazon', 'aws'),
  },
  {
    key: 'mistral',
    matches: (value) => hasModelToken(value, 'mistral'),
  },
  {
    key: 'meta',
    matches: (value) => hasModelToken(value, 'meta', 'meta-llama', 'llama'),
  },
  {
    key: 'openai',
    matches: (value) => hasModelToken(value, 'openai', 'gpt', 'o1', 'o3', 'o4'),
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

  const fallbackVendorLabel = resolveFallbackVendorLabel(normalizedModel);
  if (fallbackVendorLabel) {
    return {
      label: fallbackVendorLabel,
      icon: buildPresentation('runtime').icon,
    };
  }

  return buildPresentation(resolveProviderPresentationKey(provider, model));
};
