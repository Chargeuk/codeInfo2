import type { FlowRunStartResult } from './types.js';
import type { FlowJsonObject, FlowJsonValue } from './types.js';

export type FlowPendingLoopControl = {
  kind: 'continue';
  loopStepPath: number[];
};

export type FlowLoopExit = {
  loopStepPath: number[];
  iteration: number;
  reason: 'break' | 'max_iterations';
};

export type FlowRestartReconciliation = {
  status: 'interrupted';
  reconciledAt: string;
  resumeStepPath: number[];
  interruptedSubflowCount: number;
  interruptedWaveRunningCount: number;
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
  instanceId?: string;
  waveInvocationId?: string;
  targetId?: string;
  workingFolder?: string;
  input?: FlowJsonObject;
  inputHash?: string;
  title?: string;
};

export type FlowSubflowWaveJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'not_applicable';

export type FlowSubflowWaveProgress = {
  stepPath: number[];
  label?: string;
  expected: number;
  running: number;
  completed: number;
  failed: number;
  stopped: number;
  notApplicable: number;
  jobs: Array<{
    instanceId: string;
    flowName: string;
    targetId?: string;
    conversationId?: string;
    reason?: string;
    title: string;
    status: FlowSubflowWaveJobStatus;
  }>;
  updatedAt: string;
};

export type FlowGitHubReviewContext = {
  executionId?: string;
  prNumber?: number;
  storyNumber?: string;
  branchName?: string;
  selectorPath?: string;
  handoffPath?: string;
  phase?: 'opened' | 'fetched' | 'skipped';
  selectorPublicationPending?: boolean;
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
  continuedAfterFailure?: boolean;
  githubReviewContext?: FlowGitHubReviewContext;
};

export type FlowResumeState = {
  executionId: string;
  waveInvocationGeneration?: number;
  stepPath: number[];
  loopStack: Array<{ loopStepPath: number[]; iteration: number }>;
  lastLoopExit?: FlowLoopExit;
  restartReconciliation?: FlowRestartReconciliation;
  pendingLoopControl?: FlowPendingLoopControl;
  activeSubflows?: FlowActiveSubflow[];
  subflowWaveProgress?: FlowSubflowWaveProgress;
  terminalOutcome?: 'not_applicable';
  runLifecycle?: {
    status: 'running' | 'ok' | 'stopped' | 'failed' | 'orphaned';
    updatedAt: string;
  };
  codexReviewModelId?: string;
  workingFolder?: string;
  input?: FlowJsonObject;
  inputHash?: string;
  values?: Record<string, FlowJsonValue>;
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
