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
  const cleanup = () => {
    if (cache.get(key) === created) {
      cache.delete(key);
    }
  };
  void created.then(cleanup, cleanup);

  return { promise: created, reused: false };
}
