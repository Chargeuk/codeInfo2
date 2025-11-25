const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

type LockState = {
  owner: string;
  expiresAt: number;
};

let state: LockState | null = null;

function isExpired(lock: LockState | null) {
  return lock && lock.expiresAt <= Date.now();
}

export function isHeld() {
  if (isExpired(state)) {
    state = null;
    return false;
  }
  return state !== null;
}

export function acquire(owner: string, ttlMs: number = DEFAULT_TTL_MS) {
  if (isHeld()) return false;
  state = { owner, expiresAt: Date.now() + ttlMs };
  return true;
}

export function release(owner?: string) {
  if (!state) return;
  if (owner && state.owner !== owner) return;
  state = null;
}

export function currentOwner() {
  if (isExpired(state)) {
    state = null;
    return null;
  }
  return state?.owner ?? null;
}
