const inFlightLocks = new Map<string, Promise<void>>();

export async function withSerializedKey<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = inFlightLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.then(() => next);
  inFlightLocks.set(key, chain);

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (inFlightLocks.get(key) === chain) {
      inFlightLocks.delete(key);
    }
  }
}

export function getOrCreateSingleFlight<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  create: () => Promise<T>,
): { promise: Promise<T>; reused: boolean } {
  const existing = cache.get(key);
  if (existing) {
    return { promise: existing, reused: true };
  }

  const created = create();
  cache.set(key, created);
  void created.finally(() => {
    if (cache.get(key) === created) {
      cache.delete(key);
    }
  });

  return { promise: created, reused: false };
}
