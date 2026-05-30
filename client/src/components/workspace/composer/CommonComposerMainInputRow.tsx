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
      spacing={{ xs: 0.75, sm: 1.5 }}
      alignItems="flex-end"
      sx={{ minWidth: 0 }}
    >
      {children}
    </Stack>
  );
}
