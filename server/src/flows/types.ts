import type { ChatInterface } from '../chat/interfaces/ChatInterface.js';

export type FlowRunErrorCode =
  | 'FLOW_NOT_FOUND'
  | 'FLOW_INVALID'
  | 'FLOW_INVALID_NAME'
  | 'INVALID_REQUEST'
  | 'CONVERSATION_ARCHIVED'
  | 'RUN_IN_PROGRESS'
  | 'CODEX_UNAVAILABLE'
  | 'WORKING_FOLDER_INVALID'
  | 'WORKING_FOLDER_NOT_FOUND'
  | 'AGENT_NOT_FOUND'
  | 'AGENT_MISMATCH'
  | 'COMMAND_INVALID'
  | 'UNSUPPORTED_STEP'
  | 'NO_STEPS';

export type FlowRunError = {
  code: FlowRunErrorCode;
  reason?: string;
};

export type FlowRunStartParams = {
  flowName: string;
  conversationId?: string;
  working_folder?: string;
  resumeStepPath?: number[];
  source: 'REST' | 'MCP';
  inflightId?: string;
  chatFactory?: FlowChatFactory;
};

export type FlowRunStartResult = {
  flowName: string;
  conversationId: string;
  inflightId: string;
  modelId: string;
};

export type FlowAgentState = {
  conversationId: string;
  threadId?: string;
};

export type FlowChatFactory = (
  provider: string,
  deps?: Record<string, unknown>,
) => ChatInterface;
