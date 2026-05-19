import { Box, Paper } from '@mui/material';
import type { ReactNode } from 'react';
import ConversationSidebarToggle from '../chat/ConversationSidebarToggle';

type WorkspaceDesktopConversationPaneProps = {
  children: ReactNode;
  open: boolean;
  width?: number;
  onToggle: () => void;
  isMobile?: boolean;
  topOffsetPx?: number;
};

export default function WorkspaceDesktopConversationPane({
  children,
  open,
  width = 320,
  onToggle,
  isMobile = false,
  topOffsetPx,
}: WorkspaceDesktopConversationPaneProps) {
  const drawerHeight = topOffsetPx ? `calc(100% - ${topOffsetPx}px)` : '100%';

  return (
    <Box
      data-testid="workspace-conversation-pane"
      sx={{
        width: open ? width : 0,
        flexShrink: 0,
        position: 'relative',
        overflow: 'visible',
        transition: 'width 160ms ease',
      }}
    >
      <Paper
        elevation={0}
        variant="outlined"
        sx={{
          width,
          height: drawerHeight,
          mt: topOffsetPx ? `${topOffsetPx}px` : 0,
          borderRadius: 0,
          borderTop: 0,
          borderBottom: 0,
          borderLeft: 0,
          overflow: 'hidden',
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
  );
}
