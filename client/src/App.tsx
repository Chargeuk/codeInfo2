import { Container } from '@mui/material';
import { Outlet } from 'react-router-dom';
import NavBar from './components/NavBar';

export default function App() {
  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <NavBar />
      <Outlet />
    </Container>
  );
}
