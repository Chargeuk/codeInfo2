type AgentListEntry = {
  name: string;
  description?: string;
  disabled?: boolean;
  warnings?: string[];
};

export const reconcileAgentDetailsCache = <T extends { disabled?: boolean }>(
  agentDetailsByName: Record<string, T | undefined>,
  agents: AgentListEntry[],
) => {
  let nextAgentDetailsByName: Record<string, T | undefined> | undefined;

  for (const agent of agents) {
    const cachedDetails = agentDetailsByName[agent.name];
    if (!cachedDetails) continue;

    const summaryDisabled = agent.disabled;
    const cachedDisabled = cachedDetails.disabled;
    const staleDisabledDetails =
      summaryDisabled === false && cachedDisabled === true;
    const staleEnabledDetails =
      summaryDisabled === true && cachedDisabled === false;
    if (!staleDisabledDetails && !staleEnabledDetails) continue;
    if (!nextAgentDetailsByName) {
      nextAgentDetailsByName = { ...agentDetailsByName };
    }
    delete nextAgentDetailsByName[agent.name];
  }

  return nextAgentDetailsByName ?? agentDetailsByName;
};

export const isExecutePromptEnabled = (params: {
  selectedPromptEntry: { name?: string } | null;
  selectedAgentName: string;
  selectedAgentDisabled: boolean;
  startPending: boolean;
  persistenceUnavailable: boolean;
}) =>
  params.selectedPromptEntry !== null &&
  Boolean(params.selectedAgentName) &&
  !params.selectedAgentDisabled &&
  !params.startPending &&
  !params.persistenceUnavailable;
