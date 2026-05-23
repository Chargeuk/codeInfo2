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
          width: 48,
          height: 48,
          borderRadius: 3,
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
        minHeight: 48,
        minWidth: 0,
        px: 1.5,
        py: 0.75,
        borderRadius: 3,
        justifyContent: 'flex-start',
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
        },
        '& .composer-footer-button-value': {
          color: 'text.primary',
        },
      }}
    >
      <Stack
        direction="row"
        spacing={1.25}
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
        <Stack sx={{ minWidth: 0, textAlign: 'left' }} spacing={0}>
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
              sx={{ lineHeight: 1.2, fontWeight: 500 }}
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
