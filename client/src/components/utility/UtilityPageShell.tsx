import MenuIcon from '@mui/icons-material/Menu';
import {
  Box,
  Container,
  Divider,
  IconButton,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { type ReactNode, useState } from 'react';
import WorkspaceAppRail from '../workspace/WorkspaceAppRail';
import WorkspaceMobileAppMenuOverlay from '../workspace/WorkspaceMobileAppMenuOverlay';

type UtilityPageShellProps = {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
};

export default function UtilityPageShell({
  title,
  subtitle,
  children,
}: UtilityPageShellProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        width: '100%',
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
      data-testid="utility-page-shell"
    >
      {!isMobile ? <WorkspaceAppRail /> : null}
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {isMobile ? (
          <>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{
                px: 2,
                py: 1.5,
                minHeight: 64,
                bgcolor: 'background.paper',
              }}
            >
              <Typography variant="h5" component="h1">
                {title}
              </Typography>
              <IconButton
                aria-label="Open menu"
                onClick={() => setMobileMenuOpen(true)}
                edge="end"
              >
                <MenuIcon />
              </IconButton>
            </Stack>
            <Divider />
            <WorkspaceMobileAppMenuOverlay
              open={mobileMenuOpen}
              onClose={() => setMobileMenuOpen(false)}
            />
          </>
        ) : (
          <Box sx={{ px: { xs: 2, md: 3 }, pt: { xs: 2, md: 3 } }}>
            <Stack spacing={0.5} sx={{ maxWidth: 920 }}>
              <Typography variant="h4" component="h1">
                {title}
              </Typography>
              {subtitle ? (
                <Typography variant="body1" color="text.secondary">
                  {subtitle}
                </Typography>
              ) : null}
            </Stack>
          </Box>
        )}
        <Container
          maxWidth={false}
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            px: { xs: 2, md: 3 },
            pt: { xs: 2, md: 2.5 },
            pb: { xs: 3, md: 4 },
          }}
        >
          {children}
        </Container>
      </Box>
    </Box>
  );
}
