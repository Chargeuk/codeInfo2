import type {
  AgentAvailabilityFallbackCandidate,
  AgentAvailabilityWarning,
  AgentDisabledReason,
} from './availability.js';

export type AgentSummary = {
  name: string;
  description?: string;
  disabled?: boolean;
  warnings?: string[];
};

export type AgentDetails = {
  name: string;
  description?: string;
  disabled: boolean;
  warnings: AgentAvailabilityWarning[];
  fallbackCandidates: AgentAvailabilityFallbackCandidate[];
  disabledReason?: AgentDisabledReason;
  requestedProviderId?: string;
  executionProviderId?: string;
};

export type DiscoveredAgent = AgentSummary & {
  home: string;
  configPath: string;
  descriptionPath?: string;
  systemPromptPath?: string;
};
