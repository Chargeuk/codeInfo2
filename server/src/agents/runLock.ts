const activeConversationRuns = new Set<string>();

export function tryAcquireConversationLock(conversationId: string): boolean {
  if (activeConversationRuns.has(conversationId)) return false;
  activeConversationRuns.add(conversationId);
  return true;
}

export function releaseConversationLock(conversationId: string): void {
  activeConversationRuns.delete(conversationId);
}
