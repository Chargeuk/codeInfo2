import { Dialog } from '@mui/material';
import type { ReactNode } from 'react';

type ComposerMobileDialogProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  'data-testid'?: string;
};

export default function ComposerMobileDialog({
  open,
  onClose,
  children,
  'data-testid': dataTestId,
}: ComposerMobileDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      data-testid={dataTestId}
      slotProps={{
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
