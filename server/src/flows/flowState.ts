export type FlowPendingLoopControl = {
  kind: 'continue';
  loopStepPath: number[];
};

export type FlowResumeState = {
  executionId: string;
  stepPath: number[];
  loopStack: Array<{ loopStepPath: number[]; iteration: number }>;
  pendingLoopControl?: FlowPendingLoopControl;
  activeSubflow?: {
    stepPath: number[];
    flowName: string;
    conversationId: string;
    runToken: string;
    title?: string;
  };
  workingFolder?: string;
  agentConversations: Record<string, string>;
  agentWorkingFolders?: Record<string, string>;
  agentThreads: Record<string, string>;
  agentProviders?: Record<string, string>;
  agentModels?: Record<string, string>;
  agentRequestedProviders?: Record<string, string>;
};
