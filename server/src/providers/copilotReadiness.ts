import { CopilotLifecycle } from '../chat/copilotLifecycle.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';

export const TASK5_LOG_MARKER = 'story.0000051.task05.readiness_evaluated';

const COPILOT_CONNECTIVITY_REASON = 'copilot connectivity unavailable';
const COPILOT_AUTH_REASON = 'copilot authentication required';
const COPILOT_MODELS_REASON = 'copilot models unavailable';
const COPILOT_ENV_AUTH_KEYS = [
  'COPILOT_GITHUB_TOKEN',
  'GH_TOKEN',
  'GITHUB_TOKEN',
] as const;

export type CopilotReadinessStage =
  | 'connectivity'
  | 'authentication'
  | 'models'
  | 'tools'
  | 'ready';

export type CopilotReadinessAuthSource =
  | 'env-token'
  | 'sdk-status'
  | 'gh-cli'
  | 'unauthenticated';

export type CopilotReadinessRuntime = Pick<
  CopilotLifecycle,
  'start' | 'stop' | 'ping' | 'getAuthStatus' | 'listModels'
>;

export type CopilotReadinessResult = {
  available: boolean;
  toolsAvailable: boolean;
  reason?: string;
  blockingStage: CopilotReadinessStage;
  models: string[];
  authSource: CopilotReadinessAuthSource;
};

export type CopilotReadinessOptions = {
  createRuntime?: () => CopilotReadinessRuntime;
  env?: NodeJS.ProcessEnv;
  toolsAvailable: boolean;
  toolsReason?: string;
};

export function hasCopilotEnvToken(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return COPILOT_ENV_AUTH_KEYS.some((key) => {
    const value = env[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

const toCopilotModelKeys = (models: Array<{ id?: string | null }>) =>
  models
    .map((entry) => entry.id)
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

const logReadiness = (result: CopilotReadinessResult) => {
  const context = {
    blockingStage: result.blockingStage,
    surfacedReason: result.reason,
    available: result.available,
    toolsAvailable: result.toolsAvailable,
    authSource: result.authSource,
    modelCount: result.models.length,
  };

  append({
    level: 'info',
    message: TASK5_LOG_MARKER,
    timestamp: new Date().toISOString(),
    source: 'server',
    context,
  });
  baseLogger.info(context, TASK5_LOG_MARKER);
};

/**
 * Keep readiness precedence stable everywhere Story 51 surfaces Copilot:
 * connectivity first, authentication second, model-list success third, and
 * tool-surface availability last. The first blocking stage owns the reason.
 */
export async function resolveCopilotReadiness(
  options: CopilotReadinessOptions,
): Promise<CopilotReadinessResult> {
  const runtime = options.createRuntime?.() ?? new CopilotLifecycle();
  const envHasToken = hasCopilotEnvToken(options.env);
  let started = false;

  try {
    try {
      await runtime.start();
      started = true;
      await runtime.ping('provider-readiness');
    } catch {
      const result: CopilotReadinessResult = {
        available: false,
        toolsAvailable: false,
        reason: COPILOT_CONNECTIVITY_REASON,
        blockingStage: 'connectivity',
        models: [],
        authSource: envHasToken ? 'env-token' : 'unauthenticated',
      };
      logReadiness(result);
      return result;
    }

    const authStatus = await runtime.getAuthStatus().catch(() => ({
      isAuthenticated: false,
      authType: 'unknown',
    }));
    const authSource: CopilotReadinessAuthSource = envHasToken
      ? 'env-token'
      : authStatus.isAuthenticated
        ? authStatus.authType === 'gh-cli'
          ? 'gh-cli'
          : 'sdk-status'
        : 'unauthenticated';

    if (!envHasToken && !authStatus.isAuthenticated) {
      const result: CopilotReadinessResult = {
        available: false,
        toolsAvailable: false,
        reason: COPILOT_AUTH_REASON,
        blockingStage: 'authentication',
        models: [],
        authSource,
      };
      logReadiness(result);
      return result;
    }

    const models = toCopilotModelKeys(
      await runtime.listModels().catch(() => []),
    );
    if (models.length === 0) {
      const result: CopilotReadinessResult = {
        available: false,
        toolsAvailable: false,
        reason: COPILOT_MODELS_REASON,
        blockingStage: 'models',
        models,
        authSource,
      };
      logReadiness(result);
      return result;
    }

    const result: CopilotReadinessResult = {
      available: true,
      toolsAvailable: options.toolsAvailable,
      reason: options.toolsAvailable ? undefined : options.toolsReason,
      blockingStage: options.toolsAvailable ? 'ready' : 'tools',
      models,
      authSource,
    };
    logReadiness(result);
    return result;
  } finally {
    if (started) {
      await runtime.stop().catch(() => []);
    }
  }
}
