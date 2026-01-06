import type WebSocket from 'ws';

type SocketState = {
  subscribedSidebar: boolean;
  subscribedIngest: boolean;
  conversationIds: Set<string>;
};

const stateBySocket = new Map<WebSocket, SocketState>();

export function registerSocket(ws: WebSocket) {
  stateBySocket.set(ws, {
    subscribedSidebar: false,
    subscribedIngest: false,
    conversationIds: new Set(),
  });
}

export function unregisterSocket(ws: WebSocket) {
  stateBySocket.delete(ws);
}

export function getSocketState(ws: WebSocket): SocketState {
  const state = stateBySocket.get(ws);
  if (!state) {
    const fresh: SocketState = {
      subscribedSidebar: false,
      subscribedIngest: false,
      conversationIds: new Set(),
    };
    stateBySocket.set(ws, fresh);
    return fresh;
  }
  return state;
}

export function subscribeSidebar(ws: WebSocket) {
  const state = getSocketState(ws);
  state.subscribedSidebar = true;
}

export function unsubscribeSidebar(ws: WebSocket) {
  const state = getSocketState(ws);
  state.subscribedSidebar = false;
}

export function subscribeIngest(ws: WebSocket) {
  const state = getSocketState(ws);
  state.subscribedIngest = true;
}

export function unsubscribeIngest(ws: WebSocket) {
  const state = getSocketState(ws);
  state.subscribedIngest = false;
}

export function subscribeConversation(ws: WebSocket, conversationId: string) {
  const state = getSocketState(ws);
  state.conversationIds.add(conversationId);
}

export function unsubscribeConversation(ws: WebSocket, conversationId: string) {
  const state = getSocketState(ws);
  state.conversationIds.delete(conversationId);
}

export function isSidebarSubscribed(ws: WebSocket) {
  return getSocketState(ws).subscribedSidebar;
}

export function subscribedConversationCount(ws: WebSocket) {
  return getSocketState(ws).conversationIds.size;
}

export function socketsSubscribedToSidebar(): WebSocket[] {
  return Array.from(stateBySocket.entries())
    .filter(([, state]) => state.subscribedSidebar)
    .map(([ws]) => ws);
}

export function socketsSubscribedToIngest(): WebSocket[] {
  return Array.from(stateBySocket.entries())
    .filter(([, state]) => state.subscribedIngest)
    .map(([ws]) => ws);
}

export function socketsSubscribedToConversation(
  conversationId: string,
): WebSocket[] {
  return Array.from(stateBySocket.entries())
    .filter(([, state]) => state.conversationIds.has(conversationId))
    .map(([ws]) => ws);
}
