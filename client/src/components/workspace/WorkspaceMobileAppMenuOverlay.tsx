import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import {
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { NavLink, useLocation } from 'react-router-dom';
import {
  WORKSPACE_DESTINATIONS,
  getWorkspaceDestinationPath,
} from './workspaceNavigation';

type WorkspaceMobileAppMenuOverlayProps = {
  open: boolean;
  onClose: () => void;
};

export default function WorkspaceMobileAppMenuOverlay({
  open,
  onClose,
}: WorkspaceMobileAppMenuOverlayProps) {
  const { pathname } = useLocation();
  const activePath = getWorkspaceDestinationPath(pathname);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      variant="temporary"
      ModalProps={{ keepMounted: false }}
      PaperProps={{
        sx: {
          width: '100vw',
          maxWidth: '100vw',
          height: '100vh',
          bgcolor: '#F4F6F8',
        },
      }}
      data-testid="workspace-mobile-app-menu-overlay"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{
            px: 2,
            py: 1.5,
            minHeight: 56,
            bgcolor: '#DCE7F2',
          }}
        >
          <Typography variant="h6" component="h2">
            Menu
          </Typography>
          <IconButton aria-label="Close menu" onClick={onClose}>
            <ChevronRightIcon />
          </IconButton>
        </Stack>
        <Divider />
        <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Jump to another workspace or utility page.
          </Typography>
        </Box>
        <List sx={{ px: 1.5, pb: 1.5 }}>
          {WORKSPACE_DESTINATIONS.map((destination) => {
            const selected = activePath === destination.path;
            return (
              <ListItemButton
                key={destination.path}
                component={NavLink}
                to={destination.path}
                onClick={onClose}
                selected={selected}
                sx={{
                  mb: 0.75,
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                  '&.Mui-selected': {
                    bgcolor: 'rgba(32, 53, 74, 0.08)',
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 40, color: 'text.secondary' }}>
                  {destination.icon}
                </ListItemIcon>
                <ListItemText
                  primary={destination.label}
                  secondary={destination.description}
                  primaryTypographyProps={{ fontWeight: 700 }}
                />
              </ListItemButton>
            );
          })}
        </List>
      </Box>
    </Drawer>
  );
}
