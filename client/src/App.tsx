import { Container, CssBaseline } from '@mui/material';
import { Outlet } from 'react-router-dom';
import NavBar from './components/NavBar';

export default function App() {
  return (
    <>
      <CssBaseline />
      <NavBar />
      <Container maxWidth="lg" sx={{ mt: 3, pb: 4 }}>
        <Outlet />
      </Container>
    </>
  );
}
