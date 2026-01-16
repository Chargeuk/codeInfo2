import { Box, Container, CssBaseline } from '@mui/material';
import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import NavBar from './components/NavBar';

export default function App() {
  useEffect(() => {
    const isDev =
      (typeof import.meta !== 'undefined' && import.meta.env?.DEV) ||
      (typeof window !== 'undefined' &&
        (window as { __CODEINFO_TEST__?: boolean }).__CODEINFO_TEST__);
    if (isDev) {
      console.info('[codex-final-check] smoke ready', { story: '0000026' });
    }
  }, []);

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
        <Outlet />
      </Container>
    </Box>
  );
}
