import type { CSSProperties, ReactNode } from 'react';
import { Box } from '@mui/material';

type SharedTranscriptSurfaceProps = {
  children: ReactNode;
};

export const sharedTranscriptSurfaceSx = {
  flex: '1 1 0%',
  minHeight: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
} as const;

export const sharedTranscriptSurfaceStyle: CSSProperties = {
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minHeight: '0px',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  paddingLeft: '0px',
  paddingRight: '0px',
};

export default function SharedTranscriptSurface({
  children,
}: SharedTranscriptSurfaceProps) {
  return (
    <Box style={sharedTranscriptSurfaceStyle} sx={sharedTranscriptSurfaceSx}>
      {children}
    </Box>
  );
}
