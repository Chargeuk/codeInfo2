import { Box, List, ListItemButton, Stack, Typography } from '@mui/material';
import { NavLink, useInRouterContext, useLocation } from 'react-router-dom';
import {
  WORKSPACE_DESTINATIONS,
  getWorkspaceDestinationPath,
} from './workspaceNavigation';

type WorkspaceAppRailContentProps = {
  pathname: string;
  inRouter: boolean;
};

function WorkspaceAppRailContent({
  pathname,
  inRouter,
}: WorkspaceAppRailContentProps) {
  const fallbackPath = pathname || '/chat';
  const activePath = getWorkspaceDestinationPath(
    fallbackPath === '/' && !inRouter ? '/chat' : fallbackPath,
  );

  return (
    <Box
      component="nav"
      aria-label="Workspace navigation"
      sx={{
        width: 84,
        flexShrink: 0,
        bgcolor: '#172635',
        color: 'common.white',
        display: 'flex',
        flexDirection: 'column',
        py: 1.25,
        borderRight: '1px solid',
        borderColor: 'rgba(255, 255, 255, 0.08)',
      }}
      data-testid="workspace-app-rail"
    >
      <List
        disablePadding
        sx={{ px: 0.75, py: 0.25, display: 'grid', gap: 0.5 }}
      >
        {WORKSPACE_DESTINATIONS.map((destination) => {
          const selected = activePath === destination.path;
          return (
            <ListItemButton
              key={destination.path}
              {...(inRouter
                ? { component: NavLink, to: destination.path }
                : { type: 'button' as const })}
              selected={selected}
              aria-label={destination.label}
              sx={{
                borderRadius: 1,
                color: 'inherit',
                minHeight: 64,
                px: 0.5,
                py: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 0.5,
                textAlign: 'center',
                '&.active': {
                  bgcolor: 'rgba(255, 255, 255, 0.11)',
                },
                '&.Mui-selected': {
                  bgcolor: 'rgba(255, 255, 255, 0.14)',
                },
                '&:hover': {
                  bgcolor: 'rgba(255, 255, 255, 0.08)',
                },
              }}
            >
              <Box
                sx={{
                  minWidth: 0,
                  color: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: selected ? 1 : 0.82,
                }}
              >
                {destination.icon}
              </Box>
              <Stack spacing={0}>
                <Typography
                  component="span"
                  sx={{
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    lineHeight: 1.1,
                    letterSpacing: 0,
                    color: 'inherit',
                  }}
                >
                  {destination.label}
                </Typography>
              </Stack>
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
}

function WorkspaceAppRailWithRouter() {
  const { pathname } = useLocation();
  return <WorkspaceAppRailContent pathname={pathname} inRouter />;
}

export default function WorkspaceAppRail() {
  const inRouter = useInRouterContext();
  if (inRouter) {
    return <WorkspaceAppRailWithRouter />;
  }

  const fallbackPath =
    typeof window !== 'undefined' ? window.location.pathname : '/chat';
  return <WorkspaceAppRailContent pathname={fallbackPath} inRouter={false} />;
}
