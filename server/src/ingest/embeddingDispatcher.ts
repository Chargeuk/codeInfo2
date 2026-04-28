import { LmStudioEmbeddingError } from './providers/ingestFailureLogging.js';
import { OpenAiEmbeddingError } from './providers/openaiErrors.js';
import type {
  ProviderEmbedRequestOptions,
  ProviderEmbeddingModel,
} from './providers/types.js';

export type EmbeddingDispatchItem<TMeta> = {
  sequence: number;
  text: string;
  meta: TMeta;
};

export type EmbeddingDispatchResult<TMeta> = EmbeddingDispatchItem<TMeta> & {
  embedding: number[];
};

export type EmbeddingDispatcher = {
  enqueue: <TMeta>(item: EmbeddingDispatchItem<TMeta>) => Promise<boolean>;
  completeProduction: () => void;
  waitForIdle: () => Promise<void>;
  cancel: () => void;
  snapshot: () => {
    queueDepth: number;
    inFlight: number;
    queueLimit: number;
    dispatchCount: number;
  };
};

type QueueEntry = EmbeddingDispatchItem<unknown>;

type Params = {
  model: ProviderEmbeddingModel;
  effectiveBatchSize: number;
  maxInFlight: number;
  maxQueueSize: number;
  isCancelled: () => boolean;
  onDispatch: (ctx: {
    batchSize: number;
    queueDepth: number;
    inFlight: number;
    effectiveBatchSize: number;
    effectiveMaxInFlight: number;
  }) => void;
  onCompleted: (results: EmbeddingDispatchResult<unknown>[]) => Promise<void>;
  onLateResultIgnored: (ctx: { batchSize: number; queueDepth: number }) => void;
};

function createDeferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function deriveQueueLimit(
  effectiveBatchSize: number,
  maxInFlight: number,
  maxQueueSize: number,
) {
  const derived = Math.max(1, effectiveBatchSize * maxInFlight);
  if (maxQueueSize < 0) return derived;
  return Math.min(derived, maxQueueSize);
}

function isCancellationAbortEquivalent(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }

  if (error instanceof OpenAiEmbeddingError) {
    return error.code === 'OPENAI_ABORTED';
  }

  if (error instanceof LmStudioEmbeddingError) {
    return error.code === 'LMSTUDIO_ABORTED';
  }

  return false;
}

export function createEmbeddingDispatcher(params: Params): EmbeddingDispatcher {
  const queue: QueueEntry[] = [];
  const controllers = new Map<number, AbortController>();
  const waiters = new Set<ReturnType<typeof createDeferred>>();
  let nextDispatchId = 0;
  let productionComplete = false;
  let pumpScheduled = false;
  let terminalError: unknown = null;
  let dispatchCount = 0;
  const idle = createDeferred();
  void idle.promise.catch(() => {
    // The producer may not call waitForIdle() until after an in-flight request
    // fails. Attach a passive handler now so that early terminal errors still
    // flow through waitForIdle() without becoming process-level rejections.
  });
  const queueLimit = deriveQueueLimit(
    params.effectiveBatchSize,
    params.maxInFlight,
    params.maxQueueSize,
  );

  const fail = (error: unknown) => {
    if (terminalError) return;
    terminalError = error;
    for (const waiter of waiters) {
      waiter.reject(error);
    }
    waiters.clear();
    idle.reject(error);
  };

  const wakeWaiters = () => {
    for (const waiter of waiters) {
      waiter.resolve();
    }
    waiters.clear();
  };

  const projectedWaitingCount = (queuedItemCount: number) => {
    const immediateCapacity =
      Math.max(0, params.maxInFlight - controllers.size) *
      params.effectiveBatchSize;
    return Math.max(0, queuedItemCount - immediateCapacity);
  };

  const wouldExceedQueueLimit = (queuedItemCount: number) =>
    projectedWaitingCount(queuedItemCount) > queueLimit;

  const maybeResolveIdle = () => {
    if (
      !terminalError &&
      (productionComplete || params.isCancelled()) &&
      queue.length === 0 &&
      controllers.size === 0
    ) {
      idle.resolve();
    }
  };

  const schedulePump = () => {
    if (pumpScheduled || terminalError) return;
    pumpScheduled = true;
    queueMicrotask(() => {
      pumpScheduled = false;
      const launched = pump();
      void launched.catch((error) => {
        fail(error);
      });
    });
  };

  const runRequest = async (batch: QueueEntry[]) => {
    const controller = new AbortController();
    const dispatchId = nextDispatchId++;
    controllers.set(dispatchId, controller);
    dispatchCount += 1;
    try {
      params.onDispatch({
        batchSize: batch.length,
        queueDepth: queue.length,
        inFlight: controllers.size,
        effectiveBatchSize: params.effectiveBatchSize,
        effectiveMaxInFlight: params.maxInFlight,
      });

      const requestOptions: ProviderEmbedRequestOptions | undefined = params
        .model.supportsAbort
        ? { signal: controller.signal }
        : undefined;
      const vectors = await params.model.embedBatch(
        batch.map((item) => item.text),
        requestOptions,
      );
      if (params.isCancelled()) {
        params.onLateResultIgnored({
          batchSize: batch.length,
          queueDepth: queue.length,
        });
        return;
      }

      await params.onCompleted(
        batch.map((item, index) => ({
          ...item,
          embedding: vectors[index] ?? [],
        })),
      );
    } catch (error) {
      if (
        params.isCancelled() &&
        controller.signal.aborted &&
        isCancellationAbortEquivalent(error)
      ) {
        return;
      }
      fail(error);
    } finally {
      controllers.delete(dispatchId);
      wakeWaiters();
      maybeResolveIdle();
      schedulePump();
    }
  };

  const pump = async () => {
    if (terminalError) return;

    while (
      !params.isCancelled() &&
      controllers.size < params.maxInFlight &&
      queue.length > 0
    ) {
      const batchSize = Math.min(params.effectiveBatchSize, queue.length);
      const batch = queue.splice(0, batchSize);
      const launched = runRequest(batch);
      void launched.catch((error) => {
        fail(error);
      });
    }

    maybeResolveIdle();
  };

  return {
    async enqueue<TMeta>(item: EmbeddingDispatchItem<TMeta>) {
      while (
        !terminalError &&
        !params.isCancelled() &&
        wouldExceedQueueLimit(queue.length + 1)
      ) {
        const waiter = createDeferred();
        waiters.add(waiter);
        await waiter.promise;
      }

      if (terminalError) throw terminalError;
      if (params.isCancelled()) return false;

      queue.push(item as QueueEntry);
      schedulePump();
      return true;
    },

    completeProduction() {
      productionComplete = true;
      maybeResolveIdle();
      schedulePump();
    },

    async waitForIdle() {
      if (terminalError) throw terminalError;
      maybeResolveIdle();
      return idle.promise;
    },

    cancel() {
      queue.length = 0;
      for (const controller of controllers.values()) {
        controller.abort();
      }
      wakeWaiters();
      maybeResolveIdle();
    },

    snapshot() {
      return {
        queueDepth: queue.length,
        inFlight: controllers.size,
        queueLimit,
        dispatchCount,
      };
    },
  };
}
