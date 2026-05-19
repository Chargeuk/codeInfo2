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
};

export default function WorkspaceMobileConversationsOverlay({
  open,
  onClose,
  list,
}: WorkspaceMobileConversationsOverlayProps) {
  return (
    <Drawer
      anchor="left"
      open={open}
      onClose={onClose}
      variant="temporary"
      ModalProps={{ keepMounted: false }}
      PaperProps={{
        sx: {
          width: '100vw',
          maxWidth: '100vw',
          height: '100vh',
          bgcolor: '#F4F6F8',
        },
      }}
      data-testid="workspace-mobile-conversations-overlay"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{
            px: 2,
            py: 1.5,
            minHeight: 56,
            bgcolor: '#DCE7F2',
          }}
        >
          <Typography variant="h6" component="h2">
            Conversations
          </Typography>
          <IconButton aria-label="Close conversations" onClick={onClose}>
            <ChevronLeftIcon />
          </IconButton>
        </Stack>
        <Divider />
        <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Select a conversation to return to the active workspace.
          </Typography>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, px: 1.5, pb: 1.5 }}>{list}</Box>
      </Box>
    </Drawer>
  );
}
