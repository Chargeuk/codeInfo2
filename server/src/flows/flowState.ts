export type FlowResumeState = {
  stepPath: number[];
  loopStack: Array<{ stepPath: number[]; iteration: number }>;
  agentConversations: Record<string, string>;
  agentThreads: Record<string, string>;
};
