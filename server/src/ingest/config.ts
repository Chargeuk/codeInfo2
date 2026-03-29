import { IngestConfig } from './types.js';

const DEFAULT_LARGE_TEXT_THRESHOLD_BYTES = 65536;

const defaultIncludes = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'json',
  'jsonc',
  'md',
  'mdx',
  'txt',
  'py',
  'java',
  'kt',
  'kts',
  'go',
  'rs',
  'rb',
  'php',
  'cs',
  'cpp',
  'cc',
  'c',
  'h',
  'hpp',
  'swift',
  'scala',
  'clj',
  'cljs',
  'edn',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'env',
  'sql',
];

const defaultExcludes = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'logs',
  'vendor',
];

function parseFiniteNumberWithFallback(
  rawValue: string | undefined,
  fallback: number,
  { min }: { min?: number } = {},
): number {
  const parsed = Number(rawValue ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  if (typeof min === 'number' && parsed < min) return fallback;
  return parsed;
}

export function resolveConfig(): IngestConfig {
  const envIncludes =
    process.env.CODEINFO_INGEST_INCLUDE?.split(',')
      .filter(Boolean)
      .map((s) => s.trim()) ?? [];
  const includes = envIncludes.length ? envIncludes : defaultIncludes;

  const envExcludes =
    process.env.CODEINFO_INGEST_EXCLUDE?.split(',')
      .filter(Boolean)
      .map((s) => s.trim()) ?? [];
  const excludes = Array.from(new Set([...defaultExcludes, ...envExcludes]));

  const tokenSafetyMargin = parseFiniteNumberWithFallback(
    process.env.CODEINFO_INGEST_TOKEN_MARGIN,
    0.85,
  );
  const fallbackTokenLimit = parseFiniteNumberWithFallback(
    process.env.CODEINFO_INGEST_FALLBACK_TOKENS,
    2048,
    { min: 1 },
  );
  const rawFlushEvery = Number(process.env.CODEINFO_INGEST_FLUSH_EVERY ?? 20);
  const flushEvery = Number.isFinite(rawFlushEvery)
    ? Math.min(500, Math.max(1, Math.floor(rawFlushEvery)))
    : 20;
  const largeTextThresholdBytes = Math.floor(
    parseFiniteNumberWithFallback(
      process.env.CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES,
      DEFAULT_LARGE_TEXT_THRESHOLD_BYTES,
      { min: 1 },
    ),
  );

  return {
    includes,
    excludes,
    tokenSafetyMargin,
    fallbackTokenLimit,
    flushEvery,
    largeTextThresholdBytes,
  };
}
