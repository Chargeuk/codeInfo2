import { Box, Paper, Stack } from '@mui/material';
import type { FormEventHandler, ReactNode } from 'react';

type CommonComposerShellProps = {
  onSubmit: FormEventHandler<HTMLFormElement>;
  mainInputRow: ReactNode;
  footerRow: ReactNode;
  children?: ReactNode;
  'data-testid'?: string;
};

export default function CommonComposerShell({
  onSubmit,
  mainInputRow,
  footerRow,
  children,
  'data-testid': dataTestId,
}: CommonComposerShellProps) {
  return (
    <Paper
      variant="outlined"
      data-testid={dataTestId}
      style={{ flex: '0 0 auto' }}
      sx={{
        width: '100%',
        p: { xs: 0.75, sm: 2 },
        borderRadius: { xs: 3, sm: 4 },
        borderColor: 'divider',
        bgcolor: 'background.paper',
        boxShadow: '0 0 0 1px rgba(15, 23, 42, 0.05)',
      }}
    >
      <Stack spacing={{ xs: 1, sm: 2 }}>
        <Box component="form" onSubmit={onSubmit}>
          <Stack spacing={{ xs: 1, sm: 1.5 }}>{mainInputRow}</Stack>
        </Box>
        <Stack spacing={{ xs: 1, sm: 1.5 }}>{footerRow}</Stack>
        {children ? children : null}
      </Stack>
    </Paper>
  );
}
