import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import { IconButton } from '@mui/material';
import type { MouseEventHandler } from 'react';

type ComposerSendButtonProps = {
  showStop?: boolean;
  isStopping?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: MouseEventHandler<HTMLButtonElement>;
  'data-testid'?: string;
};

export default function ComposerSendButton({
  showStop = false,
  isStopping = false,
  disabled = false,
  type = 'submit',
  onClick,
  'data-testid': dataTestId,
}: ComposerSendButtonProps) {
  const isStopButton = showStop;

  return (
    <IconButton
      type={isStopButton ? 'button' : type}
      onClick={onClick}
      disabled={disabled}
      data-testid={dataTestId}
      aria-label={isStopButton ? 'Stop' : 'Send'}
      sx={{
        width: 48,
        height: 48,
        borderRadius: '50%',
        color: '#FFFFFF',
        bgcolor: isStopButton ? 'error.main' : '#111827',
        boxShadow: '0 8px 18px rgba(15, 23, 42, 0.15)',
        '&:hover': {
          bgcolor: isStopButton ? 'error.dark' : '#0F172A',
        },
        '&.Mui-disabled': {
          bgcolor: isStopButton ? 'error.main' : '#111827',
          color: '#FFFFFF',
          opacity: isStopping ? 0.8 : 0.45,
        },
      }}
    >
      {isStopButton ? (
        <StopRoundedIcon fontSize="medium" />
      ) : (
        <ArrowUpwardRoundedIcon fontSize="medium" />
      )}
    </IconButton>
  );
}
