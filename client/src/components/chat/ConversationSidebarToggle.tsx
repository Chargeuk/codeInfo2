import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { IconButton } from '@mui/material';

type ConversationSidebarToggleProps = {
  drawerOpen: boolean;
  drawerWidth: number;
  isMobile: boolean;
  onToggle: () => void;
};

export default function ConversationSidebarToggle({
  drawerOpen,
  drawerWidth,
  isMobile,
  onToggle,
}: ConversationSidebarToggleProps) {
  const buttonSize = 28;
  const handleLeft = drawerOpen ? drawerWidth : buttonSize / 2;

  return (
    <IconButton
      aria-label="Toggle conversations"
      aria-controls="conversation-drawer"
      aria-expanded={drawerOpen}
      onClick={onToggle}
      size="small"
      data-testid="conversation-drawer-toggle"
      sx={{
        position: 'absolute',
        top: 12,
        left: handleLeft,
        transform: 'translateX(-50%)',
        zIndex: (theme) => theme.zIndex.drawer + 1,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        boxShadow: 1,
        width: buttonSize,
        height: buttonSize,
        '&:hover': {
          bgcolor: 'background.paper',
        },
        ...(isMobile
          ? {
              top: 8,
            }
          : {}),
      }}
    >
      {drawerOpen ? (
        <ChevronLeftIcon fontSize="small" />
      ) : (
        <ChevronRightIcon fontSize="small" />
      )}
    </IconButton>
  );
}
