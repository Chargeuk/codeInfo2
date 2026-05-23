import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import { IconButton } from '@mui/material';
import type { CSSProperties, MouseEventHandler } from 'react';

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
  const effectiveTestId =
    isStopButton && dataTestId === 'chat-send' ? 'chat-stop' : dataTestId;
  const srOnlyStyles: CSSProperties = {
    border: 0,
    clip: 'rect(0 0 0 0)',
    height: '1px',
    margin: '-1px',
    overflow: 'hidden',
    padding: 0,
    position: 'absolute',
    whiteSpace: 'nowrap',
    width: '1px',
  };

  return (
    <IconButton
      type={isStopButton ? 'button' : type}
      onClick={onClick}
      disabled={disabled}
      data-testid={effectiveTestId}
      aria-label={isStopButton ? 'Stop' : 'Send'}
      sx={{
        position: 'relative',
        width: { xs: 32, sm: 42 },
        height: { xs: 32, sm: 42 },
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
        <StopRoundedIcon fontSize="small" />
      ) : (
        <ArrowUpwardRoundedIcon fontSize="small" />
      )}
      <span style={srOnlyStyles}>{isStopButton ? 'Stopping' : 'Send'}</span>
    </IconButton>
  );
}
