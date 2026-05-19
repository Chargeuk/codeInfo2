type FlowSummary = {
  name: string;
  description?: string;
  sourceId?: string;
  disabled?: boolean;
  warnings?: string[];
};

export const reconcileFlowDetailsCache = <T extends { disabled?: boolean }>(
  flowDetailsByKey: Record<string, T | undefined>,
  flows: FlowSummary[],
) => {
  let nextFlowDetailsByKey: Record<string, T | undefined> | undefined;

  for (const flow of flows) {
    const flowKey = `${flow.name}::${flow.sourceId ?? 'local'}`;
    const cachedDetails = flowDetailsByKey[flowKey];
    if (!cachedDetails) continue;

    const summaryDisabled = flow.disabled;
    const cachedDisabled = cachedDetails.disabled;
    const staleDisabledDetails =
      summaryDisabled === false && cachedDisabled === true;
    const staleEnabledDetails =
      summaryDisabled === true && cachedDisabled === false;
    if (!staleDisabledDetails && !staleEnabledDetails) continue;
    if (!nextFlowDetailsByKey) {
      nextFlowDetailsByKey = { ...flowDetailsByKey };
    }
    delete nextFlowDetailsByKey[flowKey];
  }

  return nextFlowDetailsByKey ?? flowDetailsByKey;
};
