import fs from 'node:fs';
import path from 'node:path';

export const CUCUMBER_SUPPORT_IMPORTS = [
  'src/test/support/chromaContainer.ts',
  'src/test/support/mongoContainer.ts',
  'src/test/support/registerCucumberEnvIsolation.ts',
];
const CUCUMBER_FEATURE_ROOT = 'src/test/features';
const CUCUMBER_STEP_ROOT = 'src/test/steps';

export const normalizeServerPath = (value) => {
  if (path.isAbsolute(value)) return value;
  const normalized = value.replace(/\\/g, '/');
  const withoutDotPrefix = normalized.startsWith('./')
    ? normalized.slice(2)
    : normalized;
  if (withoutDotPrefix.startsWith('server/')) {
    return withoutDotPrefix.slice('server/'.length);
  }
  return withoutDotPrefix;
};

export const deriveTargetedStepImports = (serverDir, features) => {
  const stepImports = [];

  for (const featurePath of features) {
    const normalizedFeaturePath = path.posix.normalize(featurePath);
    const featureRelativePath = path.posix.relative(
      CUCUMBER_FEATURE_ROOT,
      normalizedFeaturePath,
    );
    if (
      featureRelativePath.length === 0 ||
      featureRelativePath.startsWith('../') ||
      featureRelativePath === '..' ||
      path.posix.isAbsolute(featureRelativePath) ||
      !featureRelativePath.endsWith('.feature')
    ) {
      return [];
    }

    const candidate = path.posix.join(
      CUCUMBER_STEP_ROOT,
      featureRelativePath.replace(/\.feature$/u, '.steps.ts'),
    );
    const candidateRelativePath = path.posix.relative(
      CUCUMBER_STEP_ROOT,
      candidate,
    );
    if (
      candidateRelativePath.startsWith('../') ||
      candidateRelativePath === '..' ||
      path.posix.isAbsolute(candidateRelativePath)
    ) {
      return [];
    }
    if (!fs.existsSync(path.join(serverDir, candidate))) return [];
    stepImports.push(candidate);
  }

  return [...new Set(stepImports)];
};

export const buildCucumberImportArgs = (serverDir, features) => {
  const normalizedFeatures = features.map((feature) =>
    normalizeServerPath(feature),
  );
  const targetedStepImports =
    normalizedFeatures.length > 0
      ? deriveTargetedStepImports(serverDir, normalizedFeatures)
      : [];

  if (targetedStepImports.length > 0) {
    return [
      ...CUCUMBER_SUPPORT_IMPORTS.flatMap((file) => ['--import', file]),
      ...targetedStepImports.flatMap((file) => ['--import', file]),
    ];
  }

  return [
    ...CUCUMBER_SUPPORT_IMPORTS.flatMap((file) => ['--import', file]),
    '--import',
    'src/test/steps/**/*.ts',
  ];
};
