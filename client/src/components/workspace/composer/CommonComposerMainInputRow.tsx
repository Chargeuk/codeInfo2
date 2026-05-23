import { Stack } from '@mui/material';
import type { ReactNode } from 'react';

type CommonComposerMainInputRowProps = {
  children: ReactNode;
};

export default function CommonComposerMainInputRow({
  children,
}: CommonComposerMainInputRowProps) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="stretch"
      sx={{ minWidth: 0 }}
    >
      {children}
    </Stack>
  );
}
