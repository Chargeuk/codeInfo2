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
    title: string;
    status: FlowSubflowWaveJobStatus;
  }>;
  updatedAt: string;
};

export type FlowResumeState = {
  executionId: string;
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
  retryOwnershipCompletion?: FreshRunRetryOwnershipCompletion;
};
