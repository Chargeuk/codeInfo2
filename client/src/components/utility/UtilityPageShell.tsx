import {
  Box,
  Container,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { type ReactNode, useState } from 'react';
import WorkspaceAppRail from '../workspace/WorkspaceAppRail';
import WorkspaceMobileAppMenuOverlay from '../workspace/WorkspaceMobileAppMenuOverlay';
import WorkspaceMobileTopBar from '../workspace/WorkspaceMobileTopBar';

type UtilityPageShellProps = {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  desktopLayout?: 'standard' | 'data';
};

export default function UtilityPageShell({
  title,
  subtitle,
  children,
  desktopLayout = 'standard',
}: UtilityPageShellProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isDataDesktopLayout = desktopLayout === 'data';

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
      data-utility-shell-layout={desktopLayout}
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
            <WorkspaceMobileTopBar
              title={title}
              showConversationsButton={false}
              onConversationsClick={() => undefined}
              onMenuClick={() => setMobileMenuOpen(true)}
            />
            <WorkspaceMobileAppMenuOverlay
              open={mobileMenuOpen}
              onClose={() => setMobileMenuOpen(false)}
            />
          </>
        ) : (
          <Box sx={{ px: { xs: 2, md: 3 }, pt: { xs: 2, md: 3 } }}>
            <Stack
              spacing={0.5}
              sx={{
                width: '100%',
                maxWidth: isDataDesktopLayout ? 'none' : 920,
              }}
            >
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
            px: { xs: 1.25, md: 3 },
            pt: { xs: 1.25, md: 2.5 },
            pb: { xs: 1.5, md: 4 },
            overflowY: 'auto',
            overflowX: {
              xs: 'hidden',
              md: isDataDesktopLayout ? 'visible' : 'hidden',
            },
          }}
        >
          {children}
        </Container>
      </Box>
    </Box>
  );
}
