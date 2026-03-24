import { execSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';

import {
  Router,
  json,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import {
  CopilotLifecycle,
  type CopilotLifecycleOptions,
} from '../chat/copilotLifecycle.js';
import {
  ensureCopilotAuthHomeCompatibility,
  ensureCopilotAuthFileStore,
  ensureCopilotPlaintextTokenStorage,
  getCopilotConfigDirForHome,
  getCopilotHome,
  inspectCopilotAuthLocations,
  resolveCopilotCliPath,
} from '../config/copilotConfig.js';
import { baseLogger, resolveLogConfig } from '../logger.js';
import { hasCopilotEnvToken } from '../providers/copilotReadiness.js';
import {
  createCopilotAlreadyAuthenticatedResponse,
  createCopilotCompletedResponse,
  createCopilotCompletionPendingResponse,
  createCopilotFailedResponse,
  createCopilotUnavailableBeforeStartResponse,
  runCopilotDeviceAuth,
  type CopilotDeviceAuthCompletion,
  type CopilotDeviceAuthCompletionPending,
  type CopilotDeviceAuthResultWithCompletion,
  type CopilotDeviceAuthState,
  type CopilotDeviceAuthVerificationReady,
} from '../utils/copilotDeviceAuth.js';
import { getOrCreateSingleFlight } from '../utils/singleFlight.js';

type DeviceAuthBody = Record<string, unknown>;

type Runtime = Pick<CopilotLifecycle, 'start' | 'stop' | 'getAuthStatus'>;

type CompletionRefreshState =
  | { status: 'completion_pending' }
  | { status: 'completed' }
  | { status: 'already_authenticated' }
  | { status: 'failed'; reason: string }
  | { status: 'unavailable_before_start'; reason: string };

type Deps = {
  getCopilotHome: typeof getCopilotHome;
  getCopilotConfigDirForHome: typeof getCopilotConfigDirForHome;
  ensureCopilotAuthFileStore: typeof ensureCopilotAuthFileStore;
  ensureCopilotPlaintextTokenStorage?: typeof ensureCopilotPlaintextTokenStorage;
  ensureCopilotAuthHomeCompatibility?: typeof ensureCopilotAuthHomeCompatibility;
  inspectCopilotAuthLocations?: typeof inspectCopilotAuthLocations;
  runCopilotDeviceAuth: typeof runCopilotDeviceAuth;
  resolveCopilotCli: typeof resolveCopilotCli;
  createRuntime: (options: CopilotLifecycleOptions) => Runtime;
  readDeviceAuthState?: (params: {
    copilotHome: string;
  }) => Promise<CompletionRefreshState>;
  env?: NodeJS.ProcessEnv;
};

const invalidRequestBodyMessage = 'request body must be an empty JSON object';
const invalidRequestTooLargeMessage = 'request body exceeds maximum size';
const invalidRequestJsonMessage = 'request body must be valid JSON';
const reusableAuthMissingMessage =
  'copilot login completed but reusable authentication was not detected';

function logCopilotAuthDiagnostics(
  tag: string,
  context: Record<string, unknown>,
): void {
  baseLogger.info(context, tag);
}

function resolveCopilotCli(
  env: NodeJS.ProcessEnv = process.env,
): { available: boolean; reason?: string; cliPath?: string } {
  const configuredCliPath = resolveCopilotCliPath(undefined, env);
  if (configuredCliPath) {
    try {
      accessSync(configuredCliPath, constants.X_OK);
      return { available: true, cliPath: configuredCliPath };
    } catch (error) {
      return {
        available: false,
        cliPath: configuredCliPath,
        reason:
          error instanceof Error
            ? error.message
            : `${configuredCliPath} is not executable`,
      };
    }
  }

  try {
    const detectedPath = execSync('command -v copilot', {
      encoding: 'utf8',
    }).trim();
    if (!detectedPath) {
      return { available: false, reason: 'copilot not found' };
    }
    return { available: true, cliPath: detectedPath };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : 'copilot not found',
    };
  }
}

function parseDeviceAuthBody(body: unknown): DeviceAuthBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(invalidRequestBodyMessage);
  }
  const candidate = body as DeviceAuthBody;
  if (Object.keys(candidate).length > 0) {
    throw new Error(invalidRequestBodyMessage);
  }
  return candidate;
}

function isPendingState(
  state: CopilotDeviceAuthState | undefined,
): state is CopilotDeviceAuthCompletionPending {
  return state?.state === 'completion_pending';
}

function toPendingResponse(
  source:
    | CopilotDeviceAuthVerificationReady
    | CopilotDeviceAuthCompletionPending,
): CopilotDeviceAuthCompletionPending {
  return createCopilotCompletionPendingResponse(source);
}

