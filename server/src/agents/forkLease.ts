import type mongoose from 'mongoose';
import {
  ForkOperationModel,
  type ForkOperation,
} from '../mongo/forkOperation.js';
import { ForkError } from './forkHistory.js';

export const FORK_LEASE_MS = 300_000;
export const FORK_LEASE_RENEW_MS = 60_000;
export const incompleteForkPhases = [
  'snapshotting',
  'prepared',
  'native_creating',
  'native_ready',
  'injecting',
  'injection_uncertain',
  'copied',
  'cleaning',
];

/** Only this fork operation is leased; this does not lock other app operations. */
export function maintainForkLease(operationId: string, owner: string) {
  let renewalFailure: unknown;
  let renewal = Promise.resolve();
  let stopped = false;
  const update = async (
    values: Partial<ForkOperation> = {},
    session?: mongoose.ClientSession,
  ) => {
    if (renewalFailure) throw renewalFailure;
    const leaseUntil = new Date(Date.now() + FORK_LEASE_MS);
    const result = await ForkOperationModel.updateOne(
      {
        _id: operationId,
        owner,
        phase: { $in: incompleteForkPhases },
        leaseUntil: { $gt: new Date() },
      },
      { $set: { ...values, leaseUntil } },
      session ? { session } : undefined,
    );
    // Matching the identity alone is insufficient after another worker takes
    // over. Never issue provider work or publish after a failed ownership write.
    // A delayed acknowledgement can arrive after the lease it recorded has
    // expired. A past successful write is not permission to start native work.
    if (result.matchedCount !== 1 || Date.now() >= leaseUntil.getTime())
      throw new ForkError(
        'FORK_LEASE_LOST',
        'Fork ownership expired or changed. Retry with the same request identity.',
      );
  };
  const timer = setInterval(() => {
    renewal = renewal
      .then(async () => {
        if (!stopped) await update();
      })
      .catch((error: unknown) => {
        renewalFailure = error;
      });
  }, FORK_LEASE_RENEW_MS);
  timer.unref?.();
  return {
    update,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await renewal;
    },
  };
}
