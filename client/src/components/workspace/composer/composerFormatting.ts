import type {
  ChatAgentFlagDescriptor,
  ChatAgentFlagValue,
} from '@codeinfo2/common';
import { getConversationProviderPresentation } from '../../chat/conversationRowFormatting';

const cleanText = (value?: string | null) => {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
};

export const getComposerProviderPresentation = (
  provider?: string | null,
  model?: string | null,
) => {
  const presentation = getConversationProviderPresentation(provider, model);

  if (presentation.label === 'Codex') {
    return { ...presentation, label: 'OpenAI Codex' };
  }
  if (presentation.label === 'Copilot') {
    return { ...presentation, label: 'GitHub Copilot' };
  }

  return presentation;
};

export const getWorkingFolderName = (path?: string | null) => {
  const cleaned = cleanText(path);
  if (!cleaned) return '';
  const segments = cleaned.split(/[\\/]+/).filter(Boolean);
  return segments.at(-1) ?? cleaned;
};

export const formatThinkingModeLabel = (value?: string | null) => {
  const cleaned = cleanText(value);
  if (!cleaned) return 'Thinking';
  return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)} thinking`;
};

export const formatComposerModelLabel = (
  thinkingMode?: string | null,
  model?: string | null,
) => {
  const cleanedModel = cleanText(model);
  if (!cleanedModel) return formatThinkingModeLabel(thinkingMode);
  return `${cleanedModel} / ${formatThinkingModeLabel(thinkingMode)}`;
};

const formatOptionValue = (value: ChatAgentFlagValue) => {
  if (typeof value === 'boolean') {
    return value ? 'On' : 'Off';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

export type ComposerOptionSummaryLine = {
  label: string;
  value: string;
};

export const buildComposerOptionSummary = (
  descriptors: ChatAgentFlagDescriptor[],
  values: Record<string, ChatAgentFlagValue | undefined>,
) => {
  const active: ComposerOptionSummaryLine[] = [];

  descriptors.forEach((descriptor) => {
    const currentValue = values[descriptor.key] ?? descriptor.resolvedDefault;
    if (currentValue === undefined) return;
    if (currentValue === descriptor.resolvedDefault) return;
    active.push({
      label: descriptor.label,
      value: formatOptionValue(currentValue),
    });
  });

  return active;
};

export const buildComposerOptionValueSummary = (
  descriptors: ChatAgentFlagDescriptor[],
  values: Record<string, ChatAgentFlagValue | undefined>,
) => {
  const active = buildComposerOptionSummary(descriptors, values);
  if (active.length === 0) return 'Default';
  return active.map((entry) => `${entry.label}: ${entry.value}`).join(' · ');
};