function toDeviceAuthResponseState(
  state: CopilotDeviceAuthResultWithCompletion,
): CopilotDeviceAuthState {
  const { completion, ...response } = state;
  void completion;
  return response;
}

async function resolveExistingAuthState(params: {
  deps: Deps;
  copilotHome: string;
  reason: string;
}): Promise<{
  state: 'already_authenticated' | 'unauthenticated';
  reason?: string;
}> {
  const diagnostics = await (
    params.deps.inspectCopilotAuthLocations ?? inspectCopilotAuthLocations
  )(params.copilotHome, params.deps.env);
  if (hasCopilotEnvToken(params.deps.env ?? process.env)) {
    logCopilotAuthDiagnostics('DEV-0000051:T9:copilot_auth_runtime_check', {
      reason: params.reason,
      authStatus: 'env-token',
      diagnostics,
    });
    return { state: 'already_authenticated' };
  }

  const cliStatus = params.deps.resolveCopilotCli(params.deps.env);
  if (!cliStatus.available) {
    return {
      state: 'unauthenticated',
      reason: cliStatus.reason ?? 'copilot not found',
    };
  }

  const runtime = params.deps.createRuntime({
    copilotHome: params.copilotHome,
    env: params.deps.env,
  });

  try {
    await runtime.start();
    const authStatus = await runtime.getAuthStatus();
    logCopilotAuthDiagnostics('DEV-0000051:T9:copilot_auth_runtime_check', {
      reason: params.reason,
      authStatus: {
        isAuthenticated: authStatus.isAuthenticated,
        authType: authStatus.authType,
        statusMessage: authStatus.statusMessage,
      },
      diagnostics,
    });
    return authStatus.isAuthenticated
      ? { state: 'already_authenticated' }
      : { state: 'unauthenticated' };
  } catch {
    logCopilotAuthDiagnostics('DEV-0000051:T9:copilot_auth_runtime_check', {
      reason: params.reason,
      authStatus: 'runtime-error',
      diagnostics,
    });
    return {
      state: 'unauthenticated',
      reason: 'copilot connectivity unavailable',
    };
  } finally {
    await runtime.stop().catch(() => []);
  }
}

async function resolveDeviceAuthCompletionState(params: {
  deps: Deps;
  copilotHome: string;
  result: CopilotDeviceAuthCompletion['result'];
}): Promise<CopilotDeviceAuthCompletion['result']> {
  if (params.result.state !== 'completed') {
    return params.result;
  }

  const authState = await resolveExistingAuthState({
    deps: params.deps,
    copilotHome: params.copilotHome,
    reason: 'post-device-auth-completion',
  });

  if (authState.state === 'already_authenticated') {
    return params.result;
  }

  return createCopilotFailedResponse(
    authState.reason ?? reusableAuthMissingMessage,
  );
}

