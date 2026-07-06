import type { FlowRunStartResult } from './types.js';

export type FlowPendingLoopControl = {
  kind: 'continue';
  loopStepPath: number[];
};

export type FreshRunRetryOwnershipCompletion = {
  retryOwnershipId: string;
  sourceId?: string;
  launchSignature: string;
  completedAt: number;
  result: FlowRunStartResult;
};

export type FlowActiveSubflow = {
  stepPath: number[];
  flowName: string;
  conversationId: string;
  runToken: string;
  title?: string;
};

export type FlowResumeState = {
  executionId: string;
  stepPath: number[];
  loopStack: Array<{ loopStepPath: number[]; iteration: number }>;
  pendingLoopControl?: FlowPendingLoopControl;
  activeSubflows?: FlowActiveSubflow[];
  codexReviewModelId?: string;
  workingFolder?: string;
  agentConversations: Record<string, string>;
  agentWorkingFolders?: Record<string, string>;
  agentThreads: Record<string, string>;
  agentProviders?: Record<string, string>;
  agentModels?: Record<string, string>;
  agentRequestedProviders?: Record<string, string>;
  agentEndpointIds?: Record<string, string>;
  retryOwnershipCompletion?: FreshRunRetryOwnershipCompletion;
};
