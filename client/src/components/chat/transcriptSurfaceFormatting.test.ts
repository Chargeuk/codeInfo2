import {
  formatTranscriptResponseTime,
  formatTranscriptTimestamp,
} from './transcriptSurfaceFormatting';

const nowMs = Date.parse('2026-05-23T12:00:00.000Z');
const cutoffMs = 90 * 60 * 1000;
const exact = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value));

describe('formatTranscriptTimestamp', () => {
  it.each([false, true])(
    'switches at exactly 90 minutes, including compact=%s',
    (compact) => {
      for (const direction of [-1, 1]) {
        const recent = new Date(
          nowMs + direction * (cutoffMs - 1),
        ).toISOString();
        expect(formatTranscriptTimestamp(recent, { nowMs, compact })).toBe(
          direction < 0 ? '1h ago' : 'in 1h',
        );

        for (const ageMs of [cutoffMs, cutoffMs + 1, 24 * 60 * 60 * 1000]) {
          const value = new Date(nowMs + direction * ageMs).toISOString();
          expect(formatTranscriptTimestamp(value, { nowMs, compact })).toBe(
            exact(value),
          );
        }
      }
    },
  );

  it.each([undefined, '', 'not-a-date'])(
    'leaves an unavailable timestamp unavailable: %s',
    (value) => {
      expect(formatTranscriptTimestamp(value, { nowMs })).toBe('—');
    },
  );

  it('keeps response time as a duration', () => {
    expect(formatTranscriptResponseTime({ totalTimeSec: 90.25 })).toBe(
      '90.25s',
    );
    expect(formatTranscriptResponseTime(undefined)).toBeNull();
  });
});
