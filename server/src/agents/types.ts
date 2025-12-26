export type AgentSummary = {
  name: string;
  description?: string;
  disabled?: boolean;
  warnings?: string[];
};

export type DiscoveredAgent = AgentSummary & {
  home: string;
  configPath: string;
  descriptionPath?: string;
  systemPromptPath?: string;
};
