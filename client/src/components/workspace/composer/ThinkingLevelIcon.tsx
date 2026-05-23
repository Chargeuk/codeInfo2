import { Box } from '@mui/material';

type ThinkingLevel =
  | 'none'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

type ThinkingLevelIconProps = {
  level?: string | null;
  size?: number;
  'data-testid'?: string;
};

const BAR_HEIGHTS = [6, 9, 12, 15];

const resolveThinkingLevel = (value?: string | null): ThinkingLevel => {
  const normalized = value?.trim().toLowerCase() ?? '';
  switch (normalized) {
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'xhigh':
      return 'xhigh';
    case 'none':
    case 'off':
    case 'minimal':
      return 'none';
    default:
      return 'none';
  }
};

const getLevelColor = (level: ThinkingLevel) => {
  switch (level) {
    case 'low':
      return '#60A5FA';
    case 'medium':
      return '#2563EB';
    case 'high':
      return '#4F46E5';
    case 'xhigh':
      return '#D97706';
    default:
      return '#94A3B8';
  }
};

const getActiveBarCount = (level: ThinkingLevel) => {
  switch (level) {
    case 'low':
      return 1;
    case 'medium':
      return 2;
    case 'high':
      return 3;
    case 'xhigh':
      return 4;
    default:
      return 0;
  }
};

export default function ThinkingLevelIcon({
  level,
  size = 16,
  'data-testid': dataTestId,
}: ThinkingLevelIconProps) {
  const resolvedLevel = resolveThinkingLevel(level);
  const activeBarCount = getActiveBarCount(resolvedLevel);
  const activeColor = getLevelColor(resolvedLevel);

  return (
    <Box
      className="thinking-level-icon"
      data-testid={dataTestId}
      aria-hidden="true"
      sx={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        gap: '2px',
        flexShrink: 0,
      }}
    >
      {BAR_HEIGHTS.map((height, index) => {
        const isActive = index < activeBarCount;
        return (
          <Box
            // eslint-disable-next-line react/no-array-index-key
            key={`${height}-${index}`}
            sx={{
              width: 2.5,
              height,
              borderRadius: 999,
              bgcolor: isActive ? activeColor : 'rgba(148, 163, 184, 0.32)',
              border:
                resolvedLevel === 'none'
                  ? '1px solid rgba(148, 163, 184, 0.55)'
                  : 'none',
              boxSizing: 'border-box',
            }}
          />
        );
      })}
    </Box>
  );
}
