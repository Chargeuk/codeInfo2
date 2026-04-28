import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { OpenAI } from 'openai';
import { delayWithAbort } from '../../agents/retry.js';
import { OPENAI_REQUEST_TIMEOUT_MS } from '../../ingest/providers/openaiConstants.js';
import {
  createOpenAiEmbeddingProvider,
  type OpenAiClientLike,
} from '../../ingest/providers/openaiEmbeddingProvider.js';
import { mapOpenAiError } from '../../ingest/providers/openaiErrors.js';

type ProbeOptions = {
  model: string;
  requests: number;
  concurrency: number;
  batchSize: number;
  textRepeat: number;
};

type HeaderSnapshot = {
  requestId?: string;
  retryAfter?: string;
  retryAfterMs?: string;
  remainingRequests?: string;
  remainingTokens?: string;
  resetRequests?: string;
  resetTokens?: string;
  processingMs?: string;
};

type RequestCapture = {
  retrySleepsMs: number[];
  successHeaders: HeaderSnapshot[];
  errorHeaders: HeaderSnapshot[];
};

type ProbeRequestResult = {
  requestIndex: number;
  success: boolean;
  durationMs: number;
  attemptCount: number;
  retryCount: number;
  totalBackoffMs: number;
  vectorCount?: number;
  finalHeaders?: HeaderSnapshot;
  lastErrorHeaders?: HeaderSnapshot;
  errorCode?: string;
  errorMessage?: string;
  upstreamStatus?: number;
  retryAfterMs?: number;
};

const dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(dirname, '../../../.env') });
loadEnv({
  path: path.resolve(dirname, '../../../.env.local'),
  override: true,
});

const HELP_TEXT = `Manual-only OpenAI rate-limit probe.

Usage:
  npm --workspace server run probe:openai-rate-limit -- --requests=12 --concurrency=2 --batch-size=16

Required environment:
  CODEINFO_ALLOW_REAL_OPENAI_PROBE=true
  CODEINFO_OPENAI_EMBEDDING_KEY=...

Optional flags:
  --model=text-embedding-3-small
  --requests=12
  --concurrency=2
  --batch-size=16
  --text-repeat=48

What it does:
  - exercises the repo's real OpenAI embedding provider retry path
  - captures success/error rate-limit headers from the OpenAI SDK
  - prints per-request outcomes and a final summary

Notes:
  - this uses the real OpenAI API and may incur cost
  - increase requests/concurrency gradually if you are trying to provoke 429s`;

function parseIntegerFlag(value: string, flagName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `${flagName} must be a positive integer, received ${value}`,
    );
  }
  return parsed;
}

