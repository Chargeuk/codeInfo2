import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import { Box, IconButton, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';

type WorkspaceMobileTopBarProps = {
  title: string;
  showConversationsButton: boolean;
  onConversationsClick: () => void;
  onNewClick?: () => void;
  newButtonLabel?: string;
  onMenuClick: () => void;
};

export default function WorkspaceMobileTopBar({
  title,
  showConversationsButton,
  onConversationsClick,
  onNewClick,
  newButtonLabel = 'New conversation',
  onMenuClick,
}: WorkspaceMobileTopBarProps) {
  const [conversationsExpanded, setConversationsExpanded] = useState(false);

  useEffect(() => {
    if (!showConversationsButton) {
      setConversationsExpanded(false);
      return undefined;
    }

    const syncFromPageState = (event: Event) => {
      const customEvent = event as CustomEvent<{ open?: boolean }>;
      setConversationsExpanded(Boolean(customEvent.detail?.open));
    };

    const currentOpen = Boolean(
      typeof document !== 'undefined' &&
        document.querySelector(
          '[data-testid="workspace-mobile-conversations-overlay"]',
        ),
    );
    setConversationsExpanded(currentOpen);

    window.addEventListener(
      'codeinfo-mobile-conversations-overlay-change',
      syncFromPageState,
    );
    return () => {
      window.removeEventListener(
        'codeinfo-mobile-conversations-overlay-change',
        syncFromPageState,
      );
    };
  }, [showConversationsButton]);

  return (
    <Box
      sx={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        minHeight: 52,
        px: 1,
        py: 0.5,
        bgcolor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
        flexShrink: 0,
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        sx={{
          flex: 1,
          minWidth: 0,
          gap: 0.5,
          pr: onNewClick ? 7 : 0,
        }}
      >
        {showConversationsButton ? (
          <IconButton
            aria-label="Open conversations"
            aria-controls="conversation-drawer"
            aria-expanded={conversationsExpanded}
            onClick={onConversationsClick}
            size="small"
            data-testid="conversation-drawer-toggle"
            sx={{ flexShrink: 0 }}
          >
            <ChatBubbleOutlineIcon fontSize="small" />
          </IconButton>
        ) : null}
        <Typography
          component="h1"
          variant="subtitle1"
          noWrap
          sx={{
            minWidth: 0,
            fontWeight: 700,
            fontSize: '1rem',
            lineHeight: 1.2,
            color: 'text.primary',
          }}
        >
          {title}
        </Typography>
      </Stack>
      {onNewClick ? (
        <Box
          data-testid="workspace-mobile-new-action-slot"
          sx={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <IconButton
            aria-label={newButtonLabel}
            onClick={onNewClick}
            size="small"
            data-testid="workspace-mobile-new-action"
            sx={{ flexShrink: 0, pointerEvents: 'auto' }}
          >
            <EditOutlinedIcon fontSize="small" />
          </IconButton>
        </Box>
      ) : null}
      <Stack direction="row" spacing={0.25} alignItems="center">
        <IconButton
          aria-label="Open menu"
          onClick={onMenuClick}
          size="small"
          edge="end"
          sx={{ flexShrink: 0 }}
        >
          <MenuIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Box>
  );
}
