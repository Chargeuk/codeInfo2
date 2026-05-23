import { Box, Button, IconButton, Stack, Typography } from '@mui/material';
import type { MouseEventHandler, ReactNode } from 'react';

type ComposerFooterButtonProps = {
  icon: ReactNode;
  label: string;
  value?: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  selected?: boolean;
  iconOnly?: boolean;
  'data-testid'?: string;
  ariaLabel?: string;
  role?: string;
  ariaHaspopup?: string;
  ariaExpanded?: boolean;
  hiddenInputValue?: string;
  iconOnlyOnMobile?: boolean;
};

export default function ComposerFooterButton({
  icon,
  label,
  value,
  onClick,
  disabled = false,
  selected = false,
  iconOnly = false,
  'data-testid': dataTestId,
  ariaLabel,
  role,
  ariaHaspopup,
  ariaExpanded,
  hiddenInputValue,
  iconOnlyOnMobile = false,
}: ComposerFooterButtonProps) {
  if (iconOnly) {
    return (
      <IconButton
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel ?? label}
        aria-disabled={disabled ? 'true' : undefined}
        aria-haspopup={ariaHaspopup}
        aria-expanded={ariaExpanded}
        role={role}
        data-testid={dataTestId}
        sx={{
          width: { xs: 36, sm: 48 },
          height: { xs: 36, sm: 48 },
          borderRadius: { xs: 2.5, sm: 3 },
          border: '1px solid',
          borderColor: selected ? 'primary.main' : 'divider',
          bgcolor: 'background.paper',
          color: selected ? 'primary.main' : 'text.primary',
          boxShadow: selected ? '0 0 0 1px rgba(47, 128, 237, 0.15)' : 'none',
          '&:hover': {
            bgcolor: 'action.hover',
          },
        }}
      >
        {icon}
      </IconButton>
    );
  }

  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      data-testid={dataTestId}
      variant="outlined"
      aria-label={ariaLabel ?? label}
      aria-disabled={disabled ? 'true' : undefined}
      aria-haspopup={ariaHaspopup}
      aria-expanded={ariaExpanded}
      role={role}
      sx={{
        flex: iconOnlyOnMobile
          ? { xs: '0 0 auto', sm: '0 1 auto' }
          : { xs: '1 1 0', sm: '0 1 auto' },
        width: iconOnlyOnMobile
          ? { xs: 36, sm: 'auto' }
          : { xs: 0, sm: 'auto' },
        minHeight: { xs: 36, sm: 48 },
        minWidth: 0,
        px: iconOnlyOnMobile ? { xs: 0.5, sm: 1.5 } : { xs: 0.75, sm: 1.5 },
        py: { xs: 0.5, sm: 0.75 },
        borderRadius: { xs: 2.5, sm: 3 },
        justifyContent: iconOnlyOnMobile
          ? { xs: 'center', sm: 'flex-start' }
          : 'flex-start',
        textTransform: 'none',
        borderColor: selected ? 'primary.main' : 'divider',
        color: 'text.primary',
        bgcolor: 'background.paper',
        boxShadow: selected ? '0 0 0 1px rgba(47, 128, 237, 0.12)' : 'none',
        '&:hover': {
          bgcolor: 'action.hover',
          borderColor: selected ? 'primary.main' : 'text.secondary',
        },
        '& .composer-footer-button-icon': {
          flexShrink: 0,
          color: selected ? 'primary.main' : 'text.secondary',
        },
        '& .composer-footer-button-label': {
          color: 'text.secondary',
          fontSize: { xs: '0.62rem', sm: '0.75rem' },
          display: { xs: 'none', sm: 'block' },
        },
        '& .composer-footer-button-value': {
          color: 'text.primary',
          fontSize: { xs: '0.72rem', sm: '0.875rem' },
        },
      }}
    >
      <Stack
        direction="row"
        spacing={
          iconOnlyOnMobile ? { xs: 0, sm: 1.25 } : { xs: 0.75, sm: 1.25 }
        }
        alignItems="center"
        sx={{ minWidth: 0 }}
      >
        {hiddenInputValue !== undefined ? (
          <Box
            component="input"
            value={hiddenInputValue}
            readOnly
            tabIndex={-1}
            aria-hidden="true"
            sx={{
              position: 'absolute',
              width: 1,
              height: 1,
              p: 0,
              m: -1,
              overflow: 'hidden',
              clip: 'rect(0 0 0 0)',
              whiteSpace: 'nowrap',
              border: 0,
            }}
          />
        ) : null}
        <Box
          className="composer-footer-button-icon"
          sx={{ display: 'flex', alignItems: 'center' }}
        >
          {icon}
        </Box>
        <Stack
          className="composer-footer-button-text"
          sx={{ minWidth: 0, textAlign: 'left', overflow: 'hidden' }}
          display={iconOnlyOnMobile ? { xs: 'none', sm: 'flex' } : undefined}
          spacing={0}
        >
          <Typography
            className="composer-footer-button-label"
            variant="caption"
            sx={{ lineHeight: 1.1 }}
            noWrap
          >
            {label}
          </Typography>
          {value !== undefined ? (
            <Typography
              className="composer-footer-button-value"
              variant="body2"
              sx={{ lineHeight: 1.1, fontWeight: 500 }}
              noWrap
            >
              {value}
            </Typography>
          ) : null}
        </Stack>
      </Stack>
    </Button>
  );
}