function parseArgs(argv: string[]): ProbeOptions {
  const defaults: ProbeOptions = {
    model: 'text-embedding-3-small',
    requests: 12,
    concurrency: 2,
    batchSize: 16,
    textRepeat: 48,
  };

  const options = { ...defaults };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      console.log(HELP_TEXT);
      process.exit(0);
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unknown argument ${arg}`);
    }

    const [rawKey, rawValue] = arg.slice(2).split('=');
    const value = rawValue?.trim();
    if (!rawKey || !value) {
      throw new Error(`Expected --name=value argument, received ${arg}`);
    }

    switch (rawKey) {
      case 'model':
        options.model = value;
        break;
      case 'requests':
        options.requests = parseIntegerFlag(value, '--requests');
        break;
      case 'concurrency':
        options.concurrency = parseIntegerFlag(value, '--concurrency');
        break;
      case 'batch-size':
        options.batchSize = parseIntegerFlag(value, '--batch-size');
        break;
      case 'text-repeat':
        options.textRepeat = parseIntegerFlag(value, '--text-repeat');
        break;
      default:
        throw new Error(`Unknown argument ${arg}`);
    }
  }

  return options;
}

function headerSnapshot(headers: Headers | undefined): HeaderSnapshot {
  if (!headers) {
    return {};
  }

  return {
    requestId: headers.get('x-request-id') ?? undefined,
    retryAfter: headers.get('retry-after') ?? undefined,
    retryAfterMs: headers.get('retry-after-ms') ?? undefined,
    remainingRequests:
      headers.get('x-ratelimit-remaining-requests') ?? undefined,
    remainingTokens: headers.get('x-ratelimit-remaining-tokens') ?? undefined,
    resetRequests: headers.get('x-ratelimit-reset-requests') ?? undefined,
    resetTokens: headers.get('x-ratelimit-reset-tokens') ?? undefined,
    processingMs: headers.get('openai-processing-ms') ?? undefined,
  };
}

function buildInputs(
  requestIndex: number,
  batchSize: number,
  textRepeat: number,
): string[] {
  const repeatedSegment = Array.from(
    { length: textRepeat },
    (_, index) => `probe-token-${index + 1}`,
  ).join(' ');
  return Array.from({ length: batchSize }, (_, inputIndex) =>
    [
      `OpenAI rate-limit probe request ${requestIndex}.`,
      `Input ${inputIndex}.`,
      'This text is intentionally repetitive so the probe can create consistent token pressure.',
      repeatedSegment,
    ].join(' '),
  );
}

function parseNumericHeader(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function createObservedClient(
  apiKey: string,
  capture: RequestCapture,
): OpenAiClientLike {
  const client = new OpenAI({
    apiKey,
    timeout: OPENAI_REQUEST_TIMEOUT_MS,
    maxRetries: 0,
  });

  return {
    embeddings: {
      create: async (body, options) => {
        try {
          const { data: parsed, response } = await client.embeddings
            .create(body, options)
            .withResponse();
          capture.successHeaders.push(headerSnapshot(response.headers));
          return {
            data: parsed.data.map((item) => ({
              index: item.index,
              embedding: item.embedding,
            })),
          };
        } catch (error) {
          const headers =
            error && typeof error === 'object' && 'headers' in error
              ? ((error as { headers?: Headers }).headers ?? undefined)
              : undefined;
          capture.errorHeaders.push(headerSnapshot(headers));
          throw error;
        }
      },
    },
    models: {
      list: async () => {
        const listed = await client.models.list();
        return {
          data: listed.data.map((item) => ({ id: item.id })),
        };
      },
    },
  };
}

async function runProviderRequest(
  apiKey: string,
  options: ProbeOptions,
  requestIndex: number,
): Promise<ProbeRequestResult> {
  const capture: RequestCapture = {
    retrySleepsMs: [],
    successHeaders: [],
    errorHeaders: [],
  };
  const provider = createOpenAiEmbeddingProvider({
    apiKey,
    clientFactory: (clientApiKey) =>
      createObservedClient(clientApiKey, capture),
    retrySleep: async (ms, signal) => {
      capture.retrySleepsMs.push(ms);
      await delayWithAbort(ms, signal);
    },
  });
  const model = await provider.getModel(options.model);
  const inputs = buildInputs(
    requestIndex,
    options.batchSize,
    options.textRepeat,
  );
  const startedAt = Date.now();

  try {
    const vectors = await model.embedBatch(inputs);
    const durationMs = Date.now() - startedAt;
    return {
      requestIndex,
      success: true,
      durationMs,
      attemptCount: capture.successHeaders.length + capture.errorHeaders.length,
      retryCount: capture.retrySleepsMs.length,
      totalBackoffMs: capture.retrySleepsMs.reduce(
        (sum, current) => sum + current,
        0,
      ),
      vectorCount: vectors.length,
      finalHeaders:
        capture.successHeaders[capture.successHeaders.length - 1] ??
        capture.errorHeaders[capture.errorHeaders.length - 1],
      lastErrorHeaders: capture.errorHeaders[capture.errorHeaders.length - 1],
    };
  } catch (error) {
    const mapped = mapOpenAiError(error);
    const durationMs = Date.now() - startedAt;
    return {
      requestIndex,
      success: false,
      durationMs,
      attemptCount: capture.successHeaders.length + capture.errorHeaders.length,
      retryCount: capture.retrySleepsMs.length,
      totalBackoffMs: capture.retrySleepsMs.reduce(
        (sum, current) => sum + current,
        0,
      ),
      finalHeaders:
        capture.errorHeaders[capture.errorHeaders.length - 1] ??
        capture.successHeaders[capture.successHeaders.length - 1],
      lastErrorHeaders: capture.errorHeaders[capture.errorHeaders.length - 1],
      errorCode: mapped.code,
      errorMessage: mapped.message,
      upstreamStatus: mapped.upstreamStatus,
      retryAfterMs: mapped.retryAfterMs,
    };
  }
}

async function runProbe(
  apiKey: string,
  options: ProbeOptions,
): Promise<ProbeRequestResult[]> {
  const results = new Array<ProbeRequestResult>(options.requests);
  let nextRequestIndex = 0;

  const worker = async () => {
    while (true) {
      const requestIndex = nextRequestIndex;
      nextRequestIndex += 1;
      if (requestIndex >= options.requests) {
        return;
      }

      results[requestIndex] = await runProviderRequest(
        apiKey,
        options,
        requestIndex,
      );
    }
  };

  const workerCount = Math.min(options.concurrency, options.requests);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function logRequestResult(result: ProbeRequestResult) {
  const base = [
    `request=${result.requestIndex}`,
    `success=${result.success}`,
    `attempts=${result.attemptCount}`,
    `retries=${result.retryCount}`,
    `backoffMs=${result.totalBackoffMs}`,
    `durationMs=${result.durationMs}`,
  ];

  if (result.success) {
    base.push(`vectors=${result.vectorCount ?? 0}`);
  } else {
    base.push(`errorCode=${result.errorCode ?? 'unknown'}`);
    if (typeof result.upstreamStatus === 'number') {
      base.push(`status=${result.upstreamStatus}`);
    }
    if (typeof result.retryAfterMs === 'number') {
      base.push(`retryAfterMs=${result.retryAfterMs}`);
    }
  }

  if (result.finalHeaders?.requestId) {
    base.push(`requestId=${result.finalHeaders.requestId}`);
  }
  if (result.finalHeaders?.remainingRequests) {
    base.push(`remainingRequests=${result.finalHeaders.remainingRequests}`);
  }
  if (result.finalHeaders?.remainingTokens) {
    base.push(`remainingTokens=${result.finalHeaders.remainingTokens}`);
  }
  if (result.lastErrorHeaders?.retryAfterMs) {
    base.push(`retryAfterMsHint=${result.lastErrorHeaders.retryAfterMs}`);
  }
  if (result.lastErrorHeaders?.retryAfter) {
    base.push(`retryAfterHint=${result.lastErrorHeaders.retryAfter}`);
  }

  console.log(base.join(' '));
}

function printSummary(options: ProbeOptions, results: ProbeRequestResult[]) {
  const successCount = results.filter((result) => result.success).length;
  const failureCount = results.length - successCount;
  const retriedCount = results.filter((result) => result.retryCount > 0).length;
  const recoveredAfterRetry = results.filter(
    (result) => result.success && result.retryCount > 0,
  ).length;
  const terminalRateLimited = results.filter(
    (result) => !result.success && result.errorCode === 'OPENAI_RATE_LIMITED',
  ).length;
  const totalBackoffMs = results.reduce(
    (sum, result) => sum + result.totalBackoffMs,
    0,
  );
  const maxAttempts = results.reduce(
    (max, result) => Math.max(max, result.attemptCount),
    0,
  );
  const maxRetryCount = results.reduce(
    (max, result) => Math.max(max, result.retryCount),
    0,
  );

  const remainingRequestsValues = results
    .map((result) => parseNumericHeader(result.finalHeaders?.remainingRequests))
    .filter((value): value is number => value !== null);
  const remainingTokensValues = results
    .map((result) => parseNumericHeader(result.finalHeaders?.remainingTokens))
    .filter((value): value is number => value !== null);

  console.log('\nSummary');
  console.log(`model=${options.model}`);
  console.log(`requests=${options.requests}`);
  console.log(`concurrency=${options.concurrency}`);
  console.log(`batchSize=${options.batchSize}`);
  console.log(`textRepeat=${options.textRepeat}`);
  console.log(`successes=${successCount}`);
  console.log(`failures=${failureCount}`);
  console.log(`retriedRequests=${retriedCount}`);
  console.log(`recoveredAfterRetry=${recoveredAfterRetry}`);
  console.log(`terminalRateLimited=${terminalRateLimited}`);
  console.log(`totalBackoffMs=${totalBackoffMs}`);
  console.log(`maxAttempts=${maxAttempts}`);
  console.log(`maxRetryCount=${maxRetryCount}`);
  if (remainingRequestsValues.length > 0) {
    console.log(`minRemainingRequests=${Math.min(...remainingRequestsValues)}`);
  }
  if (remainingTokensValues.length > 0) {
    console.log(`minRemainingTokens=${Math.min(...remainingTokensValues)}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (process.env.CODEINFO_ALLOW_REAL_OPENAI_PROBE !== 'true') {
    throw new Error(
      'Refusing to run real OpenAI probe without CODEINFO_ALLOW_REAL_OPENAI_PROBE=true',
    );
  }

  const apiKey = process.env.CODEINFO_OPENAI_EMBEDDING_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'CODEINFO_OPENAI_EMBEDDING_KEY must be set in server/.env.local or the environment',
    );
  }

  console.log('Starting OpenAI rate-limit probe');
  console.log(
    `model=${options.model} requests=${options.requests} concurrency=${options.concurrency} batchSize=${options.batchSize} textRepeat=${options.textRepeat}`,
  );

  const results = await runProbe(apiKey, options);
  for (const result of results) {
    logRequestResult(result);
  }
  printSummary(options, results);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`OpenAI rate-limit probe failed: ${message}`);
  process.exitCode = 1;
});
