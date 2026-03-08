import type { WebSocketMockRegistry } from './mockWebSocket';

declare global {
  interface Window {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
    __CODEINFO_TEST__?: boolean;
    __chatTest?: {
      handleWsEvent?: (event: unknown) => void;
    };
  }

  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
  var __CODEINFO_TEST__: boolean | undefined;
  var __wsMock: WebSocketMockRegistry | undefined;
}

export {};
