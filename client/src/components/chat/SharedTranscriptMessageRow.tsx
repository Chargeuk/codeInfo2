import { memo, type ReactNode } from 'react';
import type { ChatMessage, ToolCall } from '../../hooks/useChatStream';
import AssistantTranscriptSlice from './AssistantTranscriptSlice';
import UserTranscriptBubble from './UserTranscriptBubble';

type SharedTranscriptMessageRowProps = {
  message: ChatMessage;
  activeToolsAvailable: boolean;
  citationsEnabled?: boolean;
  isStopping: boolean;
  visibleStreamStatus?: ChatMessage['streamStatus'];
  citationsOpen: Record<string, boolean>;
  thinkOpen: Record<string, boolean>;
  toolOpen: Record<string, boolean>;
  toolErrorOpen: Record<string, boolean>;
  onToggleCitation: (messageId: string) => void;
  onToggleThink: (messageId: string) => void;
  onToggleTool: (toggleKey: string, messageId: string) => void;
  onToggleToolError: (toggleKey: string, messageId: string) => void;
  renderToolExtraContent?: (
    tool: ToolCall,
    toggleKey: string,
    message: ChatMessage,
  ) => ReactNode;
  renderMetadataContent?: (message: ChatMessage) => ReactNode;
  userMarkdownTestId?: string;
  log: (
    level: 'error' | 'warn' | 'info' | 'debug',
    message: string,
    context?: Record<string, unknown>,
  ) => void;
  markdownLogSource?: string;
};

function SharedTranscriptMessageRow({
  message,
  activeToolsAvailable,
  citationsEnabled = true,
  isStopping,
  visibleStreamStatus,
  citationsOpen,
  thinkOpen,
  toolOpen,
  toolErrorOpen,
  onToggleCitation,
  onToggleThink,
  onToggleTool,
  onToggleToolError,
  renderToolExtraContent,
  renderMetadataContent,
  userMarkdownTestId = 'user-markdown',
  log,
  markdownLogSource = 'SharedTranscript',
}: SharedTranscriptMessageRowProps) {
  if (message.role === 'user') {
    return (
      <UserTranscriptBubble
        message={message}
        userMarkdownTestId={userMarkdownTestId}
        log={log}
        markdownLogSource={markdownLogSource}
      />
    );
  }

  return (
    <AssistantTranscriptSlice
      message={message}
      activeToolsAvailable={activeToolsAvailable}
      citationsEnabled={citationsEnabled}
      isStopping={isStopping}
      visibleStreamStatus={visibleStreamStatus}
      citationsOpen={citationsOpen}
      thinkOpen={thinkOpen}
      toolOpen={toolOpen}
      toolErrorOpen={toolErrorOpen}
      onToggleCitation={onToggleCitation}
      onToggleThink={onToggleThink}
      onToggleTool={onToggleTool}
      onToggleToolError={onToggleToolError}
      renderToolExtraContent={renderToolExtraContent}
      renderMetadataContent={renderMetadataContent}
      log={log}
      markdownLogSource={markdownLogSource}
    />
  );
}

export default memo(SharedTranscriptMessageRow);
