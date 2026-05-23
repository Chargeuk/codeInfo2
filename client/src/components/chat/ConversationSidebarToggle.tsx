import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { IconButton } from '@mui/material';

type ConversationSidebarToggleProps = {
  drawerOpen: boolean;
  drawerWidth: number;
  isMobile: boolean;
  onToggle: () => void;
  controlsId?: string;
};

export default function ConversationSidebarToggle({
  drawerOpen,
  drawerWidth,
  isMobile,
  onToggle,
  controlsId = 'conversation-drawer',
}: ConversationSidebarToggleProps) {
  const buttonSize = isMobile ? 30 : 28;
  const handleLeft = drawerOpen ? drawerWidth : 0;

  return (
    <IconButton
      aria-label="Toggle conversations"
      aria-controls={controlsId}
      aria-expanded={drawerOpen}
      onClick={onToggle}
      size="small"
      data-testid="conversation-drawer-toggle"
      sx={{
        position: 'absolute',
        top: isMobile ? 10 : 12,
        left: handleLeft,
        transform: 'translateX(-50%)',
        zIndex: (theme) => theme.zIndex.drawer + 4,
        border: '1px solid',
        borderColor: '#D9E2EC',
        bgcolor: '#F4F6F8',
        color: '#1F2933',
        boxShadow: 2,
        width: buttonSize,
        height: buttonSize,
        borderRadius: '999px',
        '&:hover': {
          bgcolor: '#F4F6F8',
        },
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