export function createCopilotDeviceAuthRouter(
  deps: Deps = {
    getCopilotHome,
    getCopilotConfigDirForHome,
    ensureCopilotAuthFileStore,
    ensureCopilotPlaintextTokenStorage,
    ensureCopilotAuthHomeCompatibility,
    inspectCopilotAuthLocations,
    runCopilotDeviceAuth,
    resolveCopilotCli,
    createRuntime: (options) => new CopilotLifecycle(options),
    env: process.env,
  },
) {
  const router = Router();
  const deviceAuthInFlightByHome = new Map<
    string,
    Promise<Awaited<ReturnType<typeof runCopilotDeviceAuth>>>
  >();
  const deviceAuthStateByHome = new Map<string, CopilotDeviceAuthState>();
  const { maxClientBytes } = resolveLogConfig();

  router.use(json({ limit: `${maxClientBytes}b`, strict: false }));
  router.use(
    (
      err: { type?: string } | undefined,
      _req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      if (err?.type === 'entity.too.large') {
        return res.status(400).json({
          error: 'invalid_request',
          message: invalidRequestTooLargeMessage,
        });
      }
      if (err?.type === 'entity.parse.failed') {
        return res.status(400).json({
          error: 'invalid_request',
          message: invalidRequestJsonMessage,
        });
      }
      return next(err);
    },
  );

  router.post('/device-auth', async (req, res) => {
    try {
      parseDeviceAuthBody(req.body);
    } catch (error) {
      return res.status(400).json({
        error: 'invalid_request',
        message: (error as Error).message,
      });
    }

    const targetCopilotHome = deps.getCopilotHome(deps.env);
    const targetConfigDir = deps.getCopilotConfigDirForHome(targetCopilotHome);
    const compatibility = await (
      deps.ensureCopilotAuthHomeCompatibility ?? ensureCopilotAuthHomeCompatibility
    )(targetCopilotHome, deps.env);

    logCopilotAuthDiagnostics('DEV-0000051:T9:copilot_auth_home_alignment', {
      action: compatibility.action,
      error: compatibility.error,
      diagnostics: compatibility.diagnostics,
    });

    let plaintextStorage:
      | {
          changed: boolean;
          configPath: string;
        }
      | undefined;
    try {
      plaintextStorage = await (
        deps.ensureCopilotPlaintextTokenStorage ??
        ensureCopilotPlaintextTokenStorage
      )(targetCopilotHome);
    } catch {
      return res
        .status(200)
        .json(
          createCopilotUnavailableBeforeStartResponse(
            'copilot config persistence unavailable',
          ),
        );
    }

    logCopilotAuthDiagnostics('DEV-0000051:T9:copilot_auth_storage_mode', {
      changed: plaintextStorage.changed,
      configPath: plaintextStorage.configPath,
      storageMode: 'plaintext',
    });

    try {
      await deps.ensureCopilotAuthFileStore(targetConfigDir);
    } catch {
      return res
        .status(200)
        .json(
          createCopilotUnavailableBeforeStartResponse(
            'copilot config persistence unavailable',
          ),
        );
    }

    const cachedState = deviceAuthStateByHome.get(targetCopilotHome);
    if (cachedState) {
      if (isPendingState(cachedState)) {
        const existingAuth = await resolveExistingAuthState({
          deps,
          copilotHome: targetCopilotHome,
          reason: 'cached-completion-pending-refresh',
        });
        if (existingAuth.state === 'already_authenticated') {
          const completed = createCopilotCompletedResponse();
          deviceAuthStateByHome.set(targetCopilotHome, completed);
          return res.status(200).json(completed);
        }
        if (deps.readDeviceAuthState) {
          const refreshed = await deps.readDeviceAuthState({
            copilotHome: targetCopilotHome,
          });
          if (refreshed.status === 'completed') {
            const completed = createCopilotCompletedResponse();
            deviceAuthStateByHome.set(targetCopilotHome, completed);
            return res.status(200).json(completed);
          }
          if (refreshed.status === 'already_authenticated') {
            const completed = createCopilotCompletedResponse();
            deviceAuthStateByHome.set(targetCopilotHome, completed);
            return res.status(200).json(completed);
          }
          if (refreshed.status === 'completion_pending') {
            return res.status(200).json(cachedState);
          }
          if (refreshed.status === 'failed') {
            const failed = createCopilotFailedResponse(refreshed.reason);
            deviceAuthStateByHome.set(targetCopilotHome, failed);
            return res.status(200).json(failed);
          }
          const unavailable = createCopilotUnavailableBeforeStartResponse(
            refreshed.reason,
          );
          deviceAuthStateByHome.set(targetCopilotHome, unavailable);
          return res.status(200).json(unavailable);
        }
      }
      // Terminal states should not poison later retries. A fresh request should
      // re-check current auth/runtime readiness and start a new device flow if
      // the previous code can no longer complete successfully.
      deviceAuthStateByHome.delete(targetCopilotHome);
    }

    const existingAuth = await resolveExistingAuthState({
      deps,
      copilotHome: targetCopilotHome,
      reason: 'pre-device-auth-start',
    });
    if (existingAuth.state === 'already_authenticated') {
      return res.status(200).json(createCopilotAlreadyAuthenticatedResponse());
    }

    const cliStatus = deps.resolveCopilotCli(deps.env);
    if (!cliStatus.available) {
      return res
        .status(200)
        .json(
          createCopilotUnavailableBeforeStartResponse(
            existingAuth.reason ?? cliStatus.reason ?? 'copilot not found',
          ),
        );
    }

    const singleFlightKey = `device-auth:${targetCopilotHome}`;
    const { promise: deviceAuthPromise } = getOrCreateSingleFlight(
      deviceAuthInFlightByHome,
      singleFlightKey,
      async () => {
        const deviceAuth = await deps.runCopilotDeviceAuth({
          copilotHome: targetCopilotHome,
          cliPath: cliStatus.cliPath,
          env: deps.env,
        });
        const responseState = toDeviceAuthResponseState(deviceAuth);
        if (responseState.state === 'verification_ready') {
          deviceAuthStateByHome.set(
            targetCopilotHome,
            toPendingResponse(responseState),
          );
        } else {
          deviceAuthStateByHome.set(targetCopilotHome, responseState);
        }

        void deviceAuth.completion.then(async ({ result }) => {
          const verifiedResult = await resolveDeviceAuthCompletionState({
            deps,
            copilotHome: targetCopilotHome,
            result,
          });
          deviceAuthStateByHome.set(targetCopilotHome, verifiedResult);
        });

        return responseState;
      },
    );

    const deviceAuth = await deviceAuthPromise;
    return res.status(200).json(deviceAuth);
  });

  return router;
}
