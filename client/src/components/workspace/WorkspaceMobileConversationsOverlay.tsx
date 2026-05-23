import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import {
  Box,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import type { ReactNode } from 'react';

type WorkspaceMobileConversationsOverlayProps = {
  open: boolean;
  onClose: () => void;
  list: ReactNode;
  topOffsetPx?: number;
};

export default function WorkspaceMobileConversationsOverlay({
  open,
  onClose,
  list,
  topOffsetPx = 0,
}: WorkspaceMobileConversationsOverlayProps) {
  const drawerHeight =
    topOffsetPx > 0 ? `calc(100dvh - ${topOffsetPx}px)` : '100dvh';

  return (
    <Drawer
      anchor="left"
      open={open}
      onClose={onClose}
      variant="temporary"
      data-testid="conversation-drawer"
      ModalProps={{ keepMounted: false }}
      PaperProps={{
        id: 'conversation-drawer',
        className: 'MuiDrawer-paper',
        sx: {
          width: '100vw',
          maxWidth: '100vw',
          top: `${topOffsetPx}px`,
          height: drawerHeight,
          bgcolor: '#F4F6F8',
          overflow: 'hidden',
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          bgcolor: '#F4F6F8',
        }}
        data-testid="workspace-mobile-conversations-overlay"
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{
            px: 2,
            py: 1,
            minHeight: 56,
            bgcolor: '#DCE7F2',
          }}
        >
          <Typography
            variant="h6"
            component="h2"
            sx={{ fontWeight: 700, color: '#1F2933' }}
          >
            Conversations
          </Typography>
          <IconButton aria-label="Close conversations" onClick={onClose}>
            <ChevronLeftIcon />
          </IconButton>
        </Stack>
        <Divider sx={{ borderColor: '#D9E2EC' }} />
        <Box sx={{ px: 2, pt: 1.5, pb: 1, bgcolor: '#F4F6F8' }}>
          <Typography variant="body2" sx={{ color: '#52606D' }}>
            Select a conversation to return to the active workspace.
          </Typography>
        </Box>
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            px: 1.5,
            pb: 1.5,
            overflow: 'hidden',
            bgcolor: '#F4F6F8',
          }}
        >
          {list}
        </Box>
      </Box>
    </Drawer>
  );
}
