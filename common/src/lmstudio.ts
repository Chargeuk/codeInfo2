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
};

export type CodexDefaults = {
  sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
  approvalPolicy: 'untrusted' | 'on-request' | 'on-failure' | 'never';
  modelReasoningEffort: 'low' | 'medium' | 'high' | 'xhigh';
  networkAccessEnabled: boolean;
  webSearchEnabled: boolean;
};

export type ChatProviderInfo = {
  id: string;
  label: string;
  available: boolean;
  toolsAvailable: boolean;
  reason?: string;
};

export type ChatModelsResponse = {
  provider: string;
  available: boolean;
  toolsAvailable: boolean;
  models: ChatModelInfo[];
  codexDefaults?: CodexDefaults;
  codexWarnings?: string[];
  reason?: string;
};
