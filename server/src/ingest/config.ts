import { IngestConfig } from './types.js';

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

export function resolveConfig(): IngestConfig {
  const envIncludes =
    process.env.INGEST_INCLUDE?.split(',')
      .filter(Boolean)
      .map((s) => s.trim()) ?? [];
  const includes = envIncludes.length ? envIncludes : defaultIncludes;

  const envExcludes =
    process.env.INGEST_EXCLUDE?.split(',')
      .filter(Boolean)
      .map((s) => s.trim()) ?? [];
  const excludes = Array.from(new Set([...defaultExcludes, ...envExcludes]));

  const tokenSafetyMargin = Number(process.env.INGEST_TOKEN_MARGIN ?? 0.85);
  const fallbackTokenLimit = Number(process.env.INGEST_FALLBACK_TOKENS ?? 2048);

  return {
    includes,
    excludes,
    tokenSafetyMargin: Number.isFinite(tokenSafetyMargin)
      ? tokenSafetyMargin
      : 0.85,
    fallbackTokenLimit: Number.isFinite(fallbackTokenLimit)
      ? fallbackTokenLimit
      : 2048,
  };
}
