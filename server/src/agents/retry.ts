export class AbortError extends Error {
  constructor(message = 'aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

export const delayWithAbort = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new AbortError());
      },
      { once: true },
    );
  });

export type RunWithRetryParams<T> = {
  runStep: () => Promise<T>;
  isRetryableError: (err: unknown) => boolean;
  maxAttempts: number;
  baseDelayMs: number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onRetry?: (params: {
    attempt: number;
    maxAttempts: number;
    error: unknown;
    delayMs: number;
  }) => void;
  onSuccessAfterRetry?: (params: {
    attempts: number;
    maxAttempts: number;
  }) => void;
  onExhausted?: (params: {
    attempt: number;
    maxAttempts: number;
    error: unknown;
  }) => void;
};

export async function runWithRetry<T>(params: RunWithRetryParams<T>) {
  const maxAttempts = Math.max(1, params.maxAttempts);
  const sleep = params.sleep ?? delayWithAbort;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (params.signal?.aborted) {
      throw new AbortError();
    }

    try {
      const value = await params.runStep();
      if (attempt > 1) {
        params.onSuccessAfterRetry?.({ attempts: attempt, maxAttempts });
      }
      return value;
    } catch (err) {
      if (err instanceof AbortError) throw err;
      if (!params.isRetryableError(err) || attempt >= maxAttempts) {
        params.onExhausted?.({ attempt, maxAttempts, error: err });
        throw err;
      }

      const delayMs = params.baseDelayMs * 2 ** (attempt - 1);
      params.onRetry?.({ attempt, maxAttempts, error: err, delayMs });
      await sleep(delayMs, params.signal);
    }
  }

  throw new Error('unreachable');
}
