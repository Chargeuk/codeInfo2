import MoreVertIcon from '@mui/icons-material/MoreVert';
import { IconButton, Menu, MenuItem } from '@mui/material';
import { useState } from 'react';

export default function AgentConversationMenu({
  archived,
  disabled,
  onFork,
  onArchive,
  onRestore,
}: {
  archived?: boolean;
  disabled: boolean;
  onFork: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <IconButton
        aria-label="Conversation actions"
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(event.currentTarget);
        }}
        sx={{ minWidth: 44, minHeight: 44 }}
      >
        <MoreVertIcon />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        onClick={(event) => event.stopPropagation()}
      >
        <MenuItem
          onClick={() => {
            setAnchor(null);
            onFork();
          }}
          sx={{ minHeight: 44 }}
        >
          Fork conversation...
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            if (archived) onRestore();
            else onArchive();
          }}
          sx={{ minHeight: 44 }}
        >
          {archived ? 'Restore conversation' : 'Archive conversation'}
        </MenuItem>
      </Menu>
    </>
  );
}
