export type FlowPendingLoopControl = {
  kind: 'continue';
  loopStepPath: number[];
};

export type FlowResumeState = {
  executionId: string;
  stepPath: number[];
  loopStack: Array<{ loopStepPath: number[]; iteration: number }>;
  pendingLoopControl?: FlowPendingLoopControl;
  workingFolder?: string;
  agentConversations: Record<string, string>;
  agentWorkingFolders?: Record<string, string>;
  agentThreads: Record<string, string>;
};
