type WebSocketMockMessageHandler = ((event: { data: unknown }) => void) | null;

export type WebSocketMockInstance = {
  url: string;
  readyState: number;
  sent: string[];
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: WebSocketMockMessageHandler;
  send: (data: unknown) => void;
  close: () => void;
  _receive: (data: unknown) => void;
};

export type WebSocketMockRegistry = {
  instances: WebSocketMockInstance[];
  reset: () => void;
  last: () => WebSocketMockInstance | null;
};

export class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: MockWebSocket[] = [];

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  sent: string[] = [];

  private pendingInbound: string[] = [];
  private messageHandler: WebSocketMockMessageHandler = null;

  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  set onmessage(handler: WebSocketMockMessageHandler) {
    this.messageHandler = handler;
    if (!handler) return;
    const pending = this.pendingInbound.splice(0);
    pending.forEach((payload) => handler({ data: payload }));
  }

  get onmessage() {
    return this.messageHandler;
  }

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);

    setTimeout(() => {
      if (this.readyState !== MockWebSocket.CONNECTING) return;
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.({});
    }, 0);
  }

  send(data: unknown) {
    this.sent.push(String(data));
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  }

  _receive(data: unknown) {
    const payload =
      typeof data === 'string' ? data : JSON.stringify(data ?? null);
    const handler = this.messageHandler;
    if (!handler) {
      this.pendingInbound.push(payload);
      return;
    }
    handler({ data: payload });
  }
}

export function installMockWebSocket(): WebSocketMockRegistry {
  // @ts-expect-error override JSDOM WebSocket with deterministic mock
  global.WebSocket = MockWebSocket;

  const registry: WebSocketMockRegistry = {
    instances: MockWebSocket.instances as unknown as WebSocketMockInstance[],
    reset: () => {
      MockWebSocket.instances.length = 0;
    },
    last: () =>
      (MockWebSocket.instances.at(-1) ??
        null) as unknown as WebSocketMockInstance | null,
  };

  (globalThis as unknown as { __wsMock?: WebSocketMockRegistry }).__wsMock =
    registry;
  return registry;
}
