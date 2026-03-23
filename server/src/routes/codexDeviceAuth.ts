import { execSync } from 'node:child_process';

import {
  Router,
  json,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import { propagateAgentAuthFromPrimary } from '../agents/authSeed.js';
import { discoverAgents } from '../agents/discovery.js';
import {
  ensureCodexAuthFileStore,
  getCodexConfigPathForHome,
  getCodexHome,
} from '../config/codexConfig.js';
import { baseLogger, resolveLogConfig } from '../logger.js';
import { refreshCodexDetection } from '../providers/codexDetection.js';
import {
  createCodexAlreadyAuthenticatedResponse,
  createCodexCompletionPendingResponse,
  createCodexUnavailableBeforeStartResponse,
  runCodexDeviceAuth,
  type CodexDeviceAuthState,
} from '../utils/codexDeviceAuth.js';
import { getOrCreateSingleFlight } from '../utils/singleFlight.js';

type Deps = {
  discoverAgents: typeof discoverAgents;
  propagateAgentAuthFromPrimary: typeof propagateAgentAuthFromPrimary;
  refreshCodexDetection: typeof refreshCodexDetection;
  getCodexHome: typeof getCodexHome;
  ensureCodexAuthFileStore: typeof ensureCodexAuthFileStore;
  getCodexConfigPathForHome: typeof getCodexConfigPathForHome;
  runCodexDeviceAuth: typeof runCodexDeviceAuth;
  resolveCodexCli: typeof resolveCodexCli;
};

type DeviceAuthBody = Record<string, unknown>;

const invalidRequestBodyMessage = 'request body must be an empty JSON object';
const invalidRequestTooLargeMessage = 'request body exceeds maximum size';
const invalidRequestJsonMessage = 'request body must be valid JSON';
const T10_SUCCESS_LOG =
  '[DEV-0000037][T10] event=device_auth_contract_validated result=success';
const T10_ERROR_LOG =
  '[DEV-0000037][T10] event=device_auth_contract_validated result=error';
const T11_SUCCESS_LOG =
  '[DEV-0000037][T11] event=device_auth_concurrency_and_side_effects_completed result=success';
const T11_ERROR_LOG =
  '[DEV-0000037][T11] event=device_auth_concurrency_and_side_effects_completed result=error';

function resolveCodexCli(): { available: boolean; reason?: string } {
  try {
    const path = execSync('command -v codex', { encoding: 'utf8' }).trim();
    if (!path) {
      return { available: false, reason: 'codex not found' };
    }
    return { available: true };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : 'codex not found',
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

function toDeviceAuthResponseState(
  state: CodexDeviceAuthState,
): CodexDeviceAuthState {
  if ('completion' in state) {
    const { completion, ...response } = state;
    void completion;
    return response;
  }
  return state;
}

export function createCodexDeviceAuthRouter(
  deps: Deps = {
    discoverAgents,
    propagateAgentAuthFromPrimary,
    refreshCodexDetection,
    getCodexHome,
    ensureCodexAuthFileStore,
    getCodexConfigPathForHome,
    runCodexDeviceAuth,
    resolveCodexCli,
  },
) {
  const router = Router();
  const deviceAuthInFlightByHome = new Map<
    string,
    Promise<Awaited<ReturnType<typeof runCodexDeviceAuth>>>
  >();
  const deviceAuthStateByHome = new Map<string, CodexDeviceAuthState>();
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
        console.error(T10_ERROR_LOG, { code: 'entity.too.large' });
        return res.status(400).json({
          error: 'invalid_request',
          message: invalidRequestTooLargeMessage,
        });
      }
      if (err?.type === 'entity.parse.failed') {
        console.error(T10_ERROR_LOG, { code: 'entity.parse.failed' });
        return res.status(400).json({
          error: 'invalid_request',
          message: invalidRequestJsonMessage,
        });
      }
      return next(err);
    },
  );

  router.post('/device-auth', async (req, res) => {
    const requestId =
      (res.locals?.requestId as string | undefined) ?? undefined;

    try {
      parseDeviceAuthBody(req.body);
    } catch (error) {
      console.error(T10_ERROR_LOG, {
        code: 'invalid_request',
        message: (error as Error).message,
      });
      baseLogger.warn(
        {
          requestId,
          status: 400,
          error: 'invalid_request',
          message: (error as Error).message,
        },
        'DEV-0000031:T2:codex_device_auth_request_failed',
      );
      return res
        .status(400)
        .json({ error: 'invalid_request', message: (error as Error).message });
    }

    const cliStatus = deps.resolveCodexCli();
    if (!cliStatus.available) {
      console.error(T10_ERROR_LOG, {
        code: 'codex_unavailable',
        reason: cliStatus.reason,
      });
      baseLogger.warn(
        {
          requestId,
          state: 'unavailable_before_start',
          reason: cliStatus.reason,
        },
        'DEV-0000031:T2:codex_device_auth_request_failed',
      );
      return res
        .status(200)
        .json(
          createCodexUnavailableBeforeStartResponse(
            cliStatus.reason ?? 'codex not found',
          ),
        );
    }

    const targetCodexHome = deps.getCodexHome();
    const targetConfigPath = deps.getCodexConfigPathForHome(targetCodexHome);
    try {
      await deps.ensureCodexAuthFileStore(targetConfigPath);
    } catch (error) {
      console.error(T10_ERROR_LOG, {
        code: 'codex_unavailable',
        message: 'codex config persistence unavailable',
      });
      baseLogger.error(
        {
          requestId,
          configPath: targetConfigPath,
          err: error,
        },
        'DEV-0000031:T10:codex_device_auth_persist_failed',
      );
      return res
        .status(200)
        .json(
          createCodexUnavailableBeforeStartResponse(
            'codex config persistence unavailable',
          ),
        );
    }

    const cachedState = deviceAuthStateByHome.get(targetCodexHome);
    if (cachedState) {
      return res.status(200).json(cachedState);
    }

    const refreshedDetection = deps.refreshCodexDetection();
    if (
      refreshedDetection.available &&
      refreshedDetection.authPresent &&
      refreshedDetection.configPresent
    ) {
      return res.status(200).json(createCodexAlreadyAuthenticatedResponse());
    }

    const singleFlightKey = `device-auth:${targetCodexHome}`;
    const { promise: deviceAuthPromise } = getOrCreateSingleFlight(
      deviceAuthInFlightByHome,
      singleFlightKey,
      async () => {
        const deviceAuth = await deps.runCodexDeviceAuth({
          codexHome: undefined,
        });
        const responseState = toDeviceAuthResponseState(deviceAuth);

        if (responseState.state === 'verification_ready') {
          deviceAuthStateByHome.set(
            targetCodexHome,
            createCodexCompletionPendingResponse(responseState),
          );
        } else {
          deviceAuthStateByHome.set(targetCodexHome, responseState);
        }

        void deviceAuth.completion
          .then(async ({ exitCode, result }) => {
            baseLogger.info(
              {
                exitCode,
              },
              'DEV-0000031:T10:codex_device_auth_completed',
            );

            deviceAuthStateByHome.set(targetCodexHome, result);

            if (
              result.state !== 'completed' ||
              (exitCode !== null && exitCode !== 0)
            ) {
              console.error(T11_ERROR_LOG, {
                code: 'completion_unsuccessful',
                exitCode,
              });
              return;
            }

            const agents = await deps.discoverAgents({ seedAuth: false });
            const { agentCount } = await deps.propagateAgentAuthFromPrimary({
              agents,
              primaryCodexHome: deps.getCodexHome(),
              logger: baseLogger,
              overwrite: true,
            });

            baseLogger.info(
              {
                agentCount,
              },
              'DEV-0000031:T4:codex_device_auth_propagated',
            );

            const refreshed = deps.refreshCodexDetection();
            baseLogger.info(
              {
                available: refreshed.available,
                codexHome: deps.getCodexHome(),
              },
              'DEV-0000031:T4:codex_device_auth_availability_refreshed',
            );
            console.info(T11_SUCCESS_LOG, {
              agentCount,
              available: refreshed.available,
              codexHome: deps.getCodexHome(),
            });
          })
          .catch((error) => {
            console.error(T10_ERROR_LOG, {
              code: 'completion_failed',
            });
            console.error(T11_ERROR_LOG, {
              code: 'completion_side_effect_failed',
            });
            baseLogger.error(
              {
                err: error,
              },
              'DEV-0000031:T10:codex_device_auth_completion_failed',
            );
          });

        return deviceAuth;
      },
    );

    const deviceAuth = await deviceAuthPromise;
    const responseState = toDeviceAuthResponseState(deviceAuth);
    console.info(T10_SUCCESS_LOG, {
      state: responseState.state,
      hasDisplayOutput: Boolean(
        'displayOutput' in responseState
          ? responseState.displayOutput
          : undefined,
      ),
    });

    baseLogger.info(
      {
        requestId,
        state: responseState.state,
        hasDisplayOutput: Boolean(
          'displayOutput' in responseState
            ? responseState.displayOutput
            : undefined,
        ),
        displayOutputLength:
          'displayOutput' in responseState
            ? (responseState.displayOutput?.length ?? 0)
            : 0,
      },
      'DEV-0000031:T2:codex_device_auth_request_completed',
    );

    return res.status(200).json(responseState);
  });

  return router;
}
