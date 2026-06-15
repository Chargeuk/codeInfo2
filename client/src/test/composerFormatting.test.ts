import {
  formatEndpointAwareModelLabel,
  formatEndpointIdentityLabel,
} from '../components/workspace/composer/composerFormatting';

describe('composerFormatting', () => {
  it('does not prepend endpoint hosts to endpoint-backed model labels by default', () => {
    expect(
      formatEndpointAwareModelLabel(
        'SparkUnsloth / unsloth/gemma-3-27b',
        'http://192.168.1.3:8888/v1',
      ),
    ).toBe('SparkUnsloth / unsloth/gemma-3-27b');
  });

  it('adds a compact endpoint disambiguator only when requested', () => {
    expect(
      formatEndpointAwareModelLabel('gpt-5.2', 'https://alpha.example/alt/v1', {
        includePathHint: true,
      }),
    ).toBe('gpt-5.2 (alpha.example / alt)');
  });

  it('prefers the configured endpoint label in endpoint identity displays', () => {
    expect(
      formatEndpointIdentityLabel('SparkUnsloth', 'http://192.168.1.3:8888/v1'),
    ).toBe('SparkUnsloth');
  });

  it('falls back to host and path when no endpoint label is available', () => {
    expect(
      formatEndpointIdentityLabel(undefined, 'https://alpha.example/alt/v1'),
    ).toBe('alpha.example / alt');
  });
});
