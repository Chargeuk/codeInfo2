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

export type FreshRunRetryOwnershipPending = {
  retryOwnershipId: string;
  sourceId?: string;
  launchSignature: string;
  result: FlowRunStartResult;
};

export type FlowActiveSubflow = {
  stepPath: number[];
  flowName: string;
  conversationId: string;
  runToken: string;
  title?: string;
};

export type FlowGitHubReviewContext = {
  executionId?: string;
  prNumber?: number;
  storyNumber?: string;
  branchName?: string;
  selectorPath?: string;
  handoffPath?: string;
  phase?: 'opened' | 'fetched' | 'skipped';
  retryAttempt?: number;
  retryStepPath?: number[];
  warningMessage?: string;
};

export type FlowWaitState = {
  kind?: 'authored_wait' | 'review_retry';
  executionId: string;
  stepPath: number[];
  loopStack: Array<{ loopStepPath: number[]; iteration: number }>;
  activeSubflows?: FlowActiveSubflow[];
  workingFolder?: string;
  sourceId?: string;
  resumeAt: number;
  githubReviewContext?: FlowGitHubReviewContext;
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
  wait?: FlowWaitState;
  githubReviewContext?: FlowGitHubReviewContext;
  retryOwnershipPending?: FreshRunRetryOwnershipPending;
  retryOwnershipCompletion?: FreshRunRetryOwnershipCompletion;
};
