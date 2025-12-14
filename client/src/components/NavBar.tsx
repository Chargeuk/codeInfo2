import { AppBar, Tabs, Tab, Toolbar } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';

export default function NavBar() {
  const { pathname } = useLocation();
  const value = pathname.startsWith('/chat')
    ? '/chat'
    : pathname.startsWith('/agents')
      ? '/agents'
      : pathname.startsWith('/lmstudio')
        ? '/lmstudio'
        : pathname.startsWith('/ingest')
          ? '/ingest'
          : pathname.startsWith('/logs')
            ? '/logs'
            : '/';
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
            label="Chat"
            value="/chat"
            component={RouterLink}
            to="/chat"
            aria-label="Chat"
          />
          <Tab
            label="Agents"
            value="/agents"
            component={RouterLink}
            to="/agents"
            aria-label="Agents"
          />
          <Tab
            label="LM Studio"
            value="/lmstudio"
            component={RouterLink}
            to="/lmstudio"
            aria-label="LM Studio"
          />
          <Tab
            label="Ingest"
            value="/ingest"
            component={RouterLink}
            to="/ingest"
            aria-label="Ingest"
          />
          <Tab
            label="Logs"
            value="/logs"
            component={RouterLink}
            to="/logs"
            aria-label="Logs"
          />
        </Tabs>
      </Toolbar>
    </AppBar>
  );
}
