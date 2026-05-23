import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import {
  Box,
  Divider,
  Drawer,
  Button,
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
          borderRadius: 0,
          boxShadow: 'none',
          overflow: 'hidden',
        },
      }}
      data-testid="workspace-mobile-app-menu-overlay"
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          bgcolor: '#F4F6F8',
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{
            px: 2.5,
            py: 2,
            minHeight: 88,
            bgcolor: '#DCE7F2',
          }}
        >
          <Typography
            variant="h4"
            component="h2"
            sx={{ fontWeight: 700, color: '#1F2933', lineHeight: 1.1 }}
          >
            Menu
          </Typography>
          <Button
            onClick={onClose}
            aria-label="Close menu"
            startIcon={<CloseIcon fontSize="small" />}
            sx={{
              color: '#1F2933',
              fontWeight: 500,
              textTransform: 'none',
              fontSize: '1rem',
              minWidth: 0,
              px: 0.5,
              py: 0.25,
              alignSelf: 'center',
              '& .MuiButton-startIcon': {
                marginRight: 0.75,
              },
            }}
          >
            Close
          </Button>
        </Stack>
        <Divider sx={{ borderColor: '#D9E2EC' }} />
        <Box sx={{ px: 2.5, pt: 2.5, pb: 1.25 }}>
          <Typography
            variant="body1"
            sx={{ color: '#52606D', lineHeight: 1.5 }}
          >
            Navigate to key areas of CodeInfo.
          </Typography>
        </Box>
        <List
          sx={{
            px: 2.5,
            pb: 2,
            pt: 0,
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
          }}
        >
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
                  px: 0,
                  py: 1.5,
                  minHeight: 96,
                  borderRadius: 0,
                  borderBottom: '1px solid',
                  borderBottomColor: '#D9E2EC',
                  bgcolor: 'transparent',
                  alignItems: 'center',
                  gap: 1.5,
                  '&:first-of-type': {
                    borderTop: '1px solid #D9E2EC',
                  },
                  '& .MuiListItemIcon-root': {
                    color: '#52606D',
                  },
                  '& .MuiListItemText-primary': {
                    color: '#1F2933',
                  },
                  '& .MuiListItemText-secondary': {
                    color: '#52606D',
                  },
                  '&.Mui-selected': {
                    bgcolor: 'rgba(32, 53, 74, 0.08)',
                    boxShadow: 'inset 0 0 0 1px rgba(32, 53, 74, 0.12)',
                  },
                  '&.Mui-selected:hover': {
                    bgcolor: 'rgba(32, 53, 74, 0.1)',
                  },
                  '&:hover': {
                    bgcolor: 'rgba(32, 53, 74, 0.04)',
                  },
                }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 64,
                    color: '#52606D',
                    '& svg': { fontSize: 32 },
                  }}
                >
                  {destination.icon}
                </ListItemIcon>
                <ListItemText
                  primary={destination.label}
                  secondary={destination.description}
                  primaryTypographyProps={{
                    sx: {
                      fontWeight: 700,
                      color: '#1F2933',
                      lineHeight: 1.1,
                    },
                  }}
                  secondaryTypographyProps={{
                    sx: {
                      color: '#52606D',
                      lineHeight: 1.4,
                    },
                  }}
                  sx={{ my: 0 }}
                />
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    color: '#52606D',
                    pl: 1,
                    pr: 0.25,
                  }}
                >
                  <ChevronRightIcon fontSize="medium" />
                </Box>
              </ListItemButton>
            );
          })}
        </List>
      </Box>
    </Drawer>
  );
}
