import { Box, Container } from '@mui/material';
import type { ReactNode } from 'react';
import WorkspaceAppRail from './WorkspaceAppRail';
import WorkspaceDesktopConversationPane from './WorkspaceDesktopConversationPane';

type WorkspaceDesktopShellProps = {
  conversationPane?: ReactNode;
  transcript: ReactNode;
  composer: ReactNode;
  conversationPaneOpen?: boolean;
  conversationPaneWidth?: number;
  isMobile?: boolean;
  onToggleConversationPane?: () => void;
  topOffsetPx?: number;
};

export default function WorkspaceDesktopShell({
  conversationPane,
  transcript,
  composer,
  conversationPaneOpen = true,
  conversationPaneWidth = 320,
  isMobile = false,
  onToggleConversationPane,
  topOffsetPx,
}: WorkspaceDesktopShellProps) {
  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        width: '100%',
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
      data-testid="workspace-desktop-shell"
    >
      <WorkspaceAppRail />
      {conversationPane ? (
        <WorkspaceDesktopConversationPane
          open={conversationPaneOpen}
          width={conversationPaneWidth}
          onToggle={onToggleConversationPane ?? (() => undefined)}
          isMobile={isMobile}
          topOffsetPx={topOffsetPx}
        >
          {conversationPane}
        </WorkspaceDesktopConversationPane>
      ) : null}
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <Container
          maxWidth={false}
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            px: 0,
            py: 0,
          }}
        >
          {transcript}
        </Container>
        {composer}
      </Box>
    </Box>
  );
}
