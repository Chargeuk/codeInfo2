import { AppBar, Tabs, Tab, Toolbar } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';

export default function NavBar() {
  const { pathname } = useLocation();
  const value = pathname.startsWith('/lmstudio') ? '/lmstudio' : '/';
  return (
    <AppBar position="static">
      <Toolbar sx={{ minHeight: 64 }}>
        <Tabs
          value={value}
          aria-label="Main navigation"
          textColor="inherit"
          indicatorColor="secondary"
          variant="scrollable"
          scrollButtons={false}
        >
          <Tab
            label="Home"
            value="/"
            component={RouterLink}
            to="/"
            aria-label="Home"
          />
          <Tab
            label="LM Studio"
            value="/lmstudio"
            component={RouterLink}
            to="/lmstudio"
            aria-label="LM Studio"
          />
        </Tabs>
      </Toolbar>
    </AppBar>
  );
}
