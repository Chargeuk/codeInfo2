import { formatConversationRowTimestamp } from './conversationRowFormatting';

const nowMs = Date.parse('2026-05-23T12:00:00.000Z');
const cutoffMs = 90 * 60 * 1000;
const exact = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

describe('formatConversationRowTimestamp', () => {
  it.each([-1, 1])(
    'switches from relative to exact at 90 minutes (direction %s)',
    (direction) => {
      const recent = new Date(nowMs + direction * (cutoffMs - 1)).toISOString();
      const relative = new Intl.RelativeTimeFormat(undefined, {
        numeric: 'auto',
      }).format(direction, 'hour');
      expect(formatConversationRowTimestamp(recent, nowMs)).toBe(relative);

      for (const ageMs of [cutoffMs, cutoffMs + 1, 24 * 60 * 60 * 1000]) {
        const value = new Date(nowMs + direction * ageMs).toISOString();
        expect(formatConversationRowTimestamp(value, nowMs)).toBe(exact(value));
      }
    },
  );

  it.each([undefined, null, '', ' ', 'not-a-date'])(
    'keeps unavailable legacy timestamps unavailable: %s',
    (value) => {
      expect(formatConversationRowTimestamp(value, nowMs)).toBe('—');
    },
  );
});
