import { Alert, Box, Container, CssBaseline } from '@mui/material';
import { useEffect, useMemo } from 'react';
import { Outlet } from 'react-router-dom';
import NavBar from './components/NavBar';
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
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <CssBaseline />
      <NavBar />
      <Container
        maxWidth={false}
        sx={{
          mt: 3,
          pb: 4,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'auto',
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
      </Container>
    </Box>
  );
}
