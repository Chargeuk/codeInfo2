import {
  DEFAULT_PREVIEW_ALLOWED_HOSTS,
  describePreviewAllowedHosts,
  resolvePreviewAllowedHosts,
} from '../../config/previewAllowedHosts';

describe('preview allowed hosts', () => {
  it('returns the default allowlist when the env value is unset', () => {
    expect(resolvePreviewAllowedHosts(undefined)).toEqual([
      ...DEFAULT_PREVIEW_ALLOWED_HOSTS,
    ]);
  });

  it('merges configured hosts with the defaults', () => {
    expect(
      resolvePreviewAllowedHosts(' dastapleton-everest.nord, example.internal '),
    ).toEqual([
      ...DEFAULT_PREVIEW_ALLOWED_HOSTS,
      'dastapleton-everest.nord',
      'example.internal',
    ]);
  });

  it('switches to allow-all mode when ALL appears in the env value', () => {
    expect(resolvePreviewAllowedHosts('foo.example,ALL')).toBe(true);
  });

  it('describes allow-all mode for preview logging', () => {
    expect(describePreviewAllowedHosts(true)).toBe('allow-all');
  });
});
