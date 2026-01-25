import { execSync } from 'node:child_process';

import {
  Router,
  json,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import { discoverAgents } from '../agents/discovery.js';
import { baseLogger, resolveLogConfig } from '../logger.js';
import { runCodexDeviceAuth } from '../utils/codexDeviceAuth.js';

type Deps = {
  discoverAgents: typeof discoverAgents;
  runCodexDeviceAuth: typeof runCodexDeviceAuth;
  resolveCodexCli: typeof resolveCodexCli;
};

type DeviceAuthBody = {
  target?: unknown;
  agentName?: unknown;
};

type ParsedDeviceAuth = {
  target: 'chat' | 'agent';
  agentName?: string;
};

const deviceAuthOutputError = 'device auth output not recognized';
const deviceAuthExpiredError = 'device code expired or was declined';

const allowedTargets = new Set(['chat', 'agent']);

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

function parseDeviceAuthBody(body: unknown): ParsedDeviceAuth {
  const candidate = (body ?? {}) as DeviceAuthBody;
  const rawTarget = candidate.target;
  if (typeof rawTarget !== 'string') {
    throw new Error('target is required');
  }
  const target = rawTarget.trim();
  if (!allowedTargets.has(target)) {
    throw new Error('target must be "chat" or "agent"');
  }

  const rawAgentName = candidate.agentName;
  const agentName =
    typeof rawAgentName === 'string' && rawAgentName.trim().length > 0
      ? rawAgentName.trim()
      : undefined;

  if (target === 'agent' && !agentName) {
    throw new Error('agentName is required');
  }

  return {
    target: target as ParsedDeviceAuth['target'],
    agentName,
  };
}

export function createCodexDeviceAuthRouter(
  deps: Deps = {
    discoverAgents,
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
        return res.status(400).json({ error: 'payload too large' });
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

    let parsedBody: ParsedDeviceAuth;
    try {
      parsedBody = parseDeviceAuthBody(req.body);
    } catch (error) {
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

    baseLogger.info(
      {
        requestId,
        target: parsedBody.target,
        agentName: parsedBody.agentName,
      },
      'DEV-0000031:T2:codex_device_auth_request_received',
    );

    let agentHome: string | undefined;
    if (parsedBody.target === 'agent') {
      try {
        const agents = await deps.discoverAgents();
        const match = agents.find(
          (agent) => agent.name === parsedBody.agentName,
        );
        if (!match) {
          baseLogger.warn(
            {
              requestId,
              status: 404,
              error: 'not_found',
              target: parsedBody.target,
              agentName: parsedBody.agentName,
            },
            'DEV-0000031:T2:codex_device_auth_request_failed',
          );
          return res.status(404).json({ error: 'not_found' });
        }
        agentHome = match.home;
      } catch (error) {
        baseLogger.error(
          {
            requestId,
            target: parsedBody.target,
            agentName: parsedBody.agentName,
            err: error,
          },
          'codex device auth agent lookup failed',
        );
        return res.status(500).json({ error: 'device_auth_failed' });
      }
    }

    const cliStatus = deps.resolveCodexCli();
    if (!cliStatus.available) {
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

    const result = await deps.runCodexDeviceAuth({ codexHome: agentHome });
    if (!result.ok) {
      const statusCode =
        result.message === deviceAuthOutputError ||
        result.message === deviceAuthExpiredError
          ? 400
          : 500;
      const errorPayload =
        statusCode === 400
          ? { error: 'invalid_request', message: result.message }
          : { error: 'device_auth_failed' };

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

    baseLogger.info(
      {
        requestId,
        target: parsedBody.target,
        agentName: parsedBody.agentName,
        hasVerificationUrl: Boolean(result.verificationUrl),
        hasUserCode: Boolean(result.userCode),
        hasExpiresInSec: result.expiresInSec !== undefined,
      },
      'DEV-0000031:T2:codex_device_auth_request_completed',
    );

    return res.status(200).json({
      status: 'completed',
      target: parsedBody.target,
      agentName: parsedBody.agentName,
      verificationUrl: result.verificationUrl,
      userCode: result.userCode,
      expiresInSec: result.expiresInSec,
    });
  });

  return router;
}
