import { jest } from '@jest/globals';

export type MockWebSocketInstance = {
  url: string;
  readyState: number;
  send: jest.Mock;
  close: jest.Mock;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  __emitOpen: () => void;
  __emitMessage: (data: unknown) => void;
  __emitClose: () => void;
};

export function installMockWebSocket() {
  const original = global.WebSocket;
  const instances: MockWebSocketInstance[] = [];

  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    url: string;
    readyState = MockWebSocket.CONNECTING;
    send = jest.fn();
    close = jest.fn(() => {
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.({} as CloseEvent);
    });

    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    onclose: ((ev: CloseEvent) => void) | null = null;

    constructor(url: string) {
      this.url = url;
      instances.push(this as unknown as MockWebSocketInstance);
    }

    __emitOpen() {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.({} as Event);
    }

    __emitMessage(data: unknown) {
      this.onmessage?.({ data } as MessageEvent);
    }

    __emitClose() {
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.({} as CloseEvent);
    }
  }

  // @ts-expect-error test replacement
  global.WebSocket = MockWebSocket;

  return {
    instances,
    restore: () => {
      global.WebSocket = original;
    },
  };
}
