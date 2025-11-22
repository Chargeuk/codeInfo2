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
