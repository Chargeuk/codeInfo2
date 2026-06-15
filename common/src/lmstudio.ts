import type { ChatProviderId } from './api.js';

export type LmStudioModel = {
  modelKey: string;
  displayName: string;
  type: string;
  format?: string | null;
  path?: string | null;
  sizeBytes?: number | null;
  architecture?: string | null;
  paramsString?: string | null;
  maxContextLength?: number | null;
  vision?: boolean;
  trainedForToolUse?: boolean;
};

export type LmStudioStatusOk = {
  status: 'ok';
  baseUrl: string;
  models: LmStudioModel[];
};

export type LmStudioStatusError = {
  status: 'error';
  baseUrl: string;
  error: string;
};

export type LmStudioStatusResponse = LmStudioStatusOk | LmStudioStatusError;

export type ChatModelInfo = {
  key: string;
  displayName: string;
  type: string;
  endpointId?: string;
  // Required for Codex model entries in /chat/models payloads.
  supportedReasoningEfforts?: string[];
  // Required for Codex model entries in /chat/models payloads.
  defaultReasoningEffort?: string;
  flagOverrides?: ChatModelFlagOverride[];
};

export const CODEX_MODEL_REASONING_EFFORTS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const;

export type CodexModelReasoningEffort =
  (typeof CODEX_MODEL_REASONING_EFFORTS)[number];

export type CodexDefaults = {
  sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
  approvalPolicy: 'untrusted' | 'on-request' | 'on-failure' | 'never';
  modelReasoningEffort: CodexModelReasoningEffort;
  modelReasoningSummary?: 'auto' | 'concise' | 'detailed' | 'none';
  modelVerbosity?: 'low' | 'medium' | 'high';
  networkAccessEnabled: boolean;
  webSearchEnabled: boolean;
  webSearchMode?: 'disabled' | 'cached' | 'live';
};

export type ChatAgentFlagKey =
  | 'sandboxMode'
  | 'approvalPolicy'
  | 'modelReasoningEffort'
  | 'modelReasoningSummary'
  | 'modelVerbosity'
  | 'networkAccessEnabled'
  | 'webSearchMode'
  | 'toolAccess'
  | 'temperature'
  | 'maxTokens'
  | 'contextOverflowPolicy';

export type ChatAgentFlagValue = string | number | boolean;

export type ChatAgentFlagControlType = 'select' | 'boolean' | 'number';

export type ChatAgentFlagChoice = {
  value: ChatAgentFlagValue;
  label: string;
};

export type ChatModelFlagOverride = {
  key: ChatAgentFlagKey;
  resolvedDefault?: ChatAgentFlagValue;
  supportedValues?: ChatAgentFlagChoice[];
  min?: number;
  max?: number;
  integer?: boolean;
};

export type ChatAgentFlagDescriptor = {
  key: ChatAgentFlagKey;
  label: string;
  controlType: ChatAgentFlagControlType;
  editable: boolean;
  description?: string;
  seedDefault: ChatAgentFlagValue;
  resolvedDefault: ChatAgentFlagValue;
  supportedValues?: ChatAgentFlagChoice[];
  min?: number;
  max?: number;
  integer?: boolean;
};

export type ChatAgentFlags = Partial<
  Record<ChatAgentFlagKey, ChatAgentFlagValue>
>;

export type ChatProviderDefaultsSource =
  | 'request'
  | 'env'
  | 'config'
  | 'hardcoded'
  | 'fallback';

export type ChatProviderCompatibility = {
  codexDefaults?: CodexDefaults;
  codexWarnings?: string[];
};

export type ChatProviderInfo = {
  id: ChatProviderId;
  label: string;
  available: boolean;
  toolsAvailable: boolean;
  endpointOnly?: boolean;
  reason?: string;
  defaultModel?: string;
  defaultModelSource?: ChatProviderDefaultsSource;
  warnings?: string[];
  agentFlags?: ChatAgentFlagDescriptor[];
  compatibility?: ChatProviderCompatibility;
};

export type ChatProvidersResponse = {
  providers: ChatProviderInfo[];
  selectedProvider?: ChatProviderId;
  selectedModel?: string;
  selectedEndpointId?: string;
  fallbackApplied?: boolean;
  compatibility?: ChatProviderCompatibility;
  // Compatibility add-ons while Task 5 still consumes the Codex-first shape.
  codexDefaults?: CodexDefaults;
  codexWarnings?: string[];
};

export type ChatModelsResponse = {
  provider: ChatProviderId;
  available: boolean;
  toolsAvailable: boolean;
  models: ChatModelInfo[];
  providerInfo?: ChatProviderInfo;
  providers?: ChatProviderInfo[];
  agentFlags?: ChatAgentFlagDescriptor[];
  selectedEndpointId?: string;
  defaultModel?: string;
  defaultModelSource?: ChatProviderDefaultsSource;
  warnings?: string[];
  compatibility?: ChatProviderCompatibility;
  codexDefaults?: CodexDefaults;
  codexWarnings?: string[];
  reason?: string;
};

export const INGEST_ROOTS_SCHEMA_VERSION =
  '0000055-queued-repo-list-v1' as const;

// Shared repo-list rows use canonical repository identity in `id`.
// Display-facing labels stay in `name` so row identity remains stable.

export type ExternalIngestStatus =
  | 'ingesting'
  | 'completed'
  | 'cancelled'
  | 'error';

export type ExternalIngestPhase = 'queued' | 'scanning' | 'embedding';

export type IngestQueueState = 'waiting' | 'running' | 'cleanup-blocked';
