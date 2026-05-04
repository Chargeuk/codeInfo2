import { AppBar, Tabs, Tab, Toolbar } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';

export default function NavBar() {
  const { pathname } = useLocation();
  const value = pathname.startsWith('/chat')
    ? '/chat'
    : pathname.startsWith('/agents')
      ? '/agents'
      : pathname.startsWith('/flows')
        ? '/flows'
        : pathname.startsWith('/lmstudio')
          ? '/lmstudio'
          : pathname.startsWith('/ingest')
            ? '/ingest'
            : pathname.startsWith('/logs')
              ? '/logs'
              : '/';
  return (
    <AppBar position="static">
      <Toolbar sx={{ minHeight: 52 }}>
        <Tabs
          value={value}
          aria-label="Main navigation"
          textColor="inherit"
          indicatorColor="secondary"
          variant="scrollable"
          scrollButtons={false}
          sx={{ minHeight: 52 }}
        >
          <Tab
            label="Home"
            value="/"
            component={RouterLink}
            to="/"
            aria-label="Home"
            sx={{ minHeight: 52, py: 0.5 }}
          />
          <Tab
            label="Chat"
            value="/chat"
            component={RouterLink}
            to="/chat"
            aria-label="Chat"
            sx={{ minHeight: 52, py: 0.5 }}
          />
          <Tab
            label="Agents"
            value="/agents"
            component={RouterLink}
            to="/agents"
            aria-label="Agents"
            sx={{ minHeight: 52, py: 0.5 }}
          />
          <Tab
            label="Flows"
            value="/flows"
            component={RouterLink}
            to="/flows"
            aria-label="Flows"
            sx={{ minHeight: 52, py: 0.5 }}
          />
          <Tab
            label="LM Studio"
            value="/lmstudio"
            component={RouterLink}
            to="/lmstudio"
            aria-label="LM Studio"
            sx={{ minHeight: 52, py: 0.5 }}
          />
          <Tab
            label="Ingest"
            value="/ingest"
            component={RouterLink}
            to="/ingest"
            aria-label="Ingest"
            sx={{ minHeight: 52, py: 0.5 }}
          />
          <Tab
            label="Logs"
            value="/logs"
            component={RouterLink}
            to="/logs"
            aria-label="Logs"
            sx={{ minHeight: 52, py: 0.5 }}
          />
        </Tabs>
      </Toolbar>
    </AppBar>
  );
}
