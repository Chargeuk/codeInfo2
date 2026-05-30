import { Alert, Box, CssBaseline } from '@mui/material';
import { useEffect, useMemo } from 'react';
import { Outlet } from 'react-router-dom';
import { getApiBaseUrlBlockingIssueMessage } from './config/runtimeConfig';
import { createLogger } from './logging';
import { isDevEnv } from './utils/isDevEnv';

export default function App() {
  const logInfo = useMemo(() => createLogger('client'), []);
  const apiBaseUrlBlockingIssueMessage = getApiBaseUrlBlockingIssueMessage();

  useEffect(() => {
    if (isDevEnv()) {
      console.info('[codex-final-check] smoke ready', { story: '0000026' });
    }
  }, []);

  useEffect(() => {
    logInfo('info', 'DEV-0000028[T8] regression baseline ready', {
      page: 'app-shell',
    });
  }, [logInfo]);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CssBaseline />
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
          width: '100%',
        }}
      >
        {apiBaseUrlBlockingIssueMessage && (
          <Alert
            severity="error"
            data-testid="runtime-config-api-base-url-banner"
            sx={{ mb: 2 }}
          >
            {apiBaseUrlBlockingIssueMessage}
          </Alert>
        )}
        <Outlet />
      </Box>
    </Box>
  );
}
