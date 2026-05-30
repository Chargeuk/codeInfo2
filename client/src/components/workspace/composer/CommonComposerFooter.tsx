import { Stack } from '@mui/material';
import type { ReactNode } from 'react';

type CommonComposerFooterProps = {
  children: ReactNode;
};

export default function CommonComposerFooter({
  children,
}: CommonComposerFooterProps) {
  return (
    <Stack
      direction="row"
      spacing={{ xs: 0.5, sm: 1.5 }}
      alignItems="center"
      flexWrap="nowrap"
      sx={{ minWidth: 0, width: '100%' }}
    >
      {children}
    </Stack>
  );
}
