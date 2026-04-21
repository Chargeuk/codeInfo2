import { recoverIngestQueueOnStartup } from '../ingest/ingestJob.js';
import {
  clearIngestQueueUnavailable,
  getIngestQueueAvailability,
  markIngestQueueUnavailable,
} from '../ingest/requestQueue.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';

export const INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_EVENT =
  'INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED';
export const INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_MESSAGE =
  'Mongo-backed ingest queue is unavailable because startup recovery degraded';
export const INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE_EVENT =
  'INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE';
export const INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE_MESSAGE =
  'Mongo-backed ingest queue is unavailable because Mongo connection failed during startup';

type StartupRecoveryOutcome = Awaited<
  ReturnType<typeof recoverIngestQueueOnStartup>
>;

export type IngestQueueStartupRecoveryResult =
  | {
      reachable: true;
      degraded: false;
      recovery: StartupRecoveryOutcome;
      queueAvailability: ReturnType<typeof getIngestQueueAvailability>;
      diagnosticEvent: null;
    }
  | {
      reachable: true;
      degraded: true;
      recovery: null;
      queueAvailability: ReturnType<typeof getIngestQueueAvailability>;
      diagnosticEvent: typeof INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_EVENT;
      causeMessage: string;
    };

function toCauseMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

export function recordIngestQueueStartupMongoUnavailable(params: {
  error: unknown;
  appendLog?: typeof append;
  logger?: typeof baseLogger;
  now?: () => string;
}) {
  const appendLog = params.appendLog ?? append;
  const logger = params.logger ?? baseLogger;
  const now = params.now ?? (() => new Date().toISOString());
  const causeMessage = toCauseMessage(params.error);

  markIngestQueueUnavailable(INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE_MESSAGE);
  logger.error(
    {
      event: INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE_EVENT,
      err: params.error,
      causeMessage,
      queueUnavailableMessage: INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE_MESSAGE,
    },
    INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE_EVENT,
  );
  appendLog({
    level: 'error',
    message: INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE_EVENT,
    timestamp: now(),
    source: 'server',
    context: {
      causeMessage,
      queueUnavailableMessage: INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE_MESSAGE,
    },
  });

  return {
    reachable: true,
    degraded: true,
    recovery: null,
    queueAvailability: getIngestQueueAvailability(),
    diagnosticEvent: INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE_EVENT,
    causeMessage,
  } as const;
}

export async function recoverIngestQueueForStartup(params?: {
  recoverQueueOnStartup?: typeof recoverIngestQueueOnStartup;
  appendLog?: typeof append;
  logger?: typeof baseLogger;
  now?: () => string;
}): Promise<IngestQueueStartupRecoveryResult> {
  const recoverQueueOnStartup =
    params?.recoverQueueOnStartup ?? recoverIngestQueueOnStartup;
  const appendLog = params?.appendLog ?? append;
  const logger = params?.logger ?? baseLogger;
  const now = params?.now ?? (() => new Date().toISOString());

  clearIngestQueueUnavailable();

  try {
    const recovery = await recoverQueueOnStartup();
    return {
      reachable: true,
      degraded: false,
      recovery,
      queueAvailability: getIngestQueueAvailability(),
      diagnosticEvent: null,
    };
  } catch (error) {
    const causeMessage = toCauseMessage(error);
    markIngestQueueUnavailable(INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_MESSAGE);
    logger.error(
      {
        event: INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_EVENT,
        err: error,
        causeMessage,
        queueUnavailableMessage: INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_MESSAGE,
      },
      INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_EVENT,
    );
    appendLog({
      level: 'error',
      message: INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_EVENT,
      timestamp: now(),
      source: 'server',
      context: {
        causeMessage,
        queueUnavailableMessage: INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_MESSAGE,
      },
    });
    return {
      reachable: true,
      degraded: true,
      recovery: null,
      queueAvailability: getIngestQueueAvailability(),
      diagnosticEvent: INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_EVENT,
      causeMessage,
    };
  }
}
