import { Box, Popover } from '@mui/material';
import type { ReactNode } from 'react';

type ComposerDesktopPopoverProps = {
  id?: string;
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  width?: number | string;
  'data-testid'?: string;
};

export default function ComposerDesktopPopover({
  id,
  open,
  anchorEl,
  onClose,
  children,
  width = 360,
  'data-testid': dataTestId,
}: ComposerDesktopPopoverProps) {
  return (
    <Popover
      id={id}
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{
        paper: {
          sx: {
            width,
            maxWidth: 'calc(100vw - 32px)',
            maxHeight: 'calc(100vh - 32px)',
            overflow: 'hidden',
          },
        },
      }}
      data-testid={dataTestId}
    >
      <Box
        sx={{
          p: 2,
          maxHeight: 'calc(100vh - 64px)',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {children}
      </Box>
    </Popover>
  );
}
