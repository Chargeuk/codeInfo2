import MenuIcon from '@mui/icons-material/Menu';
import {
  AppBar,
  Box,
  IconButton,
  Stack,
  Toolbar,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useState } from 'react';
import WorkspaceAppRail from './workspace/WorkspaceAppRail';
import WorkspaceMobileAppMenuOverlay from './workspace/WorkspaceMobileAppMenuOverlay';

export default function NavBar() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (!isMobile) {
    return <WorkspaceAppRail />;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <AppBar position="static" elevation={0} color="default">
        <Toolbar
          sx={{
            minHeight: 56,
            px: 2,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <Stack spacing={0.25}>
            <Typography variant="h6" component="h1">
              CodeInfo2
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Workspace navigation
            </Typography>
          </Stack>
          <IconButton
            aria-label="Open menu"
            edge="end"
            onClick={() => setMobileMenuOpen(true)}
          >
            <MenuIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      <WorkspaceMobileAppMenuOverlay
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />
    </Box>
  );
}
