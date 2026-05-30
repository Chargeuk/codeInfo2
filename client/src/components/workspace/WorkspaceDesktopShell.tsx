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
};

export default function WorkspaceDesktopShell({
  conversationPane,
  transcript,
  composer,
  conversationPaneOpen = true,
  conversationPaneWidth = 320,
  isMobile = false,
  onToggleConversationPane,
}: WorkspaceDesktopShellProps) {
  const chatContentFrameSx = {
    width: { xs: 'calc(100vw - 8px)', sm: '100%' },
    maxWidth: 'none',
    position: 'relative',
    left: { xs: '50%', sm: 'auto' },
    transform: { xs: 'translateX(-50%)', sm: 'none' },
    px: { xs: 0, sm: 1.5 },
  } as const;

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
          disableGutters
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
          <Box
            sx={{
              ...chatContentFrameSx,
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              alignSelf: 'stretch',
            }}
          >
            {transcript}
          </Box>
        </Container>
        <Box sx={chatContentFrameSx}>{composer}</Box>
      </Box>
    </Box>
  );
}
