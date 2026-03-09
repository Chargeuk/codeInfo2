import crypto from 'node:crypto';

export type ActiveRunOwnership = {
  runToken: string;
  startedAt: string;
};

const activeConversationRuns = new Map<string, ActiveRunOwnership>();

export function tryAcquireConversationLock(conversationId: string): boolean {
  if (activeConversationRuns.has(conversationId)) return false;
  activeConversationRuns.set(conversationId, {
    runToken: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
  });
  return true;
}

export function getActiveRunOwnership(
  conversationId: string,
): ActiveRunOwnership | null {
  const ownership = activeConversationRuns.get(conversationId);
  if (!ownership) return null;
  return { ...ownership };
}

export function releaseConversationLock(
  conversationId: string,
  expectedRunToken?: string,
): boolean {
  const ownership = activeConversationRuns.get(conversationId);
  if (!ownership) return false;
  if (
    expectedRunToken !== undefined &&
    ownership.runToken !== expectedRunToken
  ) {
    return false;
  }
  activeConversationRuns.delete(conversationId);
  return true;
}
