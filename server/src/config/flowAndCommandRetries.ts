const DEFAULT_FLOW_AND_COMMAND_RETRIES = 5;

/**
 * FLOW_AND_COMMAND_RETRIES is the total number of attempts,
 * including the initial attempt.
 */
export const resolveFlowAndCommandRetries = (
  env: Record<string, string | undefined> = process.env,
): number => {
  const raw = env.FLOW_AND_COMMAND_RETRIES;
  if (!raw) return DEFAULT_FLOW_AND_COMMAND_RETRIES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_FLOW_AND_COMMAND_RETRIES;
  }
  return parsed;
};

export const getFlowAndCommandRetries = (): number =>
  resolveFlowAndCommandRetries();
