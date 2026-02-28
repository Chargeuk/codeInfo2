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
import { runCodexDeviceAuth } from '../utils/codexDeviceAuth.js';

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

const deviceAuthOutputError = 'device auth output not recognized';
const deviceAuthExpiredError = 'device code expired or was declined';
const invalidRequestBodyMessage = 'request body must be an empty JSON object';
const invalidRequestTooLargeMessage = 'request body exceeds maximum size';
const invalidRequestJsonMessage = 'request body must be valid JSON';
const T10_SUCCESS_LOG =
  '[DEV-0000037][T10] event=device_auth_contract_validated result=success';
const T10_ERROR_LOG =
  '[DEV-0000037][T10] event=device_auth_contract_validated result=error';

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

    const rawSize = JSON.stringify(req.body ?? {}).length;
    if (rawSize > maxClientBytes) {
      return res.status(400).json({ error: 'payload too large' });
    }

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
          status: 503,
          error: 'codex_unavailable',
          reason: cliStatus.reason,
        },
        'DEV-0000031:T2:codex_device_auth_request_failed',
      );
      return res
        .status(503)
        .json({ error: 'codex_unavailable', reason: cliStatus.reason });
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
      return res.status(503).json({
        error: 'codex_unavailable',
        reason: 'codex config persistence unavailable',
      });
    }

    const deviceAuth = await deps.runCodexDeviceAuth({
      codexHome: undefined,
    });

    void deviceAuth.completion
      .then(async ({ exitCode, result }) => {
        baseLogger.info(
          {
            exitCode,
          },
          'DEV-0000031:T10:codex_device_auth_completed',
        );

        if (!result.ok || (exitCode !== null && exitCode !== 0)) {
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
          { available: refreshed.available, codexHome: deps.getCodexHome() },
          'DEV-0000031:T4:codex_device_auth_availability_refreshed',
        );
      })
      .catch((error) => {
        console.error(T10_ERROR_LOG, {
          code: 'completion_failed',
        });
        baseLogger.error(
          {
            err: error,
          },
          'DEV-0000031:T10:codex_device_auth_completion_failed',
        );
      });

    if (!deviceAuth.ok) {
      const statusCode =
        deviceAuth.message === deviceAuthOutputError ||
        deviceAuth.message === deviceAuthExpiredError
          ? 400
          : 503;
      const errorPayload =
        statusCode === 400
          ? { error: 'invalid_request', message: deviceAuth.message }
          : {
              error: 'codex_unavailable',
              reason: deviceAuth.message || 'codex device auth failed',
            };
      console.error(T10_ERROR_LOG, {
        code: errorPayload.error,
      });

      baseLogger.warn(
        {
          requestId,
          status: statusCode,
          error: errorPayload.error,
        },
        'DEV-0000031:T2:codex_device_auth_request_failed',
      );
      return res.status(statusCode).json(errorPayload);
    }
    console.info(T10_SUCCESS_LOG, {
      status: 'ok',
      hasRawOutput: Boolean(deviceAuth.rawOutput),
    });

    baseLogger.info(
      {
        requestId,
        hasRawOutput: Boolean(deviceAuth.rawOutput),
        rawOutputLength: deviceAuth.rawOutput.length,
      },
      'DEV-0000031:T2:codex_device_auth_request_completed',
    );

    return res.status(200).json({
      status: 'ok',
      rawOutput: deviceAuth.rawOutput,
    });
  });

  return router;
}
