import { describe, expect, it } from '@jest/globals';

import { normalizeReasoningCapabilityStrings } from '../utils/reasoningCapabilities';

describe('normalizeReasoningCapabilityStrings', () => {
  it('returns empty array for non-arrays', () => {
    expect(normalizeReasoningCapabilityStrings(undefined)).toEqual([]);
    expect(normalizeReasoningCapabilityStrings('high')).toEqual([]);
    expect(normalizeReasoningCapabilityStrings({})).toEqual([]);
  });

  it('trims values and drops empty entries', () => {
    expect(
      normalizeReasoningCapabilityStrings([' minimal ', '', '   ', 'high']),
    ).toEqual(['minimal', 'high']);
  });

  it('de-duplicates repeated values while preserving first-seen order', () => {
    expect(
      normalizeReasoningCapabilityStrings([
        'high',
        'minimal',
        'high',
        ' minimal ',
        'turbo',
      ]),
    ).toEqual(['high', 'minimal', 'turbo']);
  });

  it('filters non-string values', () => {
    expect(
      normalizeReasoningCapabilityStrings(['high', 1, null, 'minimal', {}]),
    ).toEqual(['high', 'minimal']);
  });
});
