export const transcriptSurfaceTokens = {
  assistant: {
    background: '#F3F8FF',
    text: '#1F2933',
    secondaryText: '#52606D',
    action: '#2F80ED',
  },
  user: {
    background: '#111827',
    text: '#FFFFFF',
    secondaryText: '#D7DEE7',
    confirmedTick: '#2F80ED',
  },
  statusChip: {
    working: {
      background: '#E8F1FF',
      text: '#2F80ED',
    },
    complete: {
      background: '#E7F7EC',
      text: '#2F855A',
    },
    failed: {
      background: '#FDECEC',
      text: '#C53030',
    },
    stopped: {
      background: '#FFF4E5',
      text: '#B7791F',
    },
  },
} as const;

export type TranscriptStreamStatus =
  | 'processing'
  | 'complete'
  | 'failed'
  | 'stopped';
