export type FlowResumeState = {
  stepPath: number[];
  loopStack: Array<{ loopStepPath: number[]; iteration: number }>;
  workingFolder?: string;
  agentConversations: Record<string, string>;
  agentWorkingFolders?: Record<string, string>;
  agentThreads: Record<string, string>;
};
