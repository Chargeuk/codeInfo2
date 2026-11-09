import {
  buildBubbleMetadataSummary,
  formatBubbleTimestamp,
} from './chatTranscriptFormatting';

const exact = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value));

describe('transcript Info timestamps', () => {
  it('formats the actual instant in local time with seconds', () => {
    const value = '2026-05-23T14:21:37.000+02:00';
    expect(formatBubbleTimestamp(value)).toBe(exact(value));
  });

  it.each([undefined, '', 'invalid-date'])(
    'does not substitute now for an unavailable instant: %s',
    (value) => {
      expect(formatBubbleTimestamp(value)).toBeNull();
      expect(buildBubbleMetadataSummary({ createdAt: value })).toEqual([]);
    },
  );

  it('keeps creation, first update, and last update as distinct exact instants', () => {
    const createdAt = '2026-05-23T12:00:01.000Z';
    const firstUpdateAt = '2026-05-23T12:00:07.000Z';
    const lastUpdateAt = '2026-05-23T12:02:38.000Z';
    expect(
      buildBubbleMetadataSummary({ createdAt, firstUpdateAt, lastUpdateAt }),
    ).toEqual([
      { label: 'Time', value: exact(createdAt) },
      { label: 'First update', value: exact(firstUpdateAt) },
      { label: 'Last update', value: exact(lastUpdateAt) },
    ]);
  });

  it('does not fabricate update instants from a legacy creation date', () => {
    const createdAt = '2026-05-23T12:00:01.000Z';
    expect(buildBubbleMetadataSummary({ createdAt })).toEqual([
      { label: 'Time', value: exact(createdAt) },
    ]);
  });

  it('omits invalid instants independently and preserves real metadata', () => {
    const lastUpdateAt = '2026-05-23T12:02:38.000Z';
    expect(
      buildBubbleMetadataSummary({
        createdAt: 'invalid',
        firstUpdateAt: 'invalid',
        lastUpdateAt,
        provider: 'codex',
        timing: { totalTimeSec: 2.5 },
      }),
    ).toEqual([
      { label: 'Last update', value: exact(lastUpdateAt) },
      { label: 'Timing', value: 'Time: 2.5s' },
      { label: 'Provider', value: 'codex' },
    ]);
  });
});
