import { Dialog } from '@mui/material';
import type { ReactNode } from 'react';

type ComposerMobileDialogProps = {
  open: boolean;
  onClose: () => void;
  disableRestoreFocus?: boolean;
  onExited?: () => void;
  children: ReactNode;
  'data-testid'?: string;
};

export default function ComposerMobileDialog({
  open,
  onClose,
  disableRestoreFocus = false,
  onExited,
  children,
  'data-testid': dataTestId,
}: ComposerMobileDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      disableRestoreFocus={disableRestoreFocus}
      fullWidth
      maxWidth="sm"
      data-testid={dataTestId}
      slotProps={{
        transition: {
          onExited,
        },
        paper: {
          sx: {
            width: 'min(100vw - 32px, 560px)',
            m: 2,
            borderRadius: 3,
            maxHeight: 'calc(100dvh - 32px)',
          },
        },
      }}
    >
      {children}
    </Dialog>
  );
}
