import { Box, Paper } from '@mui/material';
import type { ReactNode } from 'react';
import ConversationSidebarToggle from '../chat/ConversationSidebarToggle';

type WorkspaceDesktopConversationPaneProps = {
  children: ReactNode;
  open: boolean;
  width?: number;
  onToggle: () => void;
  isMobile?: boolean;
};

export default function WorkspaceDesktopConversationPane({
  children,
  open,
  width = 320,
  onToggle,
  isMobile = false,
}: WorkspaceDesktopConversationPaneProps) {
  return (
    <Box
      id="workspace-conversation-pane"
      data-testid="workspace-conversation-pane"
      sx={{
        width: open ? width : 0,
        flexShrink: 0,
        position: 'relative',
        overflow: 'visible',
        transition: 'width 160ms ease',
      }}
    >
      <Box data-testid="conversation-drawer" sx={{ height: '100%' }}>
        <Paper
          className="MuiDrawer-paper"
          elevation={0}
          variant="outlined"
          style={{ overflowX: 'hidden' }}
          sx={{
            width,
            height: '100%',
            borderRadius: 0,
            borderTop: 0,
            borderBottom: 0,
            borderLeft: 0,
            overflowY: 'hidden',
            bgcolor: '#EEF2F6',
            display: 'flex',
            flexDirection: 'column',
            opacity: open ? 1 : 0,
            pointerEvents: open ? 'auto' : 'none',
            transition: 'opacity 160ms ease',
          }}
        >
          <Box sx={{ position: 'relative', height: '100%', minHeight: 0 }}>
            {children}
            <ConversationSidebarToggle
              drawerOpen={open}
              drawerWidth={width}
              isMobile={isMobile}
              onToggle={onToggle}
              controlsId="workspace-conversation-pane"
            />
          </Box>
        </Paper>
      </Box>
    </Box>
  );
}
