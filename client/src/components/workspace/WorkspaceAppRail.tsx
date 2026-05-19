import {
  Box,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import { NavLink, useLocation } from 'react-router-dom';
import {
  WORKSPACE_DESTINATIONS,
  getWorkspaceDestinationPath,
} from './workspaceNavigation';

export default function WorkspaceAppRail() {
  const { pathname } = useLocation();
  const activePath = getWorkspaceDestinationPath(pathname);

  return (
    <Box
      component="nav"
      aria-label="Workspace navigation"
      sx={{
        width: 96,
        flexShrink: 0,
        bgcolor: '#172635',
        color: 'common.white',
        display: 'flex',
        flexDirection: 'column',
        py: 1,
        borderRight: '1px solid',
        borderColor: 'rgba(255, 255, 255, 0.08)',
      }}
      data-testid="workspace-app-rail"
    >
      <List disablePadding sx={{ px: 0.5, py: 0.5 }}>
        {WORKSPACE_DESTINATIONS.map((destination) => {
          const selected = activePath === destination.path;
          return (
            <ListItemButton
              key={destination.path}
              component={NavLink}
              to={destination.path}
              selected={selected}
              aria-label={destination.label}
              sx={{
                my: 0.25,
                borderRadius: 1,
                color: 'inherit',
                minHeight: 52,
                px: 1,
                '&.active': {
                  bgcolor: 'rgba(255, 255, 255, 0.12)',
                },
                '&.Mui-selected': {
                  bgcolor: 'rgba(255, 255, 255, 0.14)',
                },
                '&:hover': {
                  bgcolor: 'rgba(255, 255, 255, 0.1)',
                },
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: 0,
                  color: 'inherit',
                  mr: 1,
                  opacity: selected ? 1 : 0.82,
                }}
              >
                {destination.icon}
              </ListItemIcon>
              <ListItemText
                primary={destination.label}
                secondary={destination.description}
                primaryTypographyProps={{
                  fontSize: '0.775rem',
                  fontWeight: 700,
                  lineHeight: 1.15,
                }}
                secondaryTypographyProps={{
                  fontSize: '0.62rem',
                  lineHeight: 1.1,
                  color: 'rgba(255, 255, 255, 0.7)',
                }}
              />
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
}
