import type { releaseConversationLock } from '../agents/runLock.js';
import type { cleanupInflight } from '../chat/inflightRegistry.js';
import type { ChatInterface } from '../chat/interfaces/ChatInterface.js';
import type { ListReposResult } from '../lmstudio/toolService.js';

export type FlowRunErrorCode =
  | 'FLOW_NOT_FOUND'
  | 'FLOW_INVALID'
  | 'FLOW_INVALID_NAME'
  | 'INVALID_REQUEST'
  | 'CONVERSATION_ARCHIVED'
  | 'RUN_IN_PROGRESS'
  | 'CODEX_UNAVAILABLE'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_PROVIDER'
  | 'WORKING_FOLDER_INVALID'
  | 'WORKING_FOLDER_NOT_FOUND'
  | 'WORKING_FOLDER_UNAVAILABLE'
  | 'WORKING_FOLDER_REPOSITORY_UNAVAILABLE'
  | 'AGENT_NOT_FOUND'
  | 'AGENT_MISMATCH'
  | 'COMMAND_INVALID'
  | 'UNSUPPORTED_STEP'
  | 'NO_STEPS'
  | 'CONTINUE_OUTSIDE_LOOP';

export type FlowRunError = {
  code: FlowRunErrorCode;
  reason?: string;
  causeCode?: string;
};

export type FlowRunStartParams = {
  flowName: string;
  sourceId?: string;
  flowPath?: string[];
  conversationId?: string;
  retryOwnershipId?: string;
  working_folder?: string;
  resumeStepPath?: number[];
  customTitle?: string;
  source: 'REST' | 'MCP';
  inflightId?: string;
  chatFactory?: FlowChatFactory;
  listIngestedRepositories?: () => Promise<ListReposResult>;
  onOwnershipReady?: (params: {
    conversationId: string;
    runToken: string;
  }) => Promise<void> | void;
  onAsyncBegin?: (params: {
    conversationId: string;
    runToken: string;
    executionId: string;
    inflightId: string;
  }) => Promise<void> | void;
  onStopUnwindCheckpoint?: (params: {
    checkpoint: string;
    conversationId: string;
    detail?: string;
  }) => void;
  cleanupInflightFn?: typeof cleanupInflight;
  releaseConversationLockFn?: typeof releaseConversationLock;
};

export type FlowRunStartResult = {
  flowName: string;
  conversationId: string;
  inflightId: string;
  providerId: string;
  modelId: string;
  warnings?: string[];
};

export type FlowAgentState = {
  conversationId: string;
  threadId?: string;
  workingFolder?: string;
  providerId?: string;
  modelId?: string;
  requestedProviderId?: string;
  endpointId?: string;
};

export type FlowExecutionRuntimeState = Map<string, FlowAgentState>;

export type FlowChatFactory = (
  provider: string,
  deps?: Record<string, unknown>,
) => ChatInterface;

// Story 60: Flow step type exports for runtime use
export type {
  FlowIfStep,
  FlowWaitStep,
  FlowGitHubOpenPrStep,
  FlowGitHubFetchReviewsStep,
  FlowGitHubClosePrStep,
} from './flowSchema.js';
