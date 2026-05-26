import LayersRoundedIcon from '@mui/icons-material/LayersRounded';
import {
  Avatar,
  Box,
  Chip,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import type { ReactNode } from 'react';

export type ComposerInfoEntry = {
  key: string;
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  iconTestId?: string;
  valueTestId?: string;
};

export type ComposerInfoSection = {
  key: string;
  title: string;
  eyebrow?: string;
  summaryChipLabel?: string;
  entries: ComposerInfoEntry[];
  emptyMessage?: string;
  tone?: 'info' | 'default';
};

type ComposerInfoPanelProps = {
  heroTitle: string;
  heroDescription: string;
  heroIcon: ReactNode;
  heroTone?: 'info' | 'default';
  sections: ComposerInfoSection[];
  footerContent?: ReactNode;
  'data-testid'?: string;
};

export default function ComposerInfoPanel({
  heroTitle,
  heroDescription,
  heroIcon,
  heroTone = 'info',
  sections,
  footerContent,
  'data-testid': dataTestId,
}: ComposerInfoPanelProps) {
  const theme = useTheme();

  return (
    <Stack spacing={2} data-testid={dataTestId}>
      <Box
        sx={{
          p: 1.5,
          borderRadius: 3,
          border: `1px solid ${
            heroTone === 'info'
              ? alpha(theme.palette.info.main, 0.22)
              : theme.palette.divider
          }`,
          backgroundColor:
            heroTone === 'info'
              ? alpha(theme.palette.info.main, 0.08)
              : theme.palette.background.paper,
        }}
      >
        <Stack direction="row" spacing={1.25} alignItems="flex-start">
          <Avatar
            sx={{
              width: 34,
              height: 34,
              bgcolor:
                heroTone === 'info'
                  ? alpha(theme.palette.info.main, 0.16)
                  : alpha(theme.palette.text.primary, 0.08),
              color: heroTone === 'info' ? 'info.main' : 'text.secondary',
            }}
          >
            {heroIcon}
          </Avatar>
          <Stack spacing={0.25} minWidth={0}>
            <Typography variant="subtitle2" fontWeight={700}>
              {heroTitle}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {heroDescription}
            </Typography>
          </Stack>
        </Stack>
      </Box>

      {sections.map((section) => {
        const tone = section.tone ?? 'info';
        return (
          <Box
            key={section.key}
            sx={{
              borderRadius: 3,
              border: `1px solid ${theme.palette.divider}`,
              overflow: 'hidden',
              bgcolor: 'background.paper',
            }}
            data-testid={`composer-info-section-${section.key}`}
          >
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              spacing={1}
              sx={{
                px: 1.5,
                py: 1.25,
                borderBottom: `1px solid ${theme.palette.divider}`,
                bgcolor: alpha(theme.palette.text.primary, 0.03),
              }}
            >
              <Stack spacing={0.15} minWidth={0}>
                {section.eyebrow ? (
                  <Typography
                    variant="overline"
                    color="text.secondary"
                    sx={{ lineHeight: 1.2 }}
                  >
                    {section.eyebrow}
                  </Typography>
                ) : null}
                <Typography variant="subtitle2" fontWeight={700}>
                  {section.title}
                </Typography>
              </Stack>
              {section.summaryChipLabel ? (
                <Chip
                  size="small"
                  label={section.summaryChipLabel}
                  color={tone === 'info' ? 'info' : 'default'}
                  variant={tone === 'info' ? 'filled' : 'outlined'}
                />
              ) : null}
            </Stack>

            {section.entries.length > 0 ? (
              <Stack divider={<Divider flexItem />}>
                {section.entries.map((entry) => (
                  <Stack
                    key={entry.key}
                    direction="row"
                    spacing={1.25}
                    alignItems="center"
                    sx={{ px: 1.5, py: 1.25 }}
                  >
                    <Avatar
                      variant="rounded"
                      sx={{
                        width: 34,
                        height: 34,
                        borderRadius: 2,
                        bgcolor:
                          tone === 'info'
                            ? alpha(theme.palette.info.main, 0.12)
                            : alpha(theme.palette.text.primary, 0.07),
                        color: tone === 'info' ? 'info.main' : 'text.secondary',
                      }}
                    >
                      <Box
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        data-testid={entry.iconTestId}
                      >
                        {entry.icon ?? <LayersRoundedIcon fontSize="small" />}
                      </Box>
                    </Avatar>
                    <Stack spacing={0.2} minWidth={0} sx={{ flex: 1 }}>
                      <Typography variant="caption" color="text.secondary">
                        {entry.label}
                      </Typography>
                      <Typography
                        variant="body2"
                        data-testid={entry.valueTestId}
                        sx={{ wordBreak: 'break-word', fontWeight: 600 }}
                      >
                        {entry.value}
                      </Typography>
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            ) : (
              <Stack
                direction="row"
                spacing={1.25}
                alignItems="center"
                sx={{ px: 1.5, py: 1.5 }}
              >
                <Avatar
                  variant="rounded"
                  sx={{
                    width: 34,
                    height: 34,
                    borderRadius: 2,
                    bgcolor: alpha(theme.palette.text.primary, 0.07),
                    color: 'text.secondary',
                  }}
                >
                  <LayersRoundedIcon fontSize="small" />
                </Avatar>
                <Typography variant="body2" color="text.secondary">
                  {section.emptyMessage ?? 'No additional details are available.'}
                </Typography>
              </Stack>
            )}
          </Box>
        );
      })}

      {footerContent ? footerContent : null}
    </Stack>
  );
}
