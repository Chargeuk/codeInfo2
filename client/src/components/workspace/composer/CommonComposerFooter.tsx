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
      spacing={1.5}
      alignItems="center"
      flexWrap="wrap"
      sx={{ minWidth: 0 }}
    >
      {children}
    </Stack>
  );
}
