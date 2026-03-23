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
  ensureCopilotAuthFileStore,
  getCopilotConfigDirForHome,
  getCopilotHome,
  resolveCopilotCliPath,
} from '../config/copilotConfig.js';
import { resolveLogConfig } from '../logger.js';
import { hasCopilotEnvToken } from '../providers/copilotReadiness.js';
import {
  createCopilotAlreadyAuthenticatedResponse,
  createCopilotCompletedResponse,
  createCopilotCompletionPendingResponse,
  createCopilotFailedResponse,
  createCopilotUnavailableBeforeStartResponse,
  runCopilotDeviceAuth,
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
}): Promise<{
  state: 'already_authenticated' | 'unauthenticated';
  reason?: string;
}> {
  if (hasCopilotEnvToken(params.deps.env ?? process.env)) {
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
    return authStatus.isAuthenticated
      ? { state: 'already_authenticated' }
      : { state: 'unauthenticated' };
  } catch {
    return {
      state: 'unauthenticated',
      reason: 'copilot connectivity unavailable',
    };
  } finally {
    await runtime.stop().catch(() => []);
  }
}

export function createCopilotDeviceAuthRouter(
  deps: Deps = {
    getCopilotHome,
    getCopilotConfigDirForHome,
    ensureCopilotAuthFileStore,
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
      return res.status(200).json(cachedState);
    }

    const existingAuth = await resolveExistingAuthState({
      deps,
      copilotHome: targetCopilotHome,
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

        void deviceAuth.completion.then(({ result }) => {
          deviceAuthStateByHome.set(targetCopilotHome, result);
        });

        return responseState;
      },
    );

    const deviceAuth = await deviceAuthPromise;
    return res.status(200).json(deviceAuth);
  });

  return router;
}
