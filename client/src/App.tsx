import { Box, Container, CssBaseline } from '@mui/material';
import { Outlet } from 'react-router-dom';
import NavBar from './components/NavBar';

export default function App() {
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
