export type FlowResumeState = {
  stepPath: number[];
  loopStack: Array<{ loopStepPath: number[]; iteration: number }>;
  agentConversations: Record<string, string>;
  agentThreads: Record<string, string>;
};
